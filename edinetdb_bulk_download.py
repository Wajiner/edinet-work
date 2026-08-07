# ==========================================================================
# EDINET DB (edinetdb.jp) 一括ダウンロードスクリプト
# --------------------------------------------------------------------------
# 財務データの取得元をJ-Quantsからライセンス上安全なEDINET DB(edinetdb.jp)へ
# 切り替えるためのスクリプト。実行すると以下の流れになります。
#
#   0. companies_master.json（EDINET DB移行対象の企業リスト）が無ければ、
#      listed_universe.json（jquants_v2_bulk_download.pyが取得した東証プライム
#      上場企業一覧、J-Quants無料枠で取得可）とEDINET DBの全上場企業一覧
#      (/v1/companies)を証券コードで突き合わせて構築します。
#      EDINET DBの企業一覧には東証の市場区分（プライム/スタンダード/グロース）
#      が含まれていないため、市場区分の判定にはJ-Quants側のデータを使います。
#   1. 1社につき /financials（財務諸表、6年分）・/ratios（財務指標、15年分）・
#      /earnings（決算短信ベース、業績予想を含む）・/companies/{code}（企業詳細、
#      事業概要）・/companies/{code}/analysis（AI要約）の5リクエストを取得し、
#      edinetdb_cache/raw/ に永続キャッシュします。既に取得済みのエンドポイント
#      は（ローリング・リフレッシュ時を除き）再取得しないため、後からエンド
#      ポイントを追加してもキャッシュ済みの分は無駄になりません。
#   2. Proプラン等の日次リクエスト上限があるため、実行のたびに「本日は何
#      リクエストまで使うか」を聞かれます。全銘柄が終わるまで、日をまたいで
#      何度でもこのスクリプトを再実行してください（続きから処理されます）。
#   3. 初回の全銘柄取得が完了した後も、同じコマンドを実行するだけで「最後に
#      取得してから最も時間が経っている銘柄」から順に再取得します
#      （ローリング・リフレッシュ）。取得したキャッシュには有効期限が無いため、
#      これは鮮度を保つための自発的な更新運用です。
#
# このスクリプト自体はサイト用のJSONを作りません。取得したキャッシュから
# サイト用データセットを組み立てるには edinetdb_build_dataset.py を実行して
# ください（こちらはAPIを呼ばないため、何度でも無料で再実行できます）。
# ==========================================================================

import getpass
import json
import os
import time
from datetime import date, datetime, timezone

import requests

# ============================== 設定 ======================================

API_BASE = "https://edinetdb.jp/v1"

# どのディレクトリから実行されても迷子にならないよう、相対パスは実行時の
# カレントディレクトリではなく、このスクリプト自身の場所を基準にする。
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 市場区分の絞り込み。listed_universe.json の market フィールドと一致させる。
MARKET_FILTER = "東証プライム"

# 既存のJ-Quantsスクリプトが作る上場銘柄一覧（市場区分の判定に使う）。
UNIVERSE_FILENAME = os.path.join(BASE_DIR, "listed_universe.json")

CACHE_DIR = os.path.join(BASE_DIR, "edinetdb_cache")
RAW_DIR = os.path.join(CACHE_DIR, "raw")
MASTER_FILE = os.path.join(CACHE_DIR, "companies_master.json")
PROGRESS_FILE = os.path.join(CACHE_DIR, "progress.json")
DAILY_USAGE_FILE = os.path.join(CACHE_DIR, "daily_usage.json")

# 1社ぶん取得するエンドポイント一覧。(種別キー, パステンプレート, パラメータ)。
# パステンプレートの {ec} は edinet_code に置換される。
YEARS_FINANCIALS = 6
YEARS_RATIOS = 15
ENDPOINTS = [
    ("financials", "/companies/{ec}/financials", {"years": YEARS_FINANCIALS}),
    ("ratios", "/companies/{ec}/ratios", {"years": YEARS_RATIOS}),
    ("earnings", "/companies/{ec}/earnings", {}),
    ("profile", "/companies/{ec}", {}),
    ("analysis", "/companies/{ec}/analysis", {}),
]
REQUESTS_PER_COMPANY = len(ENDPOINTS)

# 本日の既定リクエスト予算（Proプラン日次上限1,000から安全マージンを取った値）。
DEFAULT_DAILY_BUDGET = 950

# 失敗した銘柄を再試行する上限回数。これを超えたら日次の対象から除外する
# （EDINETコードが実質存在しない等、恒久的な失敗をキューに残さないため）。
MAX_ATTEMPTS = 5

# リクエスト間隔（秒）。EDINET DBは分単位のレート上限を明記していないため、
# 保守的な固定間隔から始める。
REQUEST_INTERVAL = 0.4


# ========================== 補助関数 =======================================
def normalize_codes(code):
    """4桁の証券コード（例:'7203'）から、EDINET DBが使う5桁sec_code（末尾0埋め、
    例:'72030'）の候補を作る。英字入り銘柄コードにも対応。"""
    s = str(code or "").strip().upper()
    if not s:
        return []
    candidates = [s]
    if len(s) == 4:
        candidates.append(s + "0")
    if len(s) == 5 and s.endswith("0"):
        candidates.append(s[:4])
    return candidates


def atomic_write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def ask_yes_no(question, default_no=True):
    suffix = "[y/N]" if default_no else "[Y/n]"
    answer = input(f"{question} {suffix}: ").strip().replace("﻿", "").lower()
    if not answer:
        return not default_no
    return answer in ("y", "yes")


def ask_int(question, default):
    raw = input(f"{question}（既定{default}）: ").strip().replace("﻿", "")
    if not raw:
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        print("数値として認識できなかったため、既定値を使用します。")
        return default


# ============================ API呼び出し ===================================
class EdinetDBClient:
    def __init__(self, api_key):
        self.api_key = api_key
        self.session = requests.Session()
        self._last_request_time = 0.0

    def get(self, path, params=None, max_retries=3):
        """(status_code, payload) を返す。ネットワーク例外時は status_code=0。"""
        for attempt in range(max_retries + 1):
            wait = REQUEST_INTERVAL - (time.monotonic() - self._last_request_time)
            if wait > 0:
                time.sleep(wait)
            self._last_request_time = time.monotonic()
            try:
                resp = self.session.get(
                    f"{API_BASE}{path}",
                    headers={"X-API-Key": self.api_key},
                    params=params,
                    timeout=30,
                )
            except requests.RequestException as e:
                if attempt < max_retries:
                    time.sleep(2 * (attempt + 1))
                    continue
                return 0, {"error": str(e)}

            if resp.status_code == 429 and attempt < max_retries:
                retry_after = resp.headers.get("Retry-After")
                time.sleep(float(retry_after) if retry_after else 5 * (attempt + 1))
                continue
            if resp.status_code >= 500 and attempt < max_retries:
                time.sleep(3 * (attempt + 1))
                continue
            try:
                return resp.status_code, resp.json()
            except ValueError:
                return resp.status_code, {"error": "invalid JSON", "text": resp.text[:300]}
        return 0, {"error": "リトライ上限に達しました。"}


def get_api_key():
    key = os.environ.get("EDINETDB_API_KEY", "").strip()
    if key:
        print("環境変数 EDINETDB_API_KEY からAPIキーを読み込みました。")
        return key
    key = getpass.getpass("EDINET DBのAPIキーを入力してください（画面には表示されません）: ").strip()
    if not key:
        raise SystemExit("APIキーが入力されませんでした。処理を中止します。")
    return key


def check_connection(client):
    print("接続確認中...")
    status, payload = client.get("/companies", {"per_page": 1})
    if status != 200:
        raise SystemExit(f"接続確認に失敗しました（HTTP{status}）: {payload}\n"
                          "APIキーが正しいか、プランが有効かご確認ください。")
    print("接続に成功しました。\n")


# ============================ Step0: 企業マスタ構築 ===========================
def build_companies_master(client):
    print("\n" + "=" * 70)
    print("STEP 0: 企業マスタの構築（J-Quants東証プライム一覧 × EDINET DB全社一覧）")
    print("=" * 70)

    if not os.path.exists(UNIVERSE_FILENAME):
        raise SystemExit(
            f"{UNIVERSE_FILENAME} が見つかりません。先に jquants_v2_bulk_download.py を実行し、"
            "上場銘柄一覧（listed_universe.json）を取得してください（J-Quants無料枠で取得できます。"
            "市場区分の判定にのみ使うため、決算・株価データまで取得する必要はありません）。"
        )
    with open(UNIVERSE_FILENAME, encoding="utf-8") as f:
        universe_payload = json.load(f)
    universe_companies = universe_payload.get("companies", [])
    prime = [c for c in universe_companies if c.get("market") == MARKET_FILTER]
    print(f"{UNIVERSE_FILENAME} から{MARKET_FILTER}: {len(prime)}社を抽出しました。")

    print("EDINET DBの全上場企業一覧を取得しています(/v1/companies)...")
    all_edinetdb = []
    page = 1
    while True:
        status, payload = client.get("/companies", {"page": page, "per_page": 5000})
        if status != 200:
            raise SystemExit(f"/v1/companies の取得に失敗しました（HTTP{status}）: {payload}")
        rows = payload.get("data", [])
        all_edinetdb.extend(rows)
        pagination = (payload.get("meta") or {}).get("pagination") or {}
        total_pages = pagination.get("total_pages", 1)
        if page >= total_pages:
            break
        page += 1
    print(f"EDINET DB側の全上場企業: {len(all_edinetdb)}社")

    by_sec_code = {}
    for row in all_edinetdb:
        sec = str(row.get("sec_code") or "").strip()
        if sec:
            by_sec_code[sec] = row

    matched = []
    unmatched = []
    for c in prime:
        hit = None
        for cand in normalize_codes(c["code"]):
            if cand in by_sec_code:
                hit = by_sec_code[cand]
                break
        if hit:
            matched.append({
                "code": c["code"], "edinetCode": hit["edinet_code"],
                "name": c["name"], "sector": c["sector"], "market": c["market"],
                "secCode": hit.get("sec_code"),
            })
        else:
            unmatched.append(c)

    master = {
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "marketFilter": MARKET_FILTER,
        "sourceUniverseFetchedAt": universe_payload.get("fetchedAt"),
        "totalCandidates": len(prime),
        "matchedCount": len(matched),
        "unmatchedCount": len(unmatched),
        "unmatchedSample": unmatched[:20],
        "companies": matched,
    }
    os.makedirs(CACHE_DIR, exist_ok=True)
    atomic_write_json(MASTER_FILE, master)
    print(f"\n{len(matched)}/{len(prime)}社がEDINET DBと突き合わせできました。{MASTER_FILE} に保存しました。")
    if unmatched:
        print(f"突き合わせできなかった{len(unmatched)}社（最大10件表示、廃止・データ未整備等の可能性）:")
        for c in unmatched[:10]:
            print(f"  {c['code']} {c['name']}")


def load_companies_master():
    if not os.path.exists(MASTER_FILE):
        raise SystemExit(f"{MASTER_FILE} が見つかりません。先に企業マスタの構築を行ってください。")
    with open(MASTER_FILE, encoding="utf-8") as f:
        return json.load(f)


# ============================ Step1: 個社データ取得 ===========================
def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {"updatedAt": None, "companies": {}}


def save_progress(progress):
    progress["updatedAt"] = datetime.now(timezone.utc).isoformat()
    atomic_write_json(PROGRESS_FILE, progress)


def load_daily_usage():
    today = date.today().isoformat()
    if os.path.exists(DAILY_USAGE_FILE):
        with open(DAILY_USAGE_FILE, encoding="utf-8") as f:
            data = json.load(f)
        if data.get("date") == today:
            return data
    return {"date": today, "used": 0}


def save_daily_usage(data):
    atomic_write_json(DAILY_USAGE_FILE, data)


def raw_path(ec, kind):
    return os.path.join(RAW_DIR, f"{ec}_{kind}.json")


def missing_endpoint_count(ec):
    """まだraw/に無いエンドポイントの数（＝この銘柄を今から処理するのに
    最低限必要なリクエスト数）。全て揃っていれば0。"""
    return sum(1 for kind, _, _ in ENDPOINTS if not os.path.exists(raw_path(ec, kind)))


def pick_targets(master_companies, progress, max_companies):
    """優先度: 未取得 > 再試行(失敗、attempts昇順) > 更新待ち(古いfetchedAt順)。
    初回のフル構築とローリング・リフレッシュを同じロジックで処理する。
    pending/retryは「まだ無いエンドポイントだけ」取得（force=False）、
    refreshは全エンドポイントを取り直す（force=True、鮮度を保つため）。
    max_companiesは「エンドポイントが1つ以上不足している銘柄」の上限件数
    （実際に消費するリクエスト数は銘柄ごとに異なる。予算チェックは呼び出し側
    でmissing_endpoint_count()を使って行う）。"""
    prog = progress.get("companies", {})
    pending, retry, refresh = [], [], []
    permanent_failed = 0
    for c in master_companies:
        p = prog.get(c["edinetCode"])
        if p is None:
            pending.append(c)
            continue
        status = p.get("status")
        attempts = p.get("attempts", 0)
        if status in ("ok", "partial"):
            refresh.append((p.get("fetchedAt") or "", c))
        elif status == "failed":
            if attempts < MAX_ATTEMPTS:
                retry.append((attempts, c))
            else:
                permanent_failed += 1
        else:
            pending.append(c)
    retry.sort(key=lambda x: x[0])
    refresh.sort(key=lambda x: x[0])
    queue = (
        [dict(c, _force=False) for c in pending]
        + [dict(c, _force=False) for _, c in retry]
        + [dict(c, _force=True) for _, c in refresh]
    )
    counts = {
        "pending": len(pending), "retry": len(retry), "refresh": len(refresh),
        "permanentFailed": permanent_failed,
    }
    return queue[:max_companies], counts


def fetch_company(client, entry, force=False):
    """1社ぶんのエンドポイントを取得し、成功した分だけ raw/ に保存する。
    force=Falseなら既にraw/にあるエンドポイントは再取得しない（レジューム・
    エンドポイント追加時の差分取得用）。force=Trueなら全エンドポイントを
    無条件に取り直す（ローリング・リフレッシュ用）。
    (status_label, endpoints, last_error, requests_used) を返す。"""
    ec = entry["edinetCode"]
    endpoints = {}
    last_error = None
    ok_count = 0
    requests_used = 0
    for kind, path_template, params in ENDPOINTS:
        path = raw_path(ec, kind)
        if not force and os.path.exists(path):
            endpoints[kind] = True
            ok_count += 1
            continue
        status, payload = client.get(path_template.format(ec=ec), params)
        requests_used += 1
        if status == 200:
            atomic_write_json(path, payload)
            endpoints[kind] = True
            ok_count += 1
        else:
            endpoints[kind] = False
            last_error = f"{kind}: HTTP{status} {str(payload)[:200]}"

    if ok_count == len(ENDPOINTS):
        return "ok", endpoints, None, requests_used
    if ok_count > 0:
        return "partial", endpoints, last_error, requests_used
    return "failed", endpoints, last_error, requests_used


def summarize_progress(master_companies, progress):
    prog = progress.get("companies", {})
    counts = {"ok": 0, "partial": 0, "failed": 0, "pending": 0}
    for c in master_companies:
        p = prog.get(c["edinetCode"])
        if p is None:
            counts["pending"] += 1
        else:
            counts[p.get("status", "pending")] = counts.get(p.get("status", "pending"), 0) + 1
    return counts


# ================================ メイン ====================================
def main():
    print("=" * 70)
    print("EDINET DB (edinetdb.jp) 一括ダウンロード")
    print("=" * 70)

    try:
        import truststore
        truststore.inject_into_ssl()
    except ImportError:
        print("[警告] truststore未インストールのため、証明書検証エラーが出る可能性があります。"
              "`pip install truststore` を推奨します。\n")

    api_key = get_api_key()
    client = EdinetDBClient(api_key)
    check_connection(client)

    os.makedirs(RAW_DIR, exist_ok=True)

    need_master = True
    if os.path.exists(MASTER_FILE):
        need_master = ask_yes_no(
            f"{MASTER_FILE} は既に存在します。企業マスタを再構築しますか？"
            "（東証プライムの銘柄構成が変わった場合のみyを推奨。通常は不要です）"
        )
    if need_master:
        build_companies_master(client)

    master = load_companies_master()
    progress = load_progress()

    daily = load_daily_usage()
    print(f"\n本日（{daily['date']}）の消費リクエスト数: {daily['used']}")
    budget = ask_int(
        "本日は何リクエストまで使いますか？（Proプラン日次上限1,000から安全マージンを取った値を推奨）",
        DEFAULT_DAILY_BUDGET,
    )
    remaining_budget = max(0, budget - daily["used"])

    # 優先度キュー全体を取得し、実際の必要リクエスト数（銘柄ごとに、既に
    # raw/にあるエンドポイント分は0）を見ながら、予算内に収まる範囲だけを
    # 今回の実行対象として切り出す。
    full_queue, counts = pick_targets(master["companies"], progress, len(master["companies"]))
    targets = []
    planned_requests = 0
    for c in full_queue:
        need = REQUESTS_PER_COMPANY if c["_force"] else missing_endpoint_count(c["edinetCode"])
        if planned_requests + need > remaining_budget:
            break
        planned_requests += need
        targets.append(c)

    print(f"\n未取得{counts['pending']}社 / 再試行待ち{counts['retry']}社 / "
          f"更新待ち{counts['refresh']}社 / 恒久失敗（対象外）{counts['permanentFailed']}社")
    print(f"本日処理予定: {len(targets)}社（推定{planned_requests}リクエスト、"
          f"残り予算{remaining_budget}リクエスト）")

    if not targets:
        print("\n本日処理する銘柄がありません（予算不足、または全銘柄が最新の状態です）。")
        return

    if not ask_yes_no("この内容で実行しますか？", default_no=False):
        print("中止しました。")
        return

    ok_count = partial_count = failed_count = 0
    processed = 0
    try:
        for i, entry in enumerate(targets, start=1):
            ec = entry["edinetCode"]
            force = entry.get("_force", False)
            tag = "[更新]" if force else ""
            print(f"[{i}/{len(targets)}] {entry['code']} {entry['name']} ({ec}) {tag}...", end=" ", flush=True)
            status_label, endpoints, last_error, requests_used = fetch_company(client, entry, force=force)
            prev = progress["companies"].get(ec, {})
            attempts = 0 if status_label == "ok" else prev.get("attempts", 0) + 1
            progress["companies"][ec] = {
                "code": entry["code"], "name": entry["name"],
                "sector": entry["sector"], "market": entry["market"],
                "status": status_label,
                "fetchedAt": date.today().isoformat() if status_label != "failed" else prev.get("fetchedAt"),
                "attempts": attempts, "lastError": last_error, "endpoints": endpoints,
            }
            daily["used"] += requests_used
            processed += 1
            print(status_label)

            save_progress(progress)
            save_daily_usage(daily)

            if status_label == "ok":
                ok_count += 1
            elif status_label == "partial":
                partial_count += 1
            else:
                failed_count += 1
    except KeyboardInterrupt:
        print("\n\n中断を検知しました。ここまでの結果は保存済みです。"
              "同じコマンドを再実行すると続きから処理されます。")

    print(f"\n今回の実行結果: 成功{ok_count}社 / 一部取得{partial_count}社 / "
          f"失敗{failed_count}社（走査{processed}社）")

    overall = summarize_progress(master["companies"], progress)
    print(f"\n全体の状況: 成功{overall.get('ok', 0)}社 / 一部取得{overall.get('partial', 0)}社 / "
          f"失敗{overall.get('failed', 0)}社 / 未取得{overall.get('pending', 0)}社"
          f"（対象{len(master['companies'])}社）")
    total_missing = sum(missing_endpoint_count(c["edinetCode"]) for c in master["companies"])
    if total_missing > 0:
        days_left = -(-total_missing // DEFAULT_DAILY_BUDGET)  # 切り上げ
        print(f"未取得分の目安: 残り約{total_missing}リクエスト（既定予算で約{days_left}日）")
    else:
        print("全銘柄・全エンドポイントの取得が完了しています。次回以降は自動的にローリング・"
              "リフレッシュ（最も古いデータから再取得）になります。")

    print("\n取得したキャッシュからサイト用データセットを組み立てるには、"
          "edinetdb_build_dataset.py を実行してください（APIを呼ばないため無料で何度でも実行できます）。")


if __name__ == "__main__":
    main()
