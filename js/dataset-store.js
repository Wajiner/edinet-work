/* ==========================================================================
   dataset-store.js
   分析対象データセットの管理（サンプル／J-Quantsダウンロード結果）
   ------------------------------------------------------------------------
   ・「一括ダウンロード」で取得した企業データは localStorage にキャッシュし、
     ページを再読み込みしてもログインなしで分析を継続できるようにする。
   ・ダウンロード結果はJSONファイルとして書き出し／読み込みも可能。
   ========================================================================== */

const DatasetStore = (function () {
  const LS_KEY = 'jquants_dataset_v1';
  const LS_META_KEY = 'jquants_dataset_meta_v1';
  const LS_FY_KEY = 'jquants_dataset_fy_v1';

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

  // ---- localStorage への保存・読込 ----
  // fiscalYearsも合わせて保存する（会社によって決算期末月が異なるため、期間配列の
  // 長さがデータセットごとに変わりうる。読込時にFISCAL_YEARS/LATEST_FY_INDEXを
  // 正しい長さへ揃えないと「最新決算期」が誤ったindexを指してしまう）。
  function saveToLocalStorage(companies, meta, fiscalYears) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(companies));
      localStorage.setItem(LS_META_KEY, JSON.stringify(meta || {}));
      localStorage.setItem(LS_FY_KEY, JSON.stringify(fiscalYears || FISCAL_YEARS));
      return true;
    } catch (e) {
      console.warn('localStorageへの保存に失敗しました（データ量が大きい可能性があります）', e);
      return false;
    }
  }

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const companies = JSON.parse(raw);
      const meta = JSON.parse(localStorage.getItem(LS_META_KEY) || '{}');
      const fiscalYears = JSON.parse(localStorage.getItem(LS_FY_KEY) || 'null');
      if (!Array.isArray(companies) || companies.length === 0) return null;
      setFiscalYears(fiscalYears);
      return { companies: colorize(companies), meta };
    } catch (e) {
      console.warn('localStorageの読み込みに失敗しました', e);
      return null;
    }
  }

  function clearLocalStorage() {
    try {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_META_KEY);
      localStorage.removeItem(LS_FY_KEY);
    } catch (e) {}
  }

  function hasCachedDataset() {
    try { return !!localStorage.getItem(LS_KEY); } catch (e) { return false; }
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
    saveToLocalStorage, loadFromLocalStorage, clearLocalStorage, hasCachedDataset,
    exportToFile, importFromFile
  };
})();
