# ==========================================================================
# J-Quants API V2 一括ダウンロードスクリプト（Google Colab / ローカル実行用）
# --------------------------------------------------------------------------
# TARGET_MODE = "universe"（既定）の場合、実行すると以下の流れになります。
#
#   1. listed_universe.json（上場銘柄の全件マスタ）が無ければ自動的に取得します。
#      既にある場合は「再取得しますか？(y/N)」と聞かれるので、最新の銘柄構成に
#      更新したい時だけ y を入力してください（通常はEnterでスキップでOK）。
#   2. ダウンロードする市場区分を選びます。0（またはEnter）で
#      「東証プライム＋スタンダード＋グロース」を1回の実行でまとめて取得します。
#      単独の市場だけ、あるいは "1,3" のような複数指定もできます。
#   3. 市場区分ごとに分かれた旧形式のファイルが残っていれば、統合するか聞かれます
#      （yで取得済みデータを引き継げるため、再ダウンロードが不要になります）。
#   4. 出力ファイルが既にある場合は「上書きしますか？(y/N)」と聞かれます。
#      ・N（既定）… 未取得の銘柄だけを追加します。途中で中断しても同じ
#                    コマンドを再実行すれば続きから処理されます。
#      ・y        … 全銘柄を取り直します。このスクリプトに取得項目を追加した
#                    後は、取得済みの銘柄にも新項目を入れるためyを選びます。
#                    既存ファイルは .bak として退避されます。
#   5. 選んだ市場区分の銘柄について、決算・株価データを一括取得します
#      （既定では件数上限なし・PARALLEL_WORKERS件を並列で取得）。
#      出力は市場区分によらず jquants_dataset_universe.json の1ファイルにまとめ、
#      SAVE_EVERY件ごとに途中保存するため、Ctrl+Cで中断しても続きから再開できます。
#
# 使い方（Google Colabの場合）:
#   1. Google Colab (https://colab.research.google.com/) で新しいノートブックを作成
#   2. このファイルの内容を1つのコードセルに全部貼り付けて実行するだけでOK
#   3. 実行すると途中でAPIキーの入力（画面には表示されません）、上場銘柄一覧の
#      再取得要否（y/N）、ダウンロードする市場区分（番号選択）を聞かれます
#   4. 完了すると jquants_dataset_*.json が自動的にダウンロードされます
#   5. そのJSONファイルを、サイトの「データ管理」モーダル内
#      「JSONを読み込む」ボタンからアップロードしてください
#
# 本スクリプトはColab（Googleのサーバー）やローカル環境から直接 requests で
# J-Quants V2 APIを呼び出します。ブラウザ経由ではないため、CORS制限の影響を
# 受けません。
# ==========================================================================

import time
import json
import getpass
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, date

import requests

try:
    from tqdm.auto import tqdm
except ImportError:
    def tqdm(iterable, **kwargs):
        return iterable


# ============================== 設定 ======================================
# 必要に応じて以下の値を編集してください。

# ご契約プラン: "free" / "light" / "standard" / "premium"
PLAN = "standard"

# ダウンロード対象: "universe"（listed_universe.json から市場区分で絞り込み。
#                              バッチ処理・レジューム対応。上場銘柄一覧が
#                              無ければ自動取得、あれば再取得要否を実行時に確認）
#                  "curated"（収録企業約130社の固定リスト。動作確認用）
#                  "custom"（CUSTOM_CODES に指定した銘柄コードのみ。動作確認用）
TARGET_MODE = "universe"

# TARGET_MODE = "custom" の場合に使う銘柄コードリスト（4桁の証券コード文字列）
CUSTOM_CODES = ["7203", "9984", "6758"]

# 対象とする市場区分の既定値（リスト）。実行時に選択プロンプトが出るため通常は
# 編集不要です。3市場すべてを1回の実行でまとめて取得できます。
MARKET_FILTERS = ["東証プライム", "東証スタンダード", "東証グロース"]

# 1回の実行で新たに処理する銘柄数の上限（レジューム対応のバッチサイズ）。
# Noneなら選んだ市場区分の対象銘柄を一度に全件処理します（Standard以上の
# プランなら通常はこのままで問題ありません）。値を設定すると、その件数までしか
# 処理しないため、同じ設定のまま複数回実行して少しずつ進める使い方もできます。
BATCH_SIZE = None

# 並列で取得するワーカー数。APIの1分あたりリクエスト上限（RATE_LIMITS）は
# 並列でも共有のリミッターで守られるため、上限を超える心配はありません。
# 効くのは「1リクエストの待ち時間」の重なりで、レート上限に余裕のあるプラン
# （standard以上）ほど短縮効果が大きくなります。1にすると従来どおり逐次実行です。
PARALLEL_WORKERS = 8

# 途中経過を保存する間隔（処理した銘柄数）。0で無効。全市場を一括取得すると
# 数千社ぶんの処理になるため、既定では定期的に保存し、Ctrl+Cで中断しても
# そこまでの結果が残るようにしています。
SAVE_EVERY = 200

# /fins/summary の生レスポンス（四半期を含む全開示）を出力に含めるか。
# Trueだと1社あたり約49KB増え、全3市場では出力が約320MBになります。
# 将来サイトで四半期データを扱う予定がなければFalseにすると約45MBまで下がり、
# ブラウザへの取り込みも軽くなります。
INCLUDE_RAW_STATEMENTS = True

# 配当情報（配当利回り計算用）も取得するか（リクエスト数が増えます。
# /fins/summary の DivAnn / FDivAnn で代用できるため、通常はFalseでも
# 大きな影響はありません）。
FETCH_DIVIDEND = False

# 銘柄マスタ（企業名・業種・市場区分）も取得するか。
# TARGET_MODE = "universe" では listed_universe.json の情報をそのまま使うため
# 常に無視されます（無駄なAPIコールを避けるため）。
FETCH_MARKET = True

# 出力するJSONファイル名（Noneなら jquants_dataset_universe.json）。
# 市場区分によらず1つのファイルにまとめます。市場区分は各社のレコードに
# 入っているので、サイト側のフィルターで絞り込めます。
OUTPUT_FILENAME = None

# 市場区分ごとに分けていた旧バージョンの出力ファイル名（統合時の取り込み元）
LEGACY_OUTPUT_FILENAMES = [
    "jquants_dataset_universe_prime.json",
    "jquants_dataset_universe_standard.json",
    "jquants_dataset_universe_growth.json",
]

# 株価取得の開始日（YYYY-MM-DD）。決算発表日の翌営業日終値を求めるため、
# 直近PERIOD_SLOT_COUNT期分（各社ごとの決算期基準）でカバーしうる最も古い
# 発表日より前に設定してください。
PRICE_HISTORY_FROM = "2016-04-01"

# ---- 上場銘柄一覧（listed_universe.json）の取得設定 --------------------------

# 上場銘柄一覧を取得する基準日（YYYY-MM-DD）。Noneなら最新営業日。
UNIVERSE_DATE = None

# 上場銘柄一覧の保存先ファイル名
UNIVERSE_FILENAME = "listed_universe.json"


# ============================ 基本定義 =====================================
API_BASE = "https://api.jquants.com/v2"

RATE_LIMITS = {"free": 5, "light": 60, "standard": 120, "premium": 500}

MARKET_SLUGS = {"東証プライム": "prime", "東証スタンダード": "standard", "東証グロース": "growth"}

# 決算期の「相対スロット」ラベル（古い→新しい順、末尾が各社の最新期）。
# 会社によって決算期末月が異なる（グロース市場には3月期以外も多い）ため、
# 暦年に固定したラベルで全社を突き合わせるのではなく、各社ごとの直近◯期という
# 相対位置でデータを揃える。サイト側（js/data.js）の期間セレクタも「最新決算期
# ／1期前／2期前」という相対指定のため、この方式と整合する。
FISCAL_YEARS = ["9期前", "8期前", "7期前", "6期前", "5期前", "4期前", "3期前", "2期前", "1期前", "最新期"]

# サイトの「収録企業リスト（約130社）」と同一の対象銘柄（TARGET_MODE="curated"用、
# 動作確認・少数サンプル取得に利用）
# 各要素: [証券コード, 企業名, 業種]
COMPANIES_RAW = [
    ["9432", "日本電信電話", "情報・通信業"], ["9433", "KDDI", "情報・通信業"],
    ["9984", "ソフトバンクグループ", "情報・通信業"], ["4689", "LINEヤフー", "情報・通信業"],
    ["4755", "楽天グループ", "情報・通信業"], ["2432", "ディー・エヌ・エー", "情報・通信業"],
    ["3659", "ネクソン", "情報・通信業"], ["4324", "電通グループ", "情報・通信業"],
    ["9613", "NTTデータグループ", "情報・通信業"], ["4307", "野村総合研究所", "情報・通信業"],
    ["4751", "サイバーエージェント", "情報・通信業"], ["3092", "ZOZO", "情報・通信業"],
    ["2121", "ミクシィ", "情報・通信業"],
    ["6501", "日立製作所", "電気機器"], ["6503", "三菱電機", "電気機器"],
    ["6502", "東芝", "電気機器"], ["6752", "パナソニックホールディングス", "電気機器"],
    ["6758", "ソニーグループ", "電気機器"], ["6702", "富士通", "電気機器"],
    ["6701", "日本電気", "電気機器"], ["6861", "キーエンス", "電気機器"],
    ["6981", "村田製作所", "電気機器"], ["6857", "アドバンテスト", "電気機器"],
    ["8035", "東京エレクトロン", "電気機器"], ["6971", "京セラ", "電気機器"],
    ["6762", "TDK", "電気機器"], ["6841", "横河電機", "電気機器"],
    ["6954", "ファナック", "電気機器"], ["6594", "ニデック", "電気機器"],
    ["6723", "ルネサスエレクトロニクス", "電気機器"],
    ["7203", "トヨタ自動車", "輸送用機器"], ["7267", "本田技研工業", "輸送用機器"],
    ["7201", "日産自動車", "輸送用機器"], ["7269", "スズキ", "輸送用機器"],
    ["7270", "SUBARU", "輸送用機器"], ["7272", "ヤマハ発動機", "輸送用機器"],
    ["7259", "アイシン", "輸送用機器"], ["7202", "いすゞ自動車", "輸送用機器"],
    ["7211", "三菱自動車工業", "輸送用機器"], ["5108", "ブリヂストン", "輸送用機器"],
    ["4063", "信越化学工業", "化学"], ["4188", "三菱ケミカルグループ", "化学"],
    ["4005", "住友化学", "化学"], ["4183", "三井化学", "化学"],
    ["4901", "富士フイルムホールディングス", "化学"], ["4911", "資生堂", "化学"],
    ["4452", "花王", "化学"], ["3407", "旭化成", "化学"], ["4021", "日産化学", "化学"],
    ["4502", "武田薬品工業", "医薬品"], ["4503", "アステラス製薬", "医薬品"],
    ["4519", "中外製薬", "医薬品"], ["4523", "エーザイ", "医薬品"],
    ["4507", "塩野義製薬", "医薬品"], ["4151", "協和キリン", "医薬品"],
    ["4578", "大塚ホールディングス", "医薬品"],
    ["9983", "ファーストリテイリング", "小売業"], ["3382", "セブン&アイ・ホールディングス", "小売業"],
    ["8267", "イオン", "小売業"], ["9843", "ニトリホールディングス", "小売業"],
    ["7453", "良品計画", "小売業"], ["2782", "セリア", "小売業"],
    ["9861", "吉野家ホールディングス", "小売業"], ["3086", "J.フロント リテイリング", "小売業"],
    ["7936", "アシックス", "その他製品"], ["7912", "大日本印刷", "その他製品"],
    ["7911", "凸版印刷", "その他製品"], ["7832", "バンダイナムコホールディングス", "その他製品"],
    ["7947", "エフピコ", "その他製品"],
    ["8591", "オリックス", "その他金融業"], ["8570", "イオンフィナンシャルサービス", "その他金融業"],
    ["8306", "三菱UFJフィナンシャル・グループ", "銀行業"], ["8316", "三井住友フィナンシャルグループ", "銀行業"],
    ["8411", "みずほフィナンシャルグループ", "銀行業"], ["8354", "ふくおかフィナンシャルグループ", "銀行業"],
    ["8355", "静岡銀行", "銀行業"],
    ["8630", "SOMPOホールディングス", "保険業"], ["8725", "MS&ADインシュアランスグループホールディングス", "保険業"],
    ["8766", "東京海上ホールディングス", "保険業"],
    ["8604", "野村ホールディングス", "証券業"], ["8601", "大和証券グループ本社", "証券業"],
    ["6098", "リクルートホールディングス", "サービス業"], ["4661", "オリエンタルランド", "サービス業"],
    ["9735", "セコム", "サービス業"], ["2413", "エムスリー", "サービス業"], ["9602", "東宝", "サービス業"],
    ["2502", "アサヒグループホールディングス", "食品"], ["2503", "キリンホールディングス", "食品"],
    ["2914", "日本たばこ産業", "食品"], ["2801", "キッコーマン", "食品"],
    ["2269", "明治ホールディングス", "食品"], ["2897", "日清食品ホールディングス", "食品"],
    ["1801", "大成建設", "建設業"], ["1802", "大林組", "建設業"], ["1803", "清水建設", "建設業"],
    ["1928", "積水ハウス", "建設業"], ["1925", "大和ハウス工業", "建設業"],
    ["6301", "コマツ", "機械"], ["6367", "ダイキン工業", "機械"], ["6273", "SMC", "機械"],
    ["7011", "三菱重工業", "機械"], ["7013", "IHI", "機械"],
    ["5401", "日本製鉄", "鉄鋼・非鉄金属"], ["5411", "JFEホールディングス", "鉄鋼・非鉄金属"],
    ["5714", "DOWAホールディングス", "鉄鋼・非鉄金属"],
    ["8801", "三井不動産", "不動産業"], ["8802", "三菱地所", "不動産業"], ["8804", "東京建物", "不動産業"],
    ["9020", "東日本旅客鉄道", "陸運業"], ["9022", "東海旅客鉄道", "陸運業"], ["9021", "西日本旅客鉄道", "陸運業"],
    ["9202", "ANAホールディングス", "空運業"], ["9201", "日本航空", "空運業"],
    ["9501", "東京電力ホールディングス", "電力・ガス業"], ["9502", "中部電力", "電力・ガス業"],
    ["9503", "関西電力", "電力・ガス業"],
    ["8058", "三菱商事", "卸売業"], ["8031", "三井物産", "卸売業"], ["8001", "伊藤忠商事", "卸売業"],
    ["8053", "住友商事", "卸売業"], ["2768", "双日", "卸売業"],
    ["7733", "オリンパス", "精密機器"], ["7731", "ニコン", "精密機器"], ["4543", "テルモ", "精密機器"],
]


# ========================== 補助関数（レスポンス解析） =======================
def pick(d, keys):
    """複数の候補キー名の中から、値が入っている最初のものを返す（V2の項目名が
    未確定な部分のための防御的パース）。"""
    if not d:
        return None
    for k in keys:
        v = d.get(k)
        if v not in (None, "", "－"):
            return v
    return None


def to_num(v):
    if v in (None, "", "－"):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def to_fiscal_year_label(end_date_str):
    """'2024-03-31' 等の日付文字列を 'YYYY/MM期' 形式に変換する。"""
    if not end_date_str:
        return None
    try:
        d = datetime.strptime(str(end_date_str)[:10], "%Y-%m-%d")
    except ValueError:
        return None
    return f"{d.year}/{d.month:02d}期"


def map_market_code_name(raw):
    if not raw:
        return None
    if "プライム" in raw:
        return "東証プライム"
    if "スタンダード" in raw:
        return "東証スタンダード"
    if "グロース" in raw:
        return "東証グロース"
    return raw


def to_short_code(raw_code):
    """銘柄一覧APIのレスポンスは5桁コード（末尾0埋め、例:'86970'）で返るが、
    /fins/summary 等の他エンドポイントへのクエリは4桁コード（例:'7203'）を
    期待するため変換する。"""
    s = str(raw_code).strip()
    if len(s) == 5 and s.endswith("0"):
        return s[:4]
    return s


def parse_subscription_start_date(message):
    """「Your subscription covers the following dates: YYYY-MM-DD ~ 」形式の
    エラーメッセージから、契約プランが実際にカバーしている開始日を抽出する。
    見つからなければNoneを返す。"""
    m = re.search(r"covers the following dates:\s*(\d{4}-\d{2}-\d{2})", message or "")
    return m.group(1) if m else None


def build_price_series(quotes):
    """株価レスポンス配列から (日付文字列, 終値) の昇順リストを作る。"""
    series = []
    for q in quotes or []:
        d = pick(q, ["Date", "date"])
        c = to_num(pick(q, ["C", "Close"]))
        if d and c is not None:
            series.append((str(d)[:10], c))
    series.sort(key=lambda x: x[0])
    return series


def find_next_close(price_series, disc_date):
    """disc_date（決算発表日）より後の最初の取引日の終値を返す（＝翌営業日の
    終値。翌営業日が休場等で存在しない場合はさらに後の最初の取引日）。"""
    if not disc_date:
        return None
    for d, c in price_series:
        if d > disc_date:
            return c
    return None


# ============================ レート制限 ===================================
class RateLimiter:
    """選択したプランの1分あたりリクエスト数上限を超えないよう、
    リクエスト送信タイミングを均等にスケジューリングする。

    並列実行時は複数スレッドが同時にwait()を呼ぶため、送信枠の予約
    （next_timeの読み出し→更新）はロックで排他する。ここを保護しないと
    複数スレッドが同じ枠を取り合い、レート上限を超えて429を招く。
    実際のsleepはロックの外で行い、他スレッドの枠予約を待たせない。"""

    def __init__(self, per_minute):
        self.min_interval = 60.0 / per_minute
        self.next_time = 0.0
        self._lock = threading.Lock()

    def wait(self):
        with self._lock:
            now = time.monotonic()
            start = max(now, self.next_time)
            self.next_time = start + self.min_interval
        sleep_for = start - time.monotonic()
        if sleep_for > 0:
            time.sleep(sleep_for)


def estimate_seconds(target_count, requests_per_company, plan):
    rate = RATE_LIMITS.get(plan, RATE_LIMITS["free"])
    total_requests = target_count * requests_per_company + 1
    return int((total_requests / rate) * 60) + 1


def format_seconds(sec):
    if sec < 60:
        return f"約{sec}秒"
    m, s = divmod(sec, 60)
    return f"約{m}分{s}秒" if s else f"約{m}分"


# ============================ API呼び出し ===================================
class JQuantsClient:
    def __init__(self, api_key, plan):
        self.api_key = api_key
        # requests.Session はスレッド間で共有すると競合しうるため、スレッドごとに
        # 1つ持つ（コネクションプールもスレッド単位になる）。
        self._local = threading.local()
        self.limiter = RateLimiter(RATE_LIMITS.get(plan, RATE_LIMITS["free"]))
        # 株価取得で「契約プランがカバーする開始日」より前を指定して400になった場合、
        # エラーメッセージから実際の開始日を学習してここに記憶し、以降は最初から
        # その日付を使う（毎回エラー→リトライを繰り返さないため）。
        self.price_history_from_override = None
        self._override_lock = threading.Lock()

    @property
    def session(self):
        s = getattr(self._local, "session", None)
        if s is None:
            s = requests.Session()
            self._local.session = s
        return s

    def _get(self, path, params=None, max_retries=3):
        for attempt in range(max_retries + 1):
            self.limiter.wait()
            resp = self.session.get(
                f"{API_BASE}{path}",
                headers={"x-api-key": self.api_key},
                params=params,
                timeout=30,
            )
            if resp.status_code == 429 and attempt < max_retries:
                retry_after = resp.headers.get("Retry-After")
                wait_s = float(retry_after) if retry_after else 5 * (attempt + 1)
                time.sleep(wait_s)
                continue
            if resp.status_code in (401, 403):
                raise RuntimeError(f"認証エラー (HTTP {resp.status_code}): {resp.text[:300]}")
            if not resp.ok:
                raise RuntimeError(f"APIエラー (HTTP {resp.status_code}): {resp.text[:300]}")
            return resp.json()
        raise RuntimeError("リトライ上限に達しました（429が解消しませんでした）。")

    def check_connection(self):
        """簡易な接続確認（トヨタ自動車の銘柄マスタを1件取得）。"""
        self._get("/equities/master", {"code": "7203"})
        return True

    def fetch_all_pages(self, path, params, max_pages=20):
        all_rows = []
        pagination_key = None
        for _ in range(max_pages):
            q = dict(params or {})
            if pagination_key:
                q["pagination_key"] = pagination_key
            data = self._get(path, q)
            rows = data.get("data", [])
            all_rows.extend(rows)
            pagination_key = data.get("pagination_key")
            if not pagination_key:
                break
        return all_rows

    def fetch_master_info(self, code):
        data = self._get("/equities/master", {"code": code})
        rows = data.get("data", [])
        return rows[0] if rows else None

    def fetch_all_listed(self, date=None):
        """上場銘柄の全件マスタを取得する（codeを指定しない＝全銘柄）。"""
        params = {"date": date} if date else {}
        return self.fetch_all_pages("/equities/master", params, max_pages=500)

    def fetch_statements(self, code):
        return self.fetch_all_pages("/fins/summary", {"code": code})

    def fetch_dividends(self, code):
        return self.fetch_all_pages("/fins/dividend", {"code": code})

    def fetch_price_history(self, code, date_from, date_to):
        with self._override_lock:
            effective_from = self.price_history_from_override or date_from
        try:
            return self.fetch_all_pages(
                "/equities/bars/daily", {"code": code, "from": effective_from, "to": date_to}, max_pages=100
            )
        except RuntimeError as e:
            allowed_from = parse_subscription_start_date(str(e))
            if not allowed_from or allowed_from == effective_from:
                raise
            # 契約プランの実際の開始日が判明したので記憶し、その日付で再試行する。
            # 並列実行では複数スレッドが同時にここへ来るが、書き込む値は同じなので
            # 先に書いた方を残す（後続スレッドは記憶済みの日付で最初から投げる）。
            with self._override_lock:
                if self.price_history_from_override is None:
                    self.price_history_from_override = allowed_from
            return self.fetch_all_pages(
                "/equities/bars/daily", {"code": code, "from": allowed_from, "to": date_to}, max_pages=100
            )


# ==================== 決算・株価データ → サイト用financials形式 =================
def build_financials_from_statements(statements, price_series, dividends):
    # 実際の /fins/summary レスポンス（2026-07-30 確認、トヨタ自動車 7203）を基に
    # 実データのキー名を優先候補に、旧V1推測名をフォールバックとして残す。
    period_type_keys = ["CurPerType", "TypeOfCurrentPeriod", "PeriodType", "CurrentPeriodType"]
    end_date_keys = ["CurPerEn", "CurrentPeriodEndDate", "PeriodEnd", "FiscalYearEndDate"]
    disclosed_keys = ["DiscDate", "DisclosedDate", "DisclosureDate"]

    fy_statements = [s for s in statements if pick(s, period_type_keys) in ("FY", "Annual", "4Q")]
    if not fy_statements:
        fy_statements = statements  # フォールバック：全件を年次扱い

    by_label = {}
    for s in fy_statements:
        label = to_fiscal_year_label(pick(s, end_date_keys))
        if not label:
            continue
        disclosed = pick(s, disclosed_keys) or ""
        if label not in by_label or disclosed > by_label[label].get("_disclosed", ""):
            merged = dict(s)
            merged["_disclosed"] = disclosed
            by_label[label] = merged

    # 会社ごとの決算期ラベル("YYYY/MM期")は文字列の昇順=時系列の昇順に一致する
    # ため、そのままソートして直近n期を取り、配列の末尾（最新期）に揃える。
    # 固定の暦年ラベル(FISCAL_YEARS)との突き合わせは行わない — これにより
    # 3月期以外の決算期の会社（グロース市場に多い）でも正しく揃う。
    n = len(FISCAL_YEARS)
    sorted_labels = sorted(by_label.keys())[-n:]
    slot_labels = [None] * (n - len(sorted_labels)) + sorted_labels

    revenue = [None] * n
    op_income = [None] * n
    net_income = [None] * n
    operating_margin = [None] * n
    net_margin = [None] * n
    per = [None] * n
    pbr = [None] * n
    roe = [None] * n
    roa = [None] * n
    dividend_yield = [None] * n
    market_cap = [None] * n
    equity_ratio = [None] * n
    payout_ratio = [None] * n
    operating_cf_margin = [None] * n
    cash_and_equivalents = [None] * n
    total_assets_amount = [None] * n
    free_cash_flow = [None] * n
    free_cash_flow_yield = [None] * n  # FCF / 時価総額（%）
    # 前期実績との比較(YoY)は開示期間が短いプランではほぼ算出不能な企業が
    # 出るため、同一開示内に含まれる「会社予想の来期数値」との比較でも成長率を
    # 算出しておく（YoYが取れる場合はそちらを優先）。
    revenue_growth_forecast = [None] * n
    op_income_growth_forecast = [None] * n
    net_income_growth_forecast = [None] * n
    revenue_growth_yoy = [None] * n
    op_income_growth_yoy = [None] * n
    net_income_growth_yoy = [None] * n
    # 会社予想の来期絶対値（軸に「売上高（会社予想）」等を選べるようにするため、
    # 成長率だけでなく金額そのものも保持しておく）。
    revenue_forecast = [None] * n
    op_income_forecast = [None] * n
    net_income_forecast = [None] * n
    # 会社予想EPS（NxFEPS＝翌事業年度の期末予想EPS）と、それを使った予想PER。
    # 予想BPSに相当する項目はJ-Quants側に存在しない（決算短信の開示制度上、
    # 「予想の1株当たり純資産」という開示項目自体がない）ため予想PBRは算出しない。
    eps_actual = [None] * n
    bps_actual = [None] * n
    forecast_eps = [None] * n
    forecast_per = [None] * n
    # PER/PBR/時価総額の算出に使った基準株価（決算発表日の翌営業日終値）と発行済株数。
    # 株価APIのレスポンスは日足10年分と巨大なため生のままは保存しないが、実際に
    # 使ったこの2つだけ残しておけば、後から株価ベースの指標を追加したくなっても
    # 株価を再取得せずに再計算できる。
    ref_price = [None] * n
    shares_outstanding = [None] * n
    # 上記の個別指定とは別に、各期の開示に含まれる数値フィールドを丸ごと配列で
    # 保持する（キー名はJ-Quantsのレスポンスのまま）。新しい指標を軸に追加したく
    # なった時に、再ダウンロードせず financials.raw.<キー名> を参照するだけで済む。
    raw_fields = {}
    period_labels = list(slot_labels)  # 各スロットの実際の決算期ラベル（会社ごとに異なる）

    dividend_by_label = {}
    for d in dividends or []:
        label = to_fiscal_year_label(pick(d, ["ReferencePeriodEndDate", "CurrentPeriodEndDate", "PeriodEnd"]))
        dps = to_num(pick(d, [
            "ResultDividendPerShareAnnual", "AnnualDividendPerShare",
            "DividendPerShareAnnual", "ForecastDividendPerShareAnnual",
        ]))
        if label and dps is not None:
            dividend_by_label[label] = dps

    matched_count = 0
    period_values = {}  # label -> (rev, op, ni)  YoY計算用
    for i, label in enumerate(slot_labels):
        if not label:
            continue
        s = by_label[label]
        # 数値として解釈できるフィールドを全て取り込む（個別指定の指標より先に
        # 行う。rev等が取れない期でも、取れたフィールドは残すため）。
        for raw_key, raw_value in s.items():
            if raw_key.startswith("_"):
                continue
            raw_num = to_num(raw_value)
            if raw_num is None:
                continue
            raw_fields.setdefault(raw_key, [None] * n)[i] = raw_num

        rev = to_num(pick(s, ["Sales", "NetSales", "OperatingRevenue", "TotalNetRevenue"]))
        op = to_num(pick(s, ["OP", "OperatingProfit"]))
        ni = to_num(pick(s, ["NP", "Profit", "NetIncome"]))
        equity = to_num(pick(s, ["Eq", "Equity"]))
        total_assets = to_num(pick(s, ["TA", "TotalAssets"]))
        eps = to_num(pick(s, ["EPS", "EarningsPerShare"]))
        bps = to_num(pick(s, ["BPS", "BookValuePerShare"]))
        eq_ar = to_num(pick(s, ["EqAR"]))
        payout = to_num(pick(s, ["PayoutRatioAnn"]))
        cfo = to_num(pick(s, ["CFO"]))
        cfi = to_num(pick(s, ["CFI"]))
        cash_eq = to_num(pick(s, ["CashEq"]))
        # 会社予想の来期数値（同一開示内に含まれる）。
        next_fy_rev = to_num(pick(s, ["NxFSales"]))
        next_fy_op = to_num(pick(s, ["NxFOP"]))
        next_fy_ni = to_num(pick(s, ["NxFNp"]))
        # 翌事業年度の期末予想EPS。FEPSは「当期」の予想EPSで、期末(FY)開示の
        # 時点では実績が確定済みのため、予想PERにはNxFEPSを使う。
        next_fy_eps = to_num(pick(s, ["NxFEPS", "NextYearForecastEarningsPerShare"]))
        # DivAnn: 当期の実績年間配当（確定後）。FDivAnn: 会社予想の年間配当。
        dps_from_statement = to_num(pick(s, [
            "DivAnn", "FDivAnn",
            "ResultDividendPerShareAnnual", "ForecastDividendPerShareAnnual",
        ]))
        dps = dps_from_statement if dps_from_statement is not None else dividend_by_label.get(label)

        period_values[label] = (rev, op, ni)

        if rev is not None:
            revenue[i] = rev / 1e8
            matched_count += 1
        if op is not None:
            op_income[i] = op / 1e8
        if ni is not None:
            net_income[i] = ni / 1e8
        if rev and op is not None:
            operating_margin[i] = (op / rev) * 100
        if rev and ni is not None:
            net_margin[i] = (ni / rev) * 100
        if equity and ni is not None:
            roe[i] = (ni / equity) * 100
        if total_assets and ni is not None:
            roa[i] = (ni / total_assets) * 100
        if eq_ar is not None:
            equity_ratio[i] = eq_ar * 100
        if payout is not None:
            payout_ratio[i] = payout * 100
        if rev and cfo is not None:
            operating_cf_margin[i] = (cfo / rev) * 100
        if cash_eq is not None:
            cash_and_equivalents[i] = cash_eq / 1e8
        if total_assets is not None:
            total_assets_amount[i] = total_assets / 1e8
        if cfo is not None and cfi is not None:
            free_cash_flow[i] = (cfo + cfi) / 1e8
        if rev and next_fy_rev is not None:
            revenue_growth_forecast[i] = ((next_fy_rev - rev) / abs(rev)) * 100
        if op and next_fy_op is not None:
            op_income_growth_forecast[i] = ((next_fy_op - op) / abs(op)) * 100
        if ni and next_fy_ni is not None:
            net_income_growth_forecast[i] = ((next_fy_ni - ni) / abs(ni)) * 100
        if next_fy_rev is not None:
            revenue_forecast[i] = next_fy_rev / 1e8
        if next_fy_op is not None:
            op_income_forecast[i] = next_fy_op / 1e8
        if next_fy_ni is not None:
            net_income_forecast[i] = next_fy_ni / 1e8
        if eps is not None:
            eps_actual[i] = eps
        if bps is not None:
            bps_actual[i] = bps
        if next_fy_eps is not None:
            forecast_eps[i] = next_fy_eps

        # 決算発表日（同一開示内の実績）の翌営業日終値を使ってPER/PBR/時価総額
        # /配当利回りを算出する（後年の株価で過去の期を評価しないため）。
        # 発行済株数は株価が取れたかに関係なく残す（時価総額の算出には株価が要る
        # が、株数自体は1株当たり指標の検算などに使えるため）。
        shares = to_num(pick(s, [
            "ShOutFY",
            "NumberOfIssuedAndOutstandingSharesAtTheEndOfFiscalYearIncludingTreasuryStock",
            "SharesOutstanding", "NumberOfShares",
        ]))
        if shares is not None:
            shares_outstanding[i] = shares

        disclosed = s.get("_disclosed")
        price = find_next_close(price_series, disclosed) if price_series else None
        if price:
            ref_price[i] = price
            if eps:
                per[i] = price / eps
            if bps:
                pbr[i] = price / bps
            if next_fy_eps:
                forecast_per[i] = price / next_fy_eps
            if dps:
                dividend_yield[i] = (dps / price) * 100
            if shares:
                market_cap[i] = (price * shares) / 1e8
            # FCF利回り（%）＝フリーキャッシュフロー÷時価総額×100
            if free_cash_flow[i] is not None and market_cap[i] and market_cap[i] != 0:
                free_cash_flow_yield[i] = (free_cash_flow[i] / market_cap[i]) * 100

    # 前期実績とのYoY成長率（直前スロットに実績値がある場合のみ算出。決算期
    # 変更等でスロットが途切れている場合は算出しない）。
    for i in range(1, n):
        label = slot_labels[i]
        prev_label = slot_labels[i - 1]
        if not label or not prev_label:
            continue
        cur = period_values.get(label)
        prev = period_values.get(prev_label)
        if not cur or not prev:
            continue
        cur_rev, cur_op, cur_ni = cur
        prev_rev, prev_op, prev_ni = prev
        if prev_rev and cur_rev is not None:
            revenue_growth_yoy[i] = ((cur_rev - prev_rev) / abs(prev_rev)) * 100
        if prev_op and cur_op is not None:
            op_income_growth_yoy[i] = ((cur_op - prev_op) / abs(prev_op)) * 100
        if prev_ni and cur_ni is not None:
            net_income_growth_yoy[i] = ((cur_ni - prev_ni) / abs(prev_ni)) * 100

    financials = {
        "revenue": revenue, "opIncome": op_income, "netIncome": net_income,
        "operatingMargin": operating_margin, "netMargin": net_margin,
        "per": per, "pbr": pbr, "roe": roe, "roa": roa,
        "dividendYield": dividend_yield, "marketCap": market_cap,
        "equityRatio": equity_ratio, "payoutRatio": payout_ratio,
        "operatingCfMargin": operating_cf_margin,
        "cashAndEquivalents": cash_and_equivalents,
        "totalAssets": total_assets_amount,
        "freeCashFlow": free_cash_flow,
        "freeCashFlowYield": free_cash_flow_yield,
        "revenueGrowthForecast": revenue_growth_forecast,
        "opIncomeGrowthForecast": op_income_growth_forecast,
        "netIncomeGrowthForecast": net_income_growth_forecast,
        "revenueForecast": revenue_forecast,
        "opIncomeForecast": op_income_forecast,
        "netIncomeForecast": net_income_forecast,
        "revenueGrowthYoy": revenue_growth_yoy,
        "opIncomeGrowthYoy": op_income_growth_yoy,
        "netIncomeGrowthYoy": net_income_growth_yoy,
        "eps": eps_actual, "bps": bps_actual,
        "forecastEps": forecast_eps, "forecastPer": forecast_per,
        "refPrice": ref_price, "sharesOutstanding": shares_outstanding,
        "periodLabels": period_labels,
        # 開示に含まれる数値フィールドの全件（キー名はJ-Quantsのレスポンスのまま）。
        "raw": raw_fields,
    }
    return matched_count, financials


# ================================ 共通処理 ===================================
def connect(plan, max_retries=3):
    """APIキーの入力と接続確認。失敗時は最大max_retries回まで再入力を求める。"""
    for attempt in range(max_retries + 1):
        api_key = os.environ.get("JQUANTS_API_KEY", "").strip()
        if api_key:
            print("環境変数 JQUANTS_API_KEY からAPIキーを読み込みました。")
        else:
            api_key = getpass.getpass("J-QuantsのAPIキーを入力してください（画面には表示されません）: ").strip()
        if not api_key:
            if attempt < max_retries:
                print(f"APIキーが入力されませんでした（{attempt + 1}/{max_retries}）。もう一度入力してください。\n")
                continue
            else:
                raise SystemExit("APIキーが入力されませんでした。処理を中止します。")

        client = JQuantsClient(api_key, plan)
        print("\n接続確認中...")
        try:
            client.check_connection()
            print("接続に成功しました。\n")
            return client
        except Exception as e:
            if attempt < max_retries:
                print(f"接続に失敗しました: {e}")
                print(f"APIキーが正しいか、プランが有効かご確認ください。"
                      f"（{attempt + 1}/{max_retries}）\n")
                continue
            else:
                raise SystemExit(f"接続に失敗しました（{max_retries}回試行）: {e}\n"
                                f"APIキーが正しいか、プランが有効かご確認ください。")


def download_to_colab_if_available(filename):
    try:
        from google.colab import files  # noqa: F401
        files.download(filename)
        print("ブラウザへのダウンロードを開始しました。")
    except ImportError:
        print("（Colab環境ではないため自動ダウンロードはスキップされました。"
              f"カレントディレクトリの {filename} を手動で取得してください。）")


def process_one_company(client, target, need_market_lookup):
    """1銘柄分の決算・株価データを取得し、サイト用のcompanyレコードを返す。"""
    code = target["code"]
    name = target.get("name")
    sector = target.get("sector")
    market = target.get("market")

    if need_market_lookup and (FETCH_MARKET or MARKET_FILTERS or not name or not sector or not market):
        info = client.fetch_master_info(code)
        if info:
            name = name or pick(info, ["CoName", "CompanyName", "Name"])
            sector = sector or pick(info, ["S33Nm", "Sector33CodeName", "SectorName"])
            market = market or map_market_code_name(pick(info, ["MktNm", "MarketCodeName", "MarketName", "Market"]))

    if not name:
        return {"code": code, "status": "failed", "message": "銘柄情報が見つかりませんでした。"}

    if MARKET_FILTERS and market not in MARKET_FILTERS:
        return {"code": code, "name": name, "status": "skipped",
                "message": f"対象外の市場区分（{market or '不明'}）のためスキップ"}

    statements = client.fetch_statements(code)
    price_rows = client.fetch_price_history(
        code, PRICE_HISTORY_FROM, datetime.now().strftime("%Y-%m-%d")
    )
    price_series = build_price_series(price_rows)

    dividends = []
    if FETCH_DIVIDEND:
        try:
            dividends = client.fetch_dividends(code)
        except Exception:
            # /fins/dividend はプランによっては利用不可な場合がある。
            # 配当が取れないだけで決算データまで失敗扱いにしないよう握りつぶす。
            dividends = []

    matched_count, financials = build_financials_from_statements(statements, price_series, dividends)

    if matched_count == 0:
        return {"code": code, "name": name, "status": "failed", "message": "決算データを取得できませんでした。"}

    status = "ok" if matched_count >= len(FISCAL_YEARS) - 1 else "partial"
    company = {
        "code": code, "name": name,
        "sector": sector or "その他", "market": market or "不明",
        "color": None, "financials": financials, "source": "jquants",
        # データの取得日付（更新管理用）。
        "fetchedAt": date.today().isoformat(),
    }
    # /fins/summary から取得した全開示（四半期含む）をそのまま保存しておく。
    # サイトが現状使うのは決算期（FY）データのみ（financialsに集計済み）だが、
    # 将来四半期データを使う機能を追加する際に再取得せずに使えるようにする。
    # ただし1社あたり約49KBとファイルサイズの過半を占めるため、設定で外せる。
    if INCLUDE_RAW_STATEMENTS:
        company["rawStatements"] = statements
    return {
        "code": code, "name": name, "status": status,
        "message": f"{matched_count}/{len(FISCAL_YEARS)}期取得", "company": company,
    }


def run_batch(client, targets, need_market_lookup, desc, workers=1, on_checkpoint=None, checkpoint_every=0):
    """targetsを処理し、(results, companies, interrupted) を返す。

    workersを2以上にすると並列に取得する。APIのレート上限はclient側の共有
    リミッターが守るため、ワーカー数を増やしても上限は超えない（増やして効くのは
    1リクエストごとの待ち時間が重なる分）。
    on_checkpointを渡すと、checkpoint_every件処理するごとにそこまでの
    companiesを渡して呼び出す（途中保存用）。
    Ctrl+Cで中断された場合は、そこまでの結果を返し interrupted=True にする。"""
    def work(item):
        idx, target = item
        try:
            return idx, process_one_company(client, target, need_market_lookup)
        except Exception as e:
            return idx, {"code": target["code"], "name": target.get("name"),
                         "status": "failed", "message": str(e)}

    # 結果は投入順のスロットに書き戻し、完了順で順序が入れ替わらないようにする
    # （出力JSONの並びが実行ごとに変わると差分が読みにくいため）。
    slots = [None] * len(targets)
    companies = []
    interrupted = False
    done = 0

    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = [executor.submit(work, item) for item in enumerate(targets)]
        try:
            for future in tqdm(as_completed(futures), total=len(futures), desc=desc):
                idx, result = future.result()
                slots[idx] = result
                if result.get("company"):
                    companies.append(result["company"])
                done += 1
                if on_checkpoint and checkpoint_every and done % checkpoint_every == 0:
                    on_checkpoint(companies)
        except KeyboardInterrupt:
            interrupted = True
            for future in futures:
                future.cancel()
            print("\n中断を検知しました。実行中の取得が終わり次第、ここまでの結果を保存します...")

    results = [r for r in slots if r is not None]
    # 出力の並びも投入順に揃える（completedの順に積んだcompaniesを作り直す）。
    companies = [r["company"] for r in results if r.get("company")]
    return results, companies, interrupted


def print_summary(results, total_targets):
    success_count = sum(1 for r in results if r["status"] == "ok")
    partial_count = sum(1 for r in results if r["status"] == "partial")
    failed_count = sum(1 for r in results if r["status"] == "failed")
    skipped_count = sum(1 for r in results if r["status"] == "skipped")

    print(f"\n今回の実行結果: 成功{success_count}社 / 一部取得{partial_count}社 / "
          f"失敗{failed_count}社 / 対象外{skipped_count}社（走査{len(results)}社 / 対象{total_targets}社）")

    failed = [r for r in results if r["status"] == "failed"]
    if failed:
        print("\n--- 失敗した銘柄（最大20件表示） ---")
        for r in failed[:20]:
            print(f"  {r['code']} {r.get('name','')}: {r['message']}")

    return success_count, partial_count, failed_count, skipped_count


# ============================ MODE = fetch_universe ==========================
def run_fetch_universe(client):
    print("=" * 70)
    print("STEP 1: 上場銘柄一覧の取得")
    print("=" * 70)

    print("上場銘柄マスタを取得しています（全銘柄・ページング）...")
    rows = client.fetch_all_listed(UNIVERSE_DATE)

    universe = []
    seen = set()
    for r in rows:
        raw_code = pick(r, ["Code"])
        if not raw_code:
            continue
        code = to_short_code(raw_code)
        if code in seen:
            continue
        seen.add(code)
        name = pick(r, ["CoName", "CompanyName", "Name"])
        sector = pick(r, ["S33Nm", "Sector33CodeName", "SectorName"])
        market = map_market_code_name(pick(r, ["MktNm", "MarketCodeName", "MarketName", "Market"]))
        if not name:
            continue
        universe.append({
            "code": code, "name": name,
            "sector": sector or "その他", "market": market or "不明",
        })

    payload = {"fetchedAt": datetime.now(timezone.utc).isoformat(), "companies": universe}
    with open(UNIVERSE_FILENAME, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    counts = {}
    for c in universe:
        counts[c["market"]] = counts.get(c["market"], 0) + 1

    print(f"\n{len(universe)}銘柄を取得し、{UNIVERSE_FILENAME} に保存しました。")
    print("市場区分別件数:")
    for m, cnt in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {m}: {cnt}社")

    download_to_colab_if_available(UNIVERSE_FILENAME)

    print(f"\n上場銘柄一覧の取得が完了しました。続けて {'／'.join(MARKET_FILTERS)} の"
          f"決算・株価データのダウンロードに進みます。")


# ================================ MODE = download =============================
def load_universe():
    if not os.path.exists(UNIVERSE_FILENAME):
        raise SystemExit(f"{UNIVERSE_FILENAME} が見つかりません。先に上場銘柄一覧を取得してください。")
    with open(UNIVERSE_FILENAME, encoding="utf-8") as f:
        payload = json.load(f)
    return payload.get("companies", [])


def load_existing_output(filename):
    if not os.path.exists(filename):
        return []
    with open(filename, encoding="utf-8") as f:
        payload = json.load(f)
    return payload.get("companies", [])


def auto_output_filename():
    # 市場区分によらず1ファイルにまとめる（サイトへの取り込みも1回で済むように）。
    return OUTPUT_FILENAME or "jquants_dataset_universe.json"


def format_bytes(num):
    mb = num / 1024 / 1024
    return f"{mb:.1f}MB" if mb >= 1 else f"{num / 1024:.0f}KB"


def save_output(filename, companies, run_stats):
    markets_in_data = sorted({c.get("market") for c in companies if c.get("market")})
    payload = {
        "formatVersion": 1,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "fiscalYears": FISCAL_YEARS,
        "meta": {
            "type": "jquants",
            "downloadedAt": datetime.now(timezone.utc).isoformat(),
            "markets": markets_in_data,
            "companyCount": len(companies),
            "includesRawStatements": INCLUDE_RAW_STATEMENTS,
            "lastRun": run_stats,
        },
        "companies": companies,
    }
    # indentを付けると空白だけで全体の4割ほど膨らむ（全3市場で200MB以上の差）。
    # 人が直接読むファイルではないので詰めて書き出す。
    # 書き込み途中で落ちても既存ファイルを壊さないよう、一時ファイルに書いてから差し替える。
    tmp = filename + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, filename)


def merge_legacy_outputs(output_filename):
    """市場区分ごとに分けていた旧バージョンの出力を、統合ファイルへ取り込む。
    統合ファイルがまだ無い場合にだけ提案する（取得済みのデータを捨てて
    全件ダウンロードし直さずに済むように）。"""
    if os.path.exists(output_filename):
        return None
    found = [f for f in LEGACY_OUTPUT_FILENAMES if os.path.exists(f)]
    if not found:
        return None

    print(f"\n市場区分ごとに分かれた旧形式のファイルが{len(found)}件見つかりました:")
    total_size = 0
    for f in found:
        size = os.path.getsize(f)
        total_size += size
        print(f"  {f}（{format_bytes(size)}）")
    if not ask_yes_no(
        f"これらを {output_filename} に統合しますか？"
        "（yを推奨。取得済みのデータをそのまま引き継げるため、再ダウンロードが不要になります）",
        default_no=False,
    ):
        return None

    merged = []
    seen = set()
    for f in found:
        for c in load_existing_output(f):
            if c["code"] in seen:
                continue
            seen.add(c["code"])
            merged.append(c)
    save_output(output_filename, merged, {"mergedFrom": found})
    print(f"{len(merged)}社を {output_filename} に統合しました"
          f"（{format_bytes(os.path.getsize(output_filename))}）。")
    print("　統合元のファイルはそのまま残してあります。"
          "取り込み結果に問題がなければ削除して構いません。")
    return merged


def run_download_universe(client):
    plan = PLAN if PLAN in RATE_LIMITS else "free"
    print("=" * 70)
    print("STEP 2: 決算・株価データのダウンロード（全銘柄バッチ処理）")
    print("=" * 70)

    universe = load_universe()
    if MARKET_FILTERS:
        universe = [c for c in universe if c["market"] in MARKET_FILTERS]
    if not universe:
        raise SystemExit(
            f"対象銘柄が0件です。対象市場区分（現在:{'／'.join(MARKET_FILTERS)}）や "
            f"{UNIVERSE_FILENAME} の内容をご確認ください。"
        )

    output_filename = auto_output_filename()
    # 旧形式（市場区分ごとのファイル）が残っていれば、統合を提案して引き継ぐ。
    merge_legacy_outputs(output_filename)
    existing_companies = load_existing_output(output_filename)

    print(f"\n対象市場区分: {'／'.join(MARKET_FILTERS) if MARKET_FILTERS else '全市場'}")
    per_market = {}
    for c in universe:
        per_market[c["market"]] = per_market.get(c["market"], 0) + 1
    for m in MARKET_FILTERS:
        print(f"  {m}: {per_market.get(m, 0)}社")

    # 既存の出力ファイルがある場合、続きから追加するか全件取り直すかを確認する。
    # スクリプトに項目を追加した時は取得済みの銘柄も作り直す必要があるため、
    # 「すべて取得済み」で早期リターンする前にこの確認を行う。
    if existing_companies:
        print(f"\n{output_filename} には既に{len(existing_companies)}社ぶんのデータがあります。")
        overwrite = ask_yes_no(
            "上書きしますか？"
            "（yで全銘柄を取り直します。スクリプトに指標を追加した後はyを推奨。"
            "Nなら未取得の銘柄だけを追加します）"
        )
        if overwrite:
            backup_filename = output_filename + ".bak"
            os.replace(output_filename, backup_filename)
            print(f"既存データは {backup_filename} に退避しました"
                  "（新しいデータの取得が完了したら削除して構いません）。")
            existing_companies = []

    existing_codes = {c["code"] for c in existing_companies}
    remaining = [c for c in universe if c["code"] not in existing_codes]

    print(f"対象銘柄数: 全{len(universe)}社 / 取得済み{len(existing_companies)}社 / 残り{len(remaining)}社")

    if not remaining:
        print("\nこの市場区分の銘柄はすべて取得済みです。追加の作業はありません。")
        return

    batch = remaining[: BATCH_SIZE] if BATCH_SIZE else remaining
    print(f"今回処理する銘柄数: {len(batch)}社（BATCH_SIZE={BATCH_SIZE or '無制限'}）")

    requests_per_company = 2 + (1 if FETCH_DIVIDEND else 0)
    est = estimate_seconds(len(batch), requests_per_company, plan)
    workers = max(1, PARALLEL_WORKERS)
    print(f"並列ワーカー数: {workers}（レート上限{RATE_LIMITS.get(plan)}回/分は共有リミッターで遵守します）")
    print(f"推定所要時間: {format_seconds(est)}以上"
          f"（1銘柄あたり{requests_per_company}リクエストと仮定し、レート上限だけで算出した下限値）")

    targets = [{"code": c["code"], "name": c["name"], "sector": c["sector"], "market": c["market"]} for c in batch]

    # 途中経過の保存。中断しても取得済みぶんが残るようにする。
    def checkpoint(partial_companies):
        save_output(output_filename, existing_companies + partial_companies,
                    {"inProgress": True, "processedThisRun": len(partial_companies)})

    results, new_companies, interrupted = run_batch(
        client, targets, need_market_lookup=False, desc="ダウンロード中",
        workers=workers, on_checkpoint=checkpoint, checkpoint_every=SAVE_EVERY,
    )

    success_count, partial_count, failed_count, skipped_count = print_summary(results, len(targets))

    merged_companies = existing_companies + new_companies
    run_stats = {
        "successCount": success_count, "partialCount": partial_count,
        "failedCount": failed_count, "skippedCount": skipped_count,
        "processedThisRun": len(results),
        "interrupted": interrupted,
    }
    save_output(output_filename, merged_companies, run_stats)
    print(f"\n{output_filename} に保存しました"
          f"（累計{len(merged_companies)}社 / {format_bytes(os.path.getsize(output_filename))}）。")
    if INCLUDE_RAW_STATEMENTS and os.path.getsize(output_filename) > 150 * 1024 * 1024:
        print("　※ ファイルが大きいため、ブラウザでの読み込みに時間がかかることがあります。"
              "四半期データを使う予定がなければ INCLUDE_RAW_STATEMENTS = False にすると"
              "1/7程度まで小さくなります（その場合は上書き取得が必要です）。")

    remaining_after = len(remaining) - len(results)
    if interrupted or remaining_after > 0:
        print(f"\nまだ{remaining_after}社残っています。"
              "同じ設定のままスクリプトを再実行すると、続きから処理されます。")
    else:
        print(f"\n{'／'.join(MARKET_FILTERS)}の銘柄はすべて処理が完了しました。")

    download_to_colab_if_available(output_filename)


def run_download_legacy():
    plan = PLAN if PLAN in RATE_LIMITS else "free"
    print("=" * 70)
    print(f"J-Quants API V2 ダウンロード（TARGET_MODE=\"{TARGET_MODE}\"、動作確認用）")
    print("=" * 70)

    if TARGET_MODE == "custom":
        targets = [{"code": c, "name": None, "sector": None, "market": None} for c in CUSTOM_CODES]
    else:
        targets = [{"code": c, "name": n, "sector": s, "market": None} for c, n, s in COMPANIES_RAW]

    print(f"ダウンロード対象: {len(targets)}社")
    requests_per_company = 2 + (1 if FETCH_MARKET or MARKET_FILTERS else 0) + (1 if FETCH_DIVIDEND else 0)
    est = estimate_seconds(len(targets), requests_per_company, plan)
    print(f"推定所要時間: {format_seconds(est)}以上")

    client = connect(plan)

    results, companies, _ = run_batch(
        client, targets, need_market_lookup=True, desc="ダウンロード中",
        workers=max(1, PARALLEL_WORKERS),
    )
    success_count, partial_count, failed_count, skipped_count = print_summary(results, len(targets))

    if not companies:
        raise SystemExit("\n1社もデータを取得できませんでした。APIキー・プラン・銘柄コードをご確認ください。")

    filename = OUTPUT_FILENAME or f"jquants_dataset_{datetime.now().strftime('%Y-%m-%d')}.json"
    run_stats = {
        "successCount": success_count, "partialCount": partial_count,
        "failedCount": failed_count, "skippedCount": skipped_count, "total": len(targets),
    }
    save_output(filename, companies, run_stats)
    print(f"\nJSONファイルを保存しました: {filename}")
    download_to_colab_if_available(filename)

    print("\n完了しました。このJSONファイルを、サイトの「データ管理」モーダル内"
          "「JSONを読み込む」からアップロードしてください。")


# ================================ エントリポイント ==============================
def ask_yes_no(question, default_no=True):
    suffix = "[y/N]" if default_no else "[Y/n]"
    # Windows環境ではBOM等の不可視文字が混入することがあるため除去してから判定する。
    answer = input(f"{question} {suffix}: ").strip().replace("﻿", "").lower()
    if not answer:
        return not default_no
    return answer in ("y", "yes")


# 市場区分の選択肢（表示順）。その他区分・TOKYO PRO MARKETは対象外。
MARKET_MENU = ["東証プライム", "東証スタンダード", "東証グロース"]


def ask_market_filters(current):
    """ダウンロード対象の市場区分を聞く。3市場をまとめて選べる。
    ・0（またはEnter）… すべて
    ・1 / 2 / 3       … 単独指定
    ・"1,3" のようにカンマ区切りで複数指定も可
    """
    print("\nダウンロードする市場区分を選んでください:")
    print("  0: すべて（プライム＋スタンダード＋グロース）← 既定")
    for i, m in enumerate(MARKET_MENU, start=1):
        print(f"  {i}: {m}")
    print("（カンマ区切りで複数選択もできます。例: 1,3）")
    current_label = "すべて" if set(current) == set(MARKET_MENU) else "／".join(current)
    raw = input(f"番号を入力（Enterで「{current_label}」のまま）: ").strip().replace("﻿", "")
    if not raw:
        return current

    tokens = [t.strip() for t in raw.replace("、", ",").split(",") if t.strip()]
    if "0" in tokens:
        return list(MARKET_MENU)

    picked = []
    for t in tokens:
        if t.isdigit() and 1 <= int(t) <= len(MARKET_MENU):
            m = MARKET_MENU[int(t) - 1]
            if m not in picked:
                picked.append(m)
    if not picked:
        print("認識できない入力のため、現在の設定のまま進めます。")
        return current
    return picked


def main():
    if TARGET_MODE != "universe":
        run_download_legacy()
        return

    if os.path.exists(UNIVERSE_FILENAME):
        need_fetch_universe = ask_yes_no(
            f"{UNIVERSE_FILENAME} は既に存在します。上場銘柄一覧を再取得しますか？"
            "（最新の銘柄構成に更新したい場合のみyを推奨。通常は不要です）"
        )
    else:
        print(f"{UNIVERSE_FILENAME} が見つからないため、上場銘柄一覧を取得します。")
        need_fetch_universe = True

    global MARKET_FILTERS
    MARKET_FILTERS = ask_market_filters(MARKET_FILTERS)

    # APIキーの入力・接続確認は最初の1回だけ行い、以降のステップでは
    # 同じ接続（client）を使い回す（ステップごとに毎回聞かれるのを防ぐ）。
    plan = PLAN if PLAN in RATE_LIMITS else "free"
    client = connect(plan)

    if need_fetch_universe:
        run_fetch_universe(client)

    run_download_universe(client)


if __name__ == "__main__":
    main()
