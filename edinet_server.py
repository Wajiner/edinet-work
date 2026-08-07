# ==========================================================================
# ローカル開発サーバー + EDINET 企業概要プロキシ
# --------------------------------------------------------------------------
# 静的ファイル（index.html等）の配信に加えて、金融庁EDINET APIへの
# プロキシAPIを提供します。
#
#   python edinet_server.py [ポート番号]     # 既定 8010
#
# ブラウザから直接EDINETを呼ばずにこのサーバーを経由させる理由:
#   1. EDINET APIはCORSヘッダを返さないため、ページのJSからは呼べない。
#   2. APIキー（Subscription-Key）をブラウザに置かずサーバー側に留められる。
#   3. 取得結果をディスクにキャッシュでき、同じ銘柄の再表示が即座になる。
#
# APIキーの取得（無料）:
#   https://api.edinet-fsa.go.jp/ の「EDINET API機能」から利用登録すると
#   Subscription-Key が発行されます。実行前に環境変数へ設定してください。
#
#   PowerShell:  $env:EDINET_API_KEY = "取得したキー"
#   bash:        export EDINET_API_KEY="取得したキー"
#
# 提供するエンドポイント:
#   GET /api/edinet/status              … APIキー有無・銘柄索引の構築状況
#   POST /api/edinet/index/build        … 銘柄索引の構築を開始（バックグラウンド）
#   GET /api/edinet/overview?code=3905  … その銘柄の【事業の内容】を返す
# ==========================================================================

import html
import http.server
import io
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import date, datetime, timedelta

API_BASE = "https://api.edinet-fsa.go.jp/api/v2"

# キャッシュの保存先
CACHE_DIR = "edinet_cache"
INDEX_FILE = os.path.join(CACHE_DIR, "index.json")

# 有価証券報告書の書類種別コード
DOCTYPE_ANNUAL_REPORT = "120"

# 銘柄索引を何日ぶん遡って作るか。有価証券報告書は決算期末から3か月以内の
# 提出が義務付けられており、決算期末は会社ごとに異なるため、全社の最新有報を
# 拾うには1年分＋提出猶予の3か月が必要になる。
INDEX_LOOKBACK_DAYS = 400

# 索引の有効期限（日）。これを過ぎたら古い扱いにして再構築を促す。
INDEX_MAX_AGE_DAYS = 30

# EDINETへの連続リクエスト間隔（秒）。公表された明示的なレート上限は無いが、
# 索引構築で数百回叩くため、負荷をかけすぎないよう間隔を空ける。
REQUEST_INTERVAL = 0.25

# 【事業の内容】が入るXBRL要素ID。会社によって連結/単体の別があるため
# 前方一致で拾う。
BUSINESS_ELEMENT_IDS = [
    "jpcrp_cor:DescriptionOfBusinessTextBlock",
]
# 事業の内容が取れなかった場合に代わりに使う要素（沿革・企業集団の状況）。
FALLBACK_ELEMENT_IDS = [
    "jpcrp_cor:CompanyHistoryTextBlock",
    "jpcrp_cor:OverviewOfBusinessTextBlock",
]


# ============================ ユーティリティ ==============================
def api_key():
    return os.environ.get("EDINET_API_KEY", "").strip()


def ensure_cache_dir():
    os.makedirs(CACHE_DIR, exist_ok=True)


def normalize_codes(code):
    """サイト側の銘柄コード（4桁 '3905' / 英字入り '325A'）から、EDINETの
    secCode（5桁・末尾0埋め）の候補を作る。EDINETは5桁で持っているため、
    4桁のまま突き合わせると一致しない。"""
    s = str(code or "").strip().upper()
    if not s:
        return []
    candidates = [s]
    if len(s) == 4:
        candidates.append(s + "0")
    if len(s) == 5 and s.endswith("0"):
        candidates.append(s[:4])
    return candidates


def strip_html(raw):
    """XBRLのテキストブロックはHTML断片で入っているため、表示用に地の文へ均す。"""
    if not raw:
        return ""
    text = raw
    # 表組みや改行要素は区切りとして残さないと単語が繋がって読めなくなる。
    text = re.sub(r"(?i)<\s*(br|/p|/div|/tr|/h[1-6])\s*/?\s*>", "\n", text)
    text = re.sub(r"(?i)<\s*/?\s*t[dh][^>]*>", " ", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    # 全角スペースも含めて詰める
    text = text.replace("　", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


def make_lead(text, limit=220):
    """パネルに畳んで出すためのリード文（先頭の1〜2文）を作る。"""
    if not text:
        return ""
    # 見出し行（「1 事業の内容」等）だけの行は読み飛ばして本文から始める。
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    body = ""
    for ln in lines:
        if len(ln) < 15 and re.match(r"^[０-９0-9\s．.、,（(]*[事業の内容企業集団状況]*$", ln):
            continue
        body = ln
        break
    if not body:
        body = lines[0] if lines else ""
    if len(body) <= limit:
        return body
    cut = body[:limit]
    # 句点で切れると自然に読める
    dot = cut.rfind("。")
    return (cut[: dot + 1] if dot > limit * 0.5 else cut + "…")


# ============================ EDINET API 呼び出し ==========================
class EdinetError(RuntimeError):
    pass


def edinet_get(path, params, expect_json=True, timeout=60):
    key = api_key()
    if not key:
        raise EdinetError("EDINET_API_KEY が設定されていません。")
    q = dict(params or {})
    q["Subscription-Key"] = key
    url = f"{API_BASE}{path}?{urllib.parse.urlencode(q)}"
    req = urllib.request.Request(url, headers={"User-Agent": "jquants-work/1.0 (local tool)"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
    if expect_json:
        data = json.loads(body.decode("utf-8"))
        # EDINETはHTTP 200のままボディに401等を入れて返すことがある。
        status = (data.get("metadata") or {}).get("status") or data.get("StatusCode")
        if str(status) not in ("200", "None", "none") and status is not None:
            msg = (data.get("metadata") or {}).get("message") or data.get("message") or ""
            raise EdinetError(f"EDINET応答エラー (status={status}): {msg}")
        return data
    return body


# ---------------------------- 銘柄索引 ------------------------------------
_index_lock = threading.Lock()
_index_state = {
    "building": False,
    "progress": 0,
    "total": 0,
    "error": None,
}


def load_index():
    if not os.path.exists(INDEX_FILE):
        return None
    try:
        with open(INDEX_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def index_age_days(idx):
    if not idx or not idx.get("builtAt"):
        return None
    try:
        built = datetime.fromisoformat(idx["builtAt"])
    except ValueError:
        return None
    return (datetime.now() - built).days


def build_index_worker():
    """提出日を遡って走査し、secCode -> 最新の有価証券報告書docID の索引を作る。

    EDINETの書類一覧APIは「提出日」でしか引けず、銘柄コードでの検索ができない。
    そのため一度全期間を走査して索引を作り、以降はそれを使う。"""
    global _index_state
    ensure_cache_dir()
    entries = {}
    today = date.today()
    days = [today - timedelta(days=i) for i in range(INDEX_LOOKBACK_DAYS)]

    with _index_lock:
        _index_state.update({"building": True, "progress": 0, "total": len(days), "error": None})

    try:
        for i, d in enumerate(days):
            try:
                data = edinet_get("/documents.json", {"date": d.isoformat(), "type": "2"})
            except Exception as e:
                # 土日祝は提出が無く、EDINETが404相当を返すことがある。
                # 1日ぶん取れなくても索引全体は成立するため続行する。
                msg = str(e)
                if "404" in msg or "Not Found" in msg:
                    with _index_lock:
                        _index_state["progress"] = i + 1
                    continue
                raise

            for doc in data.get("results") or []:
                if doc.get("docTypeCode") != DOCTYPE_ANNUAL_REPORT:
                    continue
                sec = (doc.get("secCode") or "").strip()
                if not sec:
                    continue
                submit = doc.get("submitDateTime") or ""
                prev = entries.get(sec)
                # 同じ会社の有報が複数年ぶん出てくるので、提出日が新しい方を残す。
                if not prev or submit > prev.get("submitDateTime", ""):
                    entries[sec] = {
                        "docID": doc.get("docID"),
                        "filerName": doc.get("filerName"),
                        "periodEnd": doc.get("periodEnd"),
                        "submitDateTime": submit,
                        "docDescription": doc.get("docDescription"),
                    }

            with _index_lock:
                _index_state["progress"] = i + 1
            time.sleep(REQUEST_INTERVAL)

        payload = {
            "builtAt": datetime.now().isoformat(timespec="seconds"),
            "lookbackDays": INDEX_LOOKBACK_DAYS,
            "count": len(entries),
            "entries": entries,
        }
        tmp = INDEX_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp, INDEX_FILE)
        with _index_lock:
            _index_state.update({"building": False})
    except Exception as e:
        with _index_lock:
            _index_state.update({"building": False, "error": str(e)})


def start_index_build():
    with _index_lock:
        if _index_state["building"]:
            return False
    t = threading.Thread(target=build_index_worker, daemon=True)
    t.start()
    return True


# ---------------------------- 書類本文の取得 -------------------------------
def decode_csv_bytes(raw):
    """EDINETのCSVはUTF-16LE(BOM付き)で出力されるが、将来変わる可能性もあるため
    BOMを見て判定する。BOMを見ずに順に試すと、UTF-8のバイト列がUTF-16として
    「エラーなく」文字化けしたまま復号されてしまい、判定に使えない。"""
    if not raw:
        return ""
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        enc = "utf-16"
    elif raw[:3] == b"\xef\xbb\xbf":
        enc = "utf-8-sig"
    else:
        enc = None
    if enc:
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    for fallback in ("utf-8", "cp932"):
        try:
            return raw.decode(fallback)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def extract_from_csv_zip(blob):
    """type=5（CSV）のZIPから【事業の内容】を取り出す。
    EDINETのCSVはUTF-16LE・タブ区切りで出力される。"""
    out = {}
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        for name in zf.namelist():
            if not name.lower().endswith(".csv"):
                continue
            text = decode_csv_bytes(zf.read(name))
            if not text:
                continue
            for line in text.splitlines():
                cols = line.split("\t")
                if len(cols) < 2:
                    continue
                element = cols[0].strip().strip('"')
                if element in BUSINESS_ELEMENT_IDS or element in FALLBACK_ELEMENT_IDS:
                    # 値は最終列に入る
                    value = cols[-1].strip().strip('"')
                    if value and element not in out:
                        out[element] = value
    return out


def extract_from_xbrl_zip(blob):
    """type=1（XBRL一式）のZIPから【事業の内容】を取り出す（CSVが取れない場合の代替）。"""
    out = {}
    targets = BUSINESS_ELEMENT_IDS + FALLBACK_ELEMENT_IDS
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        for name in zf.namelist():
            # 本文XBRLは PublicDoc 配下の .xbrl
            if not (name.endswith(".xbrl") and "PublicDoc" in name):
                continue
            raw = zf.read(name).decode("utf-8", errors="replace")
            for element in targets:
                tag = element.split(":")[-1]
                m = re.search(
                    rf"<[\w.-]*:?{re.escape(tag)}\b[^>]*>(.*?)</[\w.-]*:?{re.escape(tag)}>",
                    raw, re.S,
                )
                if m and element not in out:
                    out[element] = m.group(1)
    return out


def fetch_overview(code):
    """銘柄コードから【事業の内容】を取得して整形して返す。"""
    ensure_cache_dir()
    cache_path = os.path.join(CACHE_DIR, f"overview_{re.sub(r'[^A-Za-z0-9]', '', str(code))}.json")
    if os.path.exists(cache_path):
        try:
            with open(cache_path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            pass

    idx = load_index()
    if not idx:
        raise EdinetError("INDEX_NOT_READY")

    entry = None
    for cand in normalize_codes(code):
        if cand in idx.get("entries", {}):
            entry = idx["entries"][cand]
            break
    if not entry:
        result = {
            "code": str(code),
            "found": False,
            "message": "EDINETに直近の有価証券報告書が見つかりませんでした。"
                       "（上場から日が浅い、または報告書の提出前の可能性があります）",
        }
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)
        return result

    doc_id = entry["docID"]
    fields = {}
    # まずCSV（軽く、解析も容易）。失敗したらXBRL一式にフォールバックする。
    try:
        blob = edinet_get(f"/documents/{doc_id}", {"type": "5"}, expect_json=False, timeout=120)
        fields = extract_from_csv_zip(blob)
    except Exception:
        fields = {}
    if not any(k in fields for k in BUSINESS_ELEMENT_IDS):
        try:
            blob = edinet_get(f"/documents/{doc_id}", {"type": "1"}, expect_json=False, timeout=180)
            fields.update(extract_from_xbrl_zip(blob))
        except Exception as e:
            if not fields:
                raise EdinetError(f"書類の取得に失敗しました: {e}")

    raw = None
    for key in BUSINESS_ELEMENT_IDS + FALLBACK_ELEMENT_IDS:
        if fields.get(key):
            raw = fields[key]
            break

    text = strip_html(raw)
    result = {
        "code": str(code),
        "found": bool(text),
        "filerName": entry.get("filerName"),
        "periodEnd": entry.get("periodEnd"),
        "submitDate": (entry.get("submitDateTime") or "")[:10],
        "docId": doc_id,
        "lead": make_lead(text),
        "text": text,
        "source": "EDINET（金融庁）有価証券報告書 【事業の内容】",
    }
    if not text:
        result["message"] = "有価証券報告書から事業の内容を抽出できませんでした。"
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    return result


# ============================== HTTPハンドラ ===============================
class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _status_payload(self):
        idx = load_index()
        with _index_lock:
            state = dict(_index_state)
        return {
            "hasApiKey": bool(api_key()),
            "indexReady": bool(idx),
            "indexCount": (idx or {}).get("count", 0),
            "indexBuiltAt": (idx or {}).get("builtAt"),
            "indexAgeDays": index_age_days(idx),
            "indexStale": (index_age_days(idx) or 0) > INDEX_MAX_AGE_DAYS if idx else False,
            "building": state["building"],
            "progress": state["progress"],
            "total": state["total"],
            # キー名を "error" にしない。overviewの503応答は
            # {"error": "INDEX_NOT_READY", **status} の形で返すため、"error" だと
            # 索引構築のエラー（通常はNone）がマーカーを上書きしてしまう。
            "buildError": state["error"],
        }

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/edinet/status":
            self._json(self._status_payload())
            return
        if parsed.path == "/api/edinet/overview":
            qs = urllib.parse.parse_qs(parsed.query)
            code = (qs.get("code") or [""])[0]
            if not code:
                self._json({"error": "code パラメータが必要です。"}, 400)
                return
            if not api_key():
                self._json({
                    "error": "NO_API_KEY",
                    "message": "環境変数 EDINET_API_KEY が設定されていません。",
                }, 503)
                return
            try:
                self._json(fetch_overview(code))
            except EdinetError as e:
                if str(e) == "INDEX_NOT_READY":
                    self._json({"error": "INDEX_NOT_READY", **self._status_payload()}, 503)
                else:
                    self._json({"error": "EDINET_ERROR", "message": str(e)}, 502)
            except Exception as e:
                self._json({"error": "UNEXPECTED", "message": str(e)}, 500)
            return
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/edinet/index/build":
            if not api_key():
                self._json({"error": "NO_API_KEY",
                            "message": "環境変数 EDINET_API_KEY が設定されていません。"}, 503)
                return
            started = start_index_build()
            self._json({"started": started, **self._status_payload()})
            return
        self.send_error(405, "Method Not Allowed")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8010
    ensure_cache_dir()
    idx = load_index()
    print(f"ローカルサーバーを起動します: http://localhost:{port}/")
    if api_key():
        print("EDINET_API_KEY を検出しました。企業概要の取得が利用できます。")
        if not idx:
            print("銘柄索引が未作成です。初回のみ構築が必要です"
                  f"（提出日を{INDEX_LOOKBACK_DAYS}日ぶん走査、数分かかります）。")
            print("サイトの企業概要パネルから「索引を作成」を押すか、"
                  f"curl -X POST http://localhost:{port}/api/edinet/index/build を実行してください。")
        else:
            age = index_age_days(idx)
            print(f"銘柄索引: {idx.get('count', 0)}社（作成 {idx.get('builtAt')} / {age}日前）")
    else:
        print("環境変数 EDINET_API_KEY が未設定のため、企業概要は無効です。")
        print('  PowerShell: $env:EDINET_API_KEY = "取得したキー"')
        print("  取得: https://api.edinet-fsa.go.jp/ の「EDINET API機能」から無料で利用登録")
    http.server.test(HandlerClass=Handler, port=port)
