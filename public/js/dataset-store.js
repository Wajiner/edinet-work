/* ==========================================================================
   dataset-store.js
   分析対象データセットの管理（サンプル／EDINET DB自動取得／JSONファイル）
   ------------------------------------------------------------------------
   ・サイトは起動時に data/manifest.json 経由で市場区分別のデータセット
     （data/prime.json 等）をHTTPでfetchする。ブラウザの通常のHTTPキャッシュに
     任せるため、localStorageへの複製は行わない（企業数が増えるとlocalStorage
     の上限（約5〜10MB）を超えてしまうため）。
   ・手元のJSONファイルを読み込んで一時的に差し替えることも可能（保存はしない）。
   ========================================================================== */

const DatasetStore = (function () {
  function colorize(companies) {
    companies.forEach((c) => {
      c.color = getSectorColor(c.sector);
      c.financials = normalizeFinancials(c.financials);
    });
    return companies;
  }

  function getSample() {
    setFiscalYears(DEFAULT_FISCAL_YEARS);
    return colorize(buildCompanyDataset());
  }

  // ---- data/manifest.json・市場別JSONのHTTP取得 ----
  // サイトと同じオリジンから配信される静的JSONをfetchする。開発環境で
  // data/*.json が未生成、またはネットワークエラーの場合はnullを返し、
  // 呼び出し側でサンプルデータへのフォールバックを行わせる。
  async function fetchManifest() {
    try {
      const res = await fetch('data/manifest.json', { cache: 'default' });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn('data/manifest.json の取得に失敗しました', e);
      return null;
    }
  }

  // 市場別JSON（例: data/prime.json）を取得し、色付け・欠損フィールド補完まで
  // 済ませた companies 配列を返す。取得に失敗した場合は null。
  async function fetchMarketData(file) {
    try {
      const res = await fetch(`data/${file}`, { cache: 'default' });
      if (!res.ok) return null;
      const payload = await res.json();
      const companies = payload.companies || [];
      if (companies.length === 0) return { companies: [], meta: payload.meta || {}, fiscalYears: payload.fiscalYears };
      return { companies: colorize(companies), meta: payload.meta || {}, fiscalYears: payload.fiscalYears };
    } catch (e) {
      console.warn(`data/${file} の取得に失敗しました`, e);
      return null;
    }
  }

  // ---- JSONファイル書き出し・読み込み ----
  function exportToFile(companies, meta) {
    const payload = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      fiscalYears: FISCAL_YEARS,
      meta: meta || {},
      companies
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `jquants_dataset_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const payload = JSON.parse(reader.result);
          const companies = payload.companies || payload; // 単純な配列JSONも許容
          if (!Array.isArray(companies) || companies.length === 0) {
            reject(new Error('企業データが見つかりませんでした。ファイル形式を確認してください。'));
            return;
          }
          // 必須フィールドの簡易検証
          const invalid = companies.find((c) => !c.code || !c.name || !c.financials);
          if (invalid) {
            reject(new Error('データ形式が不正です（code / name / financials が必要です）。'));
            return;
          }
          // FISCAL_YEARS（期間配列の長さ）はcolorize()内のnormalizeFinancialsが
          // 参照するため、企業データを正規化する前に読み込んだファイルの長さへ
          // 揃えておく必要がある。
          setFiscalYears(payload.fiscalYears);
          resolve({ companies: colorize(companies), meta: payload.meta || {}, fiscalYears: FISCAL_YEARS });
        } catch (e) {
          reject(new Error('JSONファイルの解析に失敗しました: ' + e.message));
        }
      };
      reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました。'));
      reader.readAsText(file, 'utf-8');
    });
  }

  return {
    getSample,
    fetchManifest, fetchMarketData,
    exportToFile, importFromFile
  };
})();
