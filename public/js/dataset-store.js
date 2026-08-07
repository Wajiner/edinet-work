/* ==========================================================================
   dataset-store.js
   分析対象データセットの管理（サンプル／EDINET DB自動取得）
   ------------------------------------------------------------------------
   ・サイトは起動時に data/manifest.json 経由で市場区分別のデータセット
     （data/prime.json 等）をHTTPでfetchする。ブラウザの通常のHTTPキャッシュに
     任せるため、localStorageへの複製は行わない（企業数が増えるとlocalStorage
     の上限（約5〜10MB）を超えてしまうため）。
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

  return {
    getSample,
    fetchManifest, fetchMarketData
  };
})();
