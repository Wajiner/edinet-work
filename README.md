# 株式3Dスクリーナー（日本株 3D財務指標分析ツール）

3つの財務指標の組み合わせによる日本株企業の分布を、3Dバブルチャートで可視化するスクリーニングツールです。データは **EDINET DB**（[edinetdb.jp](https://edinetdb.jp)）から取得した実データを使用しており、サイトを開くだけで自動的に表示されます（ログイン・データの読み込み操作は不要）。

公開URL: https://kabu3d.xyz

## サイトの起動方法（ローカル）

```bash
python serve_nocache.py 8010
```

`public/` フォルダを配信する簡易サーバーです（キャッシュを無効化しているため、コード編集後の確認に向いています）。起動後、ブラウザで `http://localhost:8010` を開きます。

## 現在完成している機能

1. **3Dバブルチャート（Plotly.js使用）**
   - X軸・Y軸・Z軸それぞれに、次の39種類の指標を割り当て可能（分類ごとにグループ表示）。
     - 規模：売上高、営業利益、純利益、時価総額、総資産
     - 利益率：営業利益率、純利益率、営業キャッシュフロー率、研究開発費率
     - 成長率：売上高成長率、営業利益成長率、純利益成長率、売上高CAGR（3年）、営業利益CAGR（3年）、純利益CAGR（3年）
     - 株価評価：PER、PBR、EV/EBITDA倍率、PSR、PEGレシオ、EPS、BPS、基準株価、株価パフォーマンス
     - 資本効率：ROE、ROA、ROIC、魔法の公式ROIC（グリーンブラットROIC）
     - 財務健全性：自己資本比率、配当利回り、配当性向、ネットキャッシュ比率、連続増配年数、フリーキャッシュフロー、FCF利回り、現金等
     - 人的資本：平均年間給与、1人当たり純利益、1人当たり売上高、女性役員比率
   - 球体の大きさ＝時価総額、色＝業種。
   - マウスドラッグで回転、スクロールで拡大縮小、ホバーで企業詳細を表示。
   - 業種凡例をクリックすると該当業種の表示・非表示を切り替え可能。
   - 球体を左クリックすると、その企業の主要財務情報がチャートの下に表示されます。決算期を列、指標を行にした一覧に加え、EDINET DBが生成する**事業概要・AI所見**も表示されます。
   - 球体を右クリックするとその企業をチャートから非表示にできます。

2. **軸の設定（基本指標＋種別＋決算期）**

   軸には「基本指標」を選び、その直下に現れる補助セレクタで内訳（実績／会社予想、決算期）を指定します。決算期は暦年ではなく各社の相対位置（最新決算期から何期前か）で指定します（会社ごとに決算期末月が異なるため）。対数スケールは指標を選んだ時点で自動的に切り替わります（手動変更も可能）。

3. **フィルター機能**
   - 市場区分（東証プライム／スタンダード／グロース）・業種（複数選択）・時価総額の下限・企業名/証券コードのキーワード検索。
   - **指標でフィルター**：X・Y・Z軸に割り当てていない指標でも、種別・決算期を指定した上で最小・最大の範囲で絞り込めます（複数追加可、AND条件）。
   - 市場区分を切り替えると、まだ読み込んでいない市場のデータをその場でサーバーから取得します（詳細は「データの読み込み方式」参照）。

4. **注目企業パネル**：フィルター後の企業を時価総額順に上位12社表示。

5. **分析レポートモーダル**：対象企業数・合計時価総額・平均指標のサマリーと、時価総額上位30社の一覧テーブル。

6. **使い方ガイド・免責事項モーダル**、**レスポンシブ対応**（PC / タブレット / スマートフォン）。

## サイト構成

デプロイ対象は `public/` 配下のみです（Cloudflare Workersの静的アサイン配信、`wrangler.toml` の `[assets] directory` で指定）。リポジトリ直下にはデータ取得・ビルド用のPythonスクリプトやキャッシュが置かれていますが、これらは公開サイトには含まれません。

```
wrangler.toml                      Cloudflare Workers（静的アサイン配信）のデプロイ設定
public/
  index.html                       メイン画面（ヘッダー、軸設定、チャート、注目企業、モーダル群）
  _headers                         Cloudflare向けキャッシュ設定（data/*.jsonにCache-Control付与）
  robots.txt / sitemap.xml         検索エンジン向け（クロール許可・サイトマップ）
  og-image.png                     SNS共有時のプレビュー画像（generate_og_image.py で生成）
  css/style.css                    カスタムスタイル（直接編集可・ビルド不要）
  css/tailwind.css                 Tailwind CSSのビルド成果物（直接編集しない。「CSSのビルド」参照）
  js/data.js                       業種カラー定義・埋め込みサンプルデータ（実データ取得失敗時のフォールバック）
  js/metrics.js                    指標定義・期間指定に基づく値算出ロジック
  js/chart.js                      Plotly.js による3Dバブルチャート描画
  js/dataset-store.js              data/manifest.json・市場別JSONのHTTP取得
  js/app.js                        画面初期化・状態管理・イベントハンドリング
  data/
    manifest.json                  各市場区分ファイルの企業数・ファイル名一覧
    prime.json / standard.json / growth.json   市場区分別の企業データ（起動時はprimeのみ自動取得、他は市場フィルタ操作時に遅延取得）

edinetdb_bulk_download.py          EDINET DBから取得しedinetdb_cache/に保存するスクリプト（APIコスト発生）
edinetdb_build_dataset.py          edinetdb_cache/ → public/data/*.json を組み立てるスクリプト（APIコスト無し、何度でも再実行可）
edinetdb_cache/                    取得済みデータのキャッシュ（progress.json・raw/、git管理下で複数PC間共有）
serve_nocache.py                   ローカル動作確認用の簡易サーバー（public/を配信）
edinet_server.py                   （任意・ローカル専用）公式EDINET APIから企業概要を都度取得するプロキシ。後述。
generate_og_image.py               public/og-image.png（SNS共有用画像）を生成するスクリプト
tailwind.config.js                 Tailwind CSSのビルド設定（走査対象・テーマ拡張）
tailwind.input.css                 Tailwind CSSのビルド入力（@tailwindディレクティブのみ）
tools/tailwindcss.exe              Tailwind スタンドアロンCLI（git管理外。「CSSのビルド」参照）
```

## CSSのビルド

Tailwind CSSは以前 `cdn.tailwindcss.com`（ブラウザ上で毎回CSSを生成するPlay CDN）を読み込んでいましたが、公式に本番非推奨で表示速度にも影響するため、事前ビルドした `public/css/tailwind.css` を配信する方式に変更しました。

**HTMLやJSでTailwindのクラスを追加・変更したら、再ビルドが必要です**（`public/css/style.css` の編集は再ビルド不要）。

```bash
./tools/tailwindcss.exe -i tailwind.input.css -o public/css/tailwind.css --minify
```

生成された `public/css/tailwind.css` はコミットしてください。Cloudflare側ではビルドを行わず `public/` をそのまま配信するため、コミットし忘れるとスタイルが古いままデプロイされます。

`tools/tailwindcss.exe` はリポジトリに含めていない（約38MB）ため、新しいPCでは先に取得してください。Node.jsは不要です。

```bash
mkdir -p tools && curl -fL -o tools/tailwindcss.exe https://github.com/tailwindlabs/tailwindcss/releases/download/v3.4.19/tailwindcss-windows-x64.exe
```

`tailwind.config.js` の `content` に `public/index.html` と `public/js/**/*.js` を指定しているため、JS側の文字列として組み立てているクラス（企業詳細パネル・分析レポートなど）も走査対象に含まれます。クラス名を `"text-" + color` のように動的連結すると検出できずスタイルが欠落するため、クラス名は必ずリテラルで書いてください。

## データパイプライン（EDINET DB → 公開サイト）

```
1. edinetdb_bulk_download.py を実行
   → edinetdb_cache/raw/ に生データを保存、progress.jsonで進捗管理（レジューム対応）
2. edinetdb_build_dataset.py を実行
   → public/data/{prime,standard,growth}.json + manifest.json を生成
3. git add . && git commit && git push
   → Cloudflareが自動でビルド・再デプロイ（npx wrangler deploy）
```

1・2は同一PC上で行う必要があります（`edinetdb_cache/`はgit管理下で複数PC間共有されますが、EDINET DBの日次リクエスト上限はPCをまたいで共有されないため、**取得スクリプトの実行は1日1台のみ**にしてください）。コード編集や3も含めた閲覧は何台からでも行えます。

### なぜ市場区分ごとにファイルを分けているか

全社ぶんを1ファイルにすると初回表示が重くなるため、市場区分ごとに分割しています。サイトは起動時に東証プライムのファイルのみを取得し、ユーザーが市場フィルターでスタンダード／グロースを選んだ時点でそのファイルを追加取得します（`js/app.js` の `ensureMarketLoaded()`）。取得したデータはブラウザの通常のHTTPキャッシュに任せており、localStorageへの複製は行いません（データ量の増加でlocalStorageの上限を超えるため）。

## データモデル

### EDINET DBの取得元エンドポイント

`/financials`（実績財務諸表）・`/ratios`（財務指標）・`/earnings`（決算短信ベース、会社予想を含む）・`/companies/{code}`（事業の内容）・`/companies/{code}/analysis`（AI所見）の5エンドポイントを1社あたり取得します。

### 単位換算

- `/financials`・`/ratios`の金額フィールドは円 → サイトでは億円に変換（`/1e8`）。
- `/earnings`の金額フィールドは百万円 → 億円に変換（`/100`）。
- 比率フィールド（ROE・ROA・利益率など）はEDINET DB側が小数（例: `0.12`）で返すため ×100 して%表示にしています。

### 期間の扱い

EDINET DBのレスポンスは決算月を明示するフィールドを持たないため、会社ごとに `fiscal_year`（年のみ）をソートして直近15期分をtail-alignしています。決算月が取れた場合（`/earnings`の`fiscal_year_end`）は `"2025/03期"` 形式のラベルを付与し、取れない場合は `"2025年度"` にフォールバックします。

### 会社予想（フォーキャスト）

`/earnings`の最新開示レコード（`forecast_revenue`等）を「現在の会社予想」として最新スロットにのみ付与します。過去の期の予想値は復元できません（EDINET DBが保持するのは直近の開示のみのため）。

### 既知の制約

- **基準株価（`refPrice`）は常にnullです。** EDINET DBには基準株価そのものを示すフィールドが無く、PER・PBR・時価総額はEDINET DB側で計算済みの値をそのまま使っています。この制約により、基準株価を要する「株価パフォーマンス」指標は算出できません。
- 予想PERは、実績PER×実績EPSから逆算した想定株価に予想EPSを適用して算出しています（直接の基準株価が無いための近似）。

## AI所見・事業概要についての著作権表示

企業詳細パネルに表示される事業概要・AI所見はEDINET DBの提供データです。EDINET DBの利用規約に基づき、以下を表示しています。

- 「Powered by EDINET DB」のクレジット表示（フッター・詳細パネル）
- AI所見に関する注意書き：「AI所見はLLMによる自動生成であり、事実と異なる記述を含む可能性があります。投資判断・与信判断の根拠として使用しないでください。」

## 複数PCでの開発

```bash
git clone https://github.com/Wajiner/edinet-work.git
cd edinet-work
$env:EDINETDB_API_KEY = "取得したキー"
```

`.gitignore`によりAPIキーは同期されないため、各PCで環境変数の設定が必要です。データ取得スクリプトは前述の通り1日1台のみで実行してください。

## デプロイ

Cloudflare Workers（静的アサイン配信）に、GitHubリポジトリ（`Wajiner/edinet-work`）を接続してあります。`main`ブランチへの`git push`のたびに自動で再ビルド・再デプロイされます。`wrangler.toml`で配信対象を`./public`に指定しています。

## 技術スタック

- HTML5 / CSS3（Tailwind CSS CDN）/ JavaScript（Vanilla JS）
- [Plotly.js](https://plotly.com/javascript/) … 3Dバブルチャート描画
- [Font Awesome](https://fontawesome.com/) … アイコン
- Google Fonts（Noto Sans JP）
- [EDINET DB](https://edinetdb.jp/) … 実データの取得元（Pythonスクリプト経由）
- Cloudflare Workers（静的アサイン配信） … ホスティング

## セキュリティに関する重要な注意

APIキーをチャットやコード内に直接書き込んで共有・保存しないでください。`edinetdb_bulk_download.py`は環境変数からのみAPIキーを読み込む設計になっています。もし過去にAPIキーをどこかに貼り付けて共有してしまった場合は、EDINET DBのダッシュボードでAPIキーを再発行（ローテーション）することを強くお勧めします。

## 免責事項

本ツールは情報提供・分析支援を目的とした可視化ツールであり、投資勧誘を目的としたものではありません。表示データはEDINET DBから取得した実データですが、取得元APIの仕様・制限により正確性・完全性は保証されません。事業概要・AI所見はLLMによる自動生成を含み、事実と異なる記述を含む可能性があります。投資判断は必ず有価証券報告書等の一次情報をご確認の上、自己責任で行ってください。
