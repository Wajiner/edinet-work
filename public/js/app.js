/* ==========================================================================
   app.js
   画面の初期化・イベントハンドリング・状態管理
   ========================================================================== */

(function () {
  // 実データは開示データ提供期間の制約により直近期以外null（欠損）の企業が
  // 多いため、単年度で成立する指標（成長率以外）をデフォルト軸にしている。
  // 軸は「基本指標＋種別（実績／会社予想）＋決算期」の組で保持する（metrics.jsの
  // createAxis参照）。決算期は軸ごとに独立して選べるため、同じ指標を別の期で
  // X軸とY軸に並べることもできる。
  const AXIS_KEYS = ['x', 'y', 'z'];
  const state = {
    axes: {
      x: createAxis('op_margin'),
      y: createAxis('roe'),
      z: createAxis('per')
    },
    logX: false, logY: false, logZ: true,
    market: 'all',
    activeSectors: new Set(),
    minMarketCap: 0,
    maxMarketCap: Infinity,
    axisValueFilters: { x: { min: -Infinity, max: Infinity }, y: { min: -Infinity, max: Infinity }, z: { min: -Infinity, max: Infinity } },
    // 指標フィルター。軸と同じく種別・決算期を個別に指定できるよう、
    // 指標キーではなく軸オブジェクトを持つ： [{axis, min, max}, ...]
    customFilters: [],
    keyword: '',
    hiddenCodes: new Set() // 右クリックで非表示にした企業コード
  };

  // 既定の実データセット（js/data.js、J-Quants API取得）のメタ情報。
  const DEFAULT_DATASET_META = {
    type: 'default',
    downloadedAt: '2026-07-29T17:58:55.524Z',
    successCount: 0,
    partialCount: 30,
    failedCount: 34,
    total: 124
  };

  let companies = [];
  let datasetMeta = DEFAULT_DATASET_META; // {type:'default'|'live', downloadedAt, ...}
  let manifest = null; // data/manifest.jsonの内容（ライブ取得に成功した場合のみ）
  let loadedMarkets = new Set(); // 遅延読み込み済みの市場区分名（例: '東証プライム'）

  // ---------------- データセット切り替え ----------------
  function setDataset(newCompanies, meta) {
    companies = newCompanies;
    datasetMeta = meta || DEFAULT_DATASET_META;
    state.hiddenCodes = new Set(); // データセットが変わったら非表示指定はリセット
    closeCompanyDetail(); // 前のデータセットの企業を表示したままにしない
    state.activeSectors = new Set(getAllKnownSectors().filter((s) => companies.some((c) => c.sector === s)));
    // データセットによって保持している決算期の数が変わるため、期間セレクタを
    // 作り直し、範囲外になった選択（例: 10期分→6期分）を補正する。
    // renderAxisSubControls は内部で renderAxisFilter を呼ぶので、別途呼び出し不要
    AXIS_KEYS.forEach((k) => renderAxisSubControls(k));
    renderCustomFilters();
    populateSectorFilter();
    populateLegend();
    updateDatasetBadges();
    refreshChart();
  }

  function updateDatasetBadges() {
    const badge = document.getElementById('data-source-badge');
    const updateNote = document.getElementById('data-update-note');
    const providerNote = document.getElementById('data-provider-note');
    const when = datasetMeta.downloadedAt ? new Date(datasetMeta.downloadedAt).toLocaleString('ja-JP') : '不明';
    if (datasetMeta.type === 'live') {
      badge.innerHTML = '<i class="fa-solid fa-circle-check"></i> 実データ表示中';
      updateNote.textContent = `データ更新日: ${when}`;
      providerNote.textContent = '出所: EDINET DB';
    } else {
      badge.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> サンプルデータ表示中';
      updateNote.textContent = `データ更新日: ${when}（J-Quants API取得時点）`;
      providerNote.textContent = '出所: J-Quants API（東証プライム上場30社・サンプル、実データ取得に失敗）';
    }
    badge.className = 'hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200';
  }

  // ---------------- ライブデータの起動時fetch・市場別遅延読み込み ----------------
  function buildLiveMeta(marketMeta) {
    return {
      type: 'live', sourceType: 'edinetdb',
      downloadedAt: manifest.generatedAt,
      market: marketMeta && marketMeta.market
    };
  }

  // 起動時は東証プライムのみfetchする（初回表示を速くするため）。
  // data/manifest.jsonが無い・空のいずれかならfalseを返し、呼び出し側で
  // サンプルデータへフォールバックさせる。
  async function loadLiveDataset() {
    manifest = await DatasetStore.fetchManifest();
    if (!manifest || !manifest.markets) return false;
    const primeInfo = manifest.markets['東証プライム'];
    if (!primeInfo || !primeInfo.companyCount) return false;
    const result = await DatasetStore.fetchMarketData(primeInfo.file);
    if (!result || result.companies.length === 0) return false;
    setFiscalYears(result.fiscalYears);
    loadedMarkets = new Set(['東証プライム']);
    setDataset(result.companies, buildLiveMeta(result.meta));
    return true;
  }

  // 新しく取得した企業を既存のcompaniesへ追加する（ユーザーの現在のフィルター・
  // 非表示指定は維持し、setDataset()のように状態をリセットしない）。
  function mergeCompanies(newCompanies) {
    const existingCodes = new Set(companies.map((c) => c.code));
    const added = newCompanies.filter((c) => !existingCodes.has(c.code));
    if (added.length === 0) return;
    companies = companies.concat(added);
    added.forEach((c) => state.activeSectors.add(c.sector));
    populateSectorFilter();
    populateLegend();
    refreshChart();
  }

  // 市場フィルターで指定された市場（'all'なら未取得の全市場）のデータが
  // まだ読み込まれていなければfetchして companies にマージする。
  async function ensureMarketLoaded(marketValue) {
    if (!manifest || !manifest.markets) return; // サンプルデータ表示中は何もしない
    const targets = marketValue === 'all' ? Object.keys(manifest.markets) : [marketValue];
    const toFetch = targets.filter((m) => !loadedMarkets.has(m) && manifest.markets[m] && manifest.markets[m].companyCount > 0);
    if (toFetch.length === 0) return;
    setLoading(true, `${toFetch.join('・')}のデータを読み込み中...`);
    try {
      const results = await Promise.all(toFetch.map((m) => DatasetStore.fetchMarketData(manifest.markets[m].file)));
      results.forEach((result, i) => {
        loadedMarkets.add(toFetch[i]);
        if (result && result.companies.length) mergeCompanies(result.companies);
      });
    } finally {
      setLoading(false);
    }
  }

  // ---------------- 初期化（軸・市場） ----------------
  function populateAxisSelects() {
    AXIS_KEYS.forEach((k) => {
      const el = document.getElementById(`axis-${k}`);
      const selected = state.axes[k].metric;
      el.innerHTML = METRIC_GROUPS.map((g) =>
        `<optgroup label="${g.label}">` +
        g.keys.map((mk) =>
          `<option value="${mk}" ${mk === selected ? 'selected' : ''}>${METRIC_DEFS[mk].label}</option>`
        ).join('') +
        '</optgroup>'
      ).join('');
      renderAxisSubControls(k);
    });
  }

  function periodOptionsHtml(selectedOffset) {
    return getPeriodOptions().map((p) =>
      `<option value="${p.offset}" ${p.offset === selectedOffset ? 'selected' : ''}>${p.label}</option>`
    ).join('');
  }

  // 指標選択ドロップダウンを初期化
  function populateCustomFilterMetricSelect() {
    const select = document.getElementById('custom-filter-metric-select');
    if (!select) return;
    const options = METRIC_GROUPS.flatMap(g =>
      g.keys.map(k => ({ key: k, label: METRIC_DEFS[k].label }))
    ).sort((a, b) => a.label.localeCompare(b.label, 'ja'));
    select.innerHTML = '<option value="">-- 指標を選択 --</option>' +
      options.map(o => `<option value="${o.key}">${o.label}</option>`).join('');
  }

  // 個別軸のフィルターコンテナを描き直す（軸の設定が変わるたびに呼ぶ）。
  function renderAxisFilter(axisKey) {
    const host = document.getElementById(`axis-${axisKey}-filter`);
    if (!host) return;
    const axis = state.axes[axisKey];
    const def = METRIC_DEFS[axis.metric];
    if (!def) return;
    const filter = state.axisValueFilters[axisKey];
    const minVal = filter.min === -Infinity ? '' : filter.min.toFixed(1);
    const maxVal = filter.max === Infinity ? '' : filter.max.toFixed(1);
    host.innerHTML = `
      <label class="text-[11px] font-semibold text-slate-500 mb-1 block">フィルター（${axisLabel(axis)}）</label>
      <div class="flex gap-2 items-center">
        <input type="number" class="axis-value-min flex-1 px-2 py-1.5 text-xs border border-slate-300 rounded" data-axis="${axisKey}" placeholder="最小" value="${minVal}" step="0.1">
        <span class="text-slate-400 text-xs">〜</span>
        <input type="number" class="axis-value-max flex-1 px-2 py-1.5 text-xs border border-slate-300 rounded" data-axis="${axisKey}" placeholder="最大" value="${maxVal}" step="0.1">
      </div>`;

    host.querySelectorAll('.axis-value-min, .axis-value-max').forEach((input) => {
      input.addEventListener('change', () => {
        const role = input.classList.contains('axis-value-min') ? 'min' : 'max';
        const val = input.value === '' ? (role === 'min' ? -Infinity : Infinity) : parseFloat(input.value);
        state.axisValueFilters[axisKey][role] = val;
        refreshChart();
      });
    });
  }

  // 指標フィルター UI を描き直す。
  // 軸と同じく「種別（実績／会社予想）」「決算期」を個別に指定できるよう、
  // 各フィルターは軸と同じ形の axis オブジェクトを持つ（metrics.jsのcreateAxis参照）。
  function renderCustomFilters() {
    const host = document.getElementById('custom-filters-container');
    if (!host) return;
    const html = state.customFilters.map((f, idx) => {
      const minVal = f.min === -Infinity ? '' : f.min.toFixed(1);
      const maxVal = f.max === Infinity ? '' : f.max.toFixed(1);
      return `
        <div class="custom-filter-group">
          <div class="custom-filter-header">
            <label>${axisLabel(f.axis)}</label>
            <button class="custom-filter-remove" data-index="${idx}" title="削除">✕</button>
          </div>
          <div class="axis-sub custom-filter-sub" data-index="${idx}">${metricSubControlsHtml(f.axis)}</div>
          <div class="custom-filter-inputs">
            <input type="number" class="custom-filter-min" data-index="${idx}" placeholder="最小" value="${minVal}" step="0.1">
            <span class="dash">〜</span>
            <input type="number" class="custom-filter-max" data-index="${idx}" placeholder="最大" value="${maxVal}" step="0.1">
          </div>
        </div>`;
    }).join('');
    host.innerHTML = html;

    host.querySelectorAll('.custom-filter-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        state.customFilters.splice(idx, 1);
        renderCustomFilters();
        refreshChart();
      });
    });

    // 種別・決算期セレクタ。見出しラベル（例「PER・会社予想・1期前」）と補足説明が
    // 選択内容で変わるため、変更のたびにフィルター一覧ごと描き直す。
    host.querySelectorAll('.custom-filter-sub select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const idx = parseInt(sel.closest('.custom-filter-sub').dataset.index, 10);
        const axis = state.customFilters[idx].axis;
        const role = sel.dataset.role;
        if (role === 'variant') axis.variant = sel.value;
        else axis[role] = parseInt(sel.value, 10);
        renderCustomFilters();
        refreshChart();
      });
    });

    host.querySelectorAll('.custom-filter-min, .custom-filter-max').forEach((input) => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.index, 10);
        const role = input.classList.contains('custom-filter-min') ? 'min' : 'max';
        const val = input.value === '' ? (role === 'min' ? -Infinity : Infinity) : parseFloat(input.value);
        state.customFilters[idx][role] = val;
        refreshChart();
      });
    });
  }

  // 指標に応じた「種別・決算期／開始期・終了期」セレクタのHTMLを組み立てる。
  // 軸（X/Y/Z）と、指標フィルターの両方から使う共通部品。
  // 引数の axis オブジェクトはここで正規化（範囲外の期などを補正）される。
  function metricSubControlsHtml(axis) {
    normalizeAxis(axis);
    const def = METRIC_DEFS[axis.metric];
    const parts = [];

    if (def.kind === 'range') {
      parts.push(`
        <div class="axis-sub-row">
          <span class="axis-sub-label">開始期</span>
          <select class="axis-subselect" data-role="fromOffset">${periodOptionsHtml(axis.fromOffset)}</select>
        </div>
        <div class="axis-sub-row">
          <span class="axis-sub-label">終了期</span>
          <select class="axis-subselect" data-role="toOffset">${periodOptionsHtml(axis.toOffset)}</select>
        </div>`);
    } else {
      const variantKeys = Object.keys(def.variants);
      // 実績しか無い指標では種別セレクタを出さない（選択肢が1つだけの
      // セレクトボックスは操作できるように見えて紛らわしいため）。
      if (variantKeys.length > 1) {
        parts.push(`
          <div class="axis-sub-row">
            <span class="axis-sub-label">種別</span>
            <select class="axis-subselect" data-role="variant">
              ${variantKeys.map((v) =>
                `<option value="${v}" ${v === axis.variant ? 'selected' : ''}>${def.variants[v].label}</option>`
              ).join('')}
            </select>
          </div>`);
      }
      parts.push(`
        <div class="axis-sub-row">
          <span class="axis-sub-label">決算期</span>
          <select class="axis-subselect" data-role="offset">${periodOptionsHtml(axis.offset)}</select>
        </div>`);
    }

    const hint = axisHint(axis);
    if (hint) parts.push(`<p class="axis-sub-hint">${hint}</p>`);
    return parts.join('');
  }

  // 選択中の指標に応じて、その軸で指定できる項目（種別・決算期／開始期・終了期）を
  // 軸セレクタの直下に描き直す。指標を切り替えるたびに呼ぶ。
  function renderAxisSubControls(axisKey) {
    const axis = state.axes[axisKey];
    const host = document.getElementById(`axis-${axisKey}-sub`);
    host.innerHTML = metricSubControlsHtml(axis);

    host.querySelectorAll('select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const role = sel.dataset.role;
        if (role === 'variant') {
          axis.variant = sel.value;
          renderAxisSubControls(axisKey); // 種別によって補足説明が変わるため描き直す
        } else {
          axis[role] = parseInt(sel.value, 10);
        }
        renderAxisFilter(axisKey); // 軸が変わったらそれぞれのフィルター UI も更新
        refreshChart();
      });
    });

    renderAxisFilter(axisKey); // 軸サブコントロール描き直し直後に、フィルターも描き直す
  }

  function populateMarketSelect() {
    const el = document.getElementById('market-select');
    el.innerHTML = '<option value="all">全ての市場</option>' +
      MARKET_OPTIONS.map((m) => `<option value="${m}">${m}</option>`).join('');
  }

  // ---------------- 業種フィルター・凡例（データセット依存のため再生成可能） ----------------
  function populateSectorFilter() {
    const el = document.getElementById('sector-filter-list');
    const sectors = [...new Set(companies.map((c) => c.sector))].sort();
    el.innerHTML = sectors.map((s) => `
      <label class="sector-check-row cursor-pointer">
        <input type="checkbox" class="sector-check rounded" value="${s}" ${state.activeSectors.has(s) ? 'checked' : ''}>
        <span class="sector-swatch" style="background:${getSectorColor(s)}"></span>
        <span class="text-slate-600">${s}</span>
      </label>
    `).join('');
    document.querySelectorAll('.sector-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) state.activeSectors.add(cb.value);
        else state.activeSectors.delete(cb.value);
        syncLegendActive();
      });
    });
  }

  function populateLegend() {
    const el = document.getElementById('sector-legend');
    const usedSectors = [...new Set(companies.map((c) => c.sector))].sort();
    el.innerHTML = usedSectors.map((s) => `
      <span class="legend-item ${state.activeSectors.has(s) ? '' : 'legend-inactive'}" data-sector="${s}">
        <span class="legend-dot" style="background:${getSectorColor(s)}"></span>${s}
      </span>
    `).join('');
    el.querySelectorAll('.legend-item').forEach((item) => {
      item.addEventListener('click', () => {
        const sector = item.dataset.sector;
        if (state.activeSectors.has(sector)) {
          state.activeSectors.delete(sector);
          item.classList.add('legend-inactive');
        } else {
          state.activeSectors.add(sector);
          item.classList.remove('legend-inactive');
        }
        syncSectorCheckboxes();
        refreshChart();
      });
    });
  }

  function syncSectorCheckboxes() {
    document.querySelectorAll('.sector-check').forEach((cb) => {
      cb.checked = state.activeSectors.has(cb.value);
    });
  }

  function syncLegendActive() {
    document.querySelectorAll('.legend-item').forEach((item) => {
      if (state.activeSectors.has(item.dataset.sector)) item.classList.remove('legend-inactive');
      else item.classList.add('legend-inactive');
    });
  }

  // ---------------- フィルター適用 ----------------
  function getFilteredCompanies() {
    const kw = state.keyword.trim().toLowerCase();
    return companies.filter((c) => {
      if (state.hiddenCodes.has(c.code)) return false;
      if (state.market !== 'all' && c.market !== state.market) return false;
      if (!state.activeSectors.has(c.sector)) return false;
      // フィルターと注目企業パネルは軸の期間指定とは独立に、常に最新決算期の
      // 時価総額で判定する。
      const cap = computeMetricValue(c, 'market_cap', LATEST_FY_INDEX);
      if (cap !== null && (cap < state.minMarketCap || cap > state.maxMarketCap)) return false;

      // 軸の値フィルター
      for (const k of ['x', 'y', 'z']) {
        const val = computeAxisValue(c, state.axes[k]);
        const filter = state.axisValueFilters[k];
        if (val !== null && (val < filter.min || val > filter.max)) return false;
      }

      // 指標フィルター（軸と同様に、指定された種別・決算期の値で判定する）
      for (const customFilter of state.customFilters) {
        const val = computeAxisValue(c, customFilter.axis);
        if (val !== null && (val < customFilter.min || val > customFilter.max)) return false;
      }

      if (kw) {
        const hay = (c.name + ' ' + c.code).toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }

  // ---------------- チャート更新 ----------------
  function refreshChart() {
    const filtered = getFilteredCompanies();
    ChartModule.render('chart-3d', filtered, {
      axisX: state.axes.x, axisY: state.axes.y, axisZ: state.axes.z,
      capFyIndex: LATEST_FY_INDEX,
      logX: state.logX, logY: state.logY, logZ: state.logZ,
      activeSectors: state.activeSectors
    });
    document.getElementById('report-company-count').textContent = filtered.length;
    renderTopCompanies(filtered, LATEST_FY_INDEX);
  }

  // ---------------- 注目企業パネル ----------------
  function renderTopCompanies(filtered, fyIndex) {
    const withCap = filtered
      .map((c) => ({ c, cap: computeMetricValue(c, 'market_cap', fyIndex) }))
      .filter((x) => x.cap !== null)
      .sort((a, b) => b.cap - a.cap)
      .slice(0, 12);

    const el = document.getElementById('top-companies-list');
    if (withCap.length === 0) {
      el.innerHTML = '<li class="text-xs text-slate-400 text-center py-4">対象企業がありません</li>';
      return;
    }
    el.innerHTML = withCap.map(({ c, cap }) => {
      const rg = computeAxisValue(c, { metric: 'revenue_growth', variant: 'forecast', offset: 0 });
      const om = computeMetricValue(c, 'op_margin', fyIndex);
      const per = computeMetricValue(c, 'per', fyIndex);
      return `
        <li class="top-company-item" data-code="${c.code}">
          <span class="top-company-dot" style="background:${c.color}"></span>
          <div class="min-w-0">
            <div class="top-company-name truncate">${c.name}</div>
            <div class="top-company-meta">${formatCompactMarketCap(cap)}</div>
            <div class="top-company-meta">${fmtOrDash(rg,'%')} / ${fmtOrDash(om,'%')} / ${fmtOrDash(per,'倍')}</div>
          </div>
        </li>`;
    }).join('');
  }

  function fmtOrDash(v, unit) {
    if (v === null || v === undefined || Number.isNaN(v)) return '-';
    return v.toFixed(1) + unit;
  }

  // ---------------- 分析レポート ----------------
  function openReport() {
    const filtered = getFilteredCompanies();
    const fyIndex = LATEST_FY_INDEX;
    const body = document.getElementById('report-body');
    const axes = state.axes;

    const caps = filtered.map((c) => computeMetricValue(c, 'market_cap', fyIndex)).filter((v) => v !== null);
    const totalCap = caps.reduce((a, b) => a + b, 0);
    // サマリーの平均値は軸の設定と関係なく、常に最新決算期の実績で算出する。
    const avgAxis = (axis) => {
      const vals = filtered.map((c) => computeAxisValue(c, axis)).filter((v) => v !== null && Number.isFinite(v));
      if (vals.length === 0) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    const avgGrowth = avgAxis({ metric: 'revenue_growth', variant: 'forecast', offset: 0 });
    const avgMargin = avgAxis({ metric: 'op_margin', variant: 'actual', offset: 0 });
    const avgPer = avgAxis({ metric: 'per', variant: 'actual', offset: 0 });
    const avgRoe = avgAxis({ metric: 'roe', variant: 'actual', offset: 0 });

    const sorted = filtered
      .map((c) => ({ c, cap: computeMetricValue(c, 'market_cap', fyIndex) || 0 }))
      .sort((a, b) => b.cap - a.cap)
      .slice(0, 30);

    const sourceNote = 'J-Quants APIから取得した実データです（開示データ提供期間の制約等により、一部項目が取得できなかった企業ではその値が欠損表示「-」になります）。';

    body.innerHTML = `
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="report-metric-card"><div class="value">${filtered.length}社</div><div class="label">対象企業数</div></div>
        <div class="report-metric-card"><div class="value">${Math.round(totalCap).toLocaleString('ja-JP')}億円</div><div class="label">合計時価総額</div></div>
        <div class="report-metric-card"><div class="value">${fmtOrDash(avgGrowth,'%')}</div><div class="label">平均 売上高成長率(会社予想)</div></div>
        <div class="report-metric-card"><div class="value">${fmtOrDash(avgMargin,'%')}</div><div class="label">平均 営業利益率</div></div>
        <div class="report-metric-card"><div class="value">${fmtOrDash(avgPer,'倍')}</div><div class="label">平均 PER</div></div>
        <div class="report-metric-card"><div class="value">${fmtOrDash(avgRoe,'%')}</div><div class="label">平均 ROE</div></div>
        <div class="report-metric-card"><div class="value">${axisLabel(axes.x)}</div><div class="label">X軸</div></div>
        <div class="report-metric-card"><div class="value">${axisLabel(axes.y)} / ${axisLabel(axes.z)}</div><div class="label">Y軸 / Z軸</div></div>
      </div>
      <div>
        <h4 class="text-sm font-bold text-slate-700 mb-2">時価総額上位企業（最大30社）</h4>
        <div class="overflow-x-auto border border-slate-200 rounded-lg">
          <table class="w-full text-left">
            <thead class="bg-slate-50 text-slate-500 text-[11px]">
              <tr>
                <th class="px-3 py-2">企業名</th><th class="px-3 py-2">業種</th>
                <th class="px-3 py-2 text-right">時価総額</th>
                <th class="px-3 py-2 text-right">${axisLabel(axes.x)}</th>
                <th class="px-3 py-2 text-right">${axisLabel(axes.y)}</th>
                <th class="px-3 py-2 text-right">${axisLabel(axes.z)}</th>
              </tr>
            </thead>
            <tbody>
              ${sorted.map(({ c, cap }) => `
                <tr class="report-company-row">
                  <td class="font-semibold text-slate-800">${c.name}<span class="text-slate-400 font-normal ml-1">(${c.code})</span></td>
                  <td class="text-slate-500">${c.sector}</td>
                  <td class="text-right">${formatCompactMarketCap(cap)}</td>
                  <td class="text-right">${formatAxisValue(axes.x, computeAxisValue(c, axes.x))}</td>
                  <td class="text-right">${formatAxisValue(axes.y, computeAxisValue(c, axes.y))}</td>
                  <td class="text-right">${formatAxisValue(axes.z, computeAxisValue(c, axes.z))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <p class="text-[11px] text-slate-400">※ 表示データは${sourceNote}</p>
    `;
    showModal('report-modal');
  }

  // ---------------- モーダル制御 ----------------
  // ---------------- 企業の主要財務情報パネル（球を左クリックで表示） ----------------
  // 指標の並びは軸セレクタと同じ METRIC_GROUPS をそのまま流用する。
  // 株価パフォーマンスだけは2つの期を指定して初めて決まる指標で、
  // 「1つの決算期の値」として列に並べられないため除外する。
  const DETAIL_GROUPS = METRIC_GROUPS
    .map((g) => ({ label: g.label, keys: g.keys.filter((k) => !isRangeMetric(k)) }))
    .filter((g) => g.keys.length > 0);
  const DETAIL_KEYS = DETAIL_GROUPS.reduce((acc, g) => acc.concat(g.keys), []);

  // 会社予想を持つ指標を、実績とどう並べて見せるか。
  //   'latest-forecast' … 実績は全期ぶん、予想は最新決算期のぶんだけ。
  //                       （結果が出てしまった過去の期の予想は参照価値が薄いため）
  //   'both'            … 実績・予想とも全期ぶん。PERとPEGレシオは実績ベースと
  //                       予想ベースで水準が変わり、両方の推移を見る意味があるため。
  // ここに載っていない指標は、そもそも決算短信に会社予想の開示欄が無いので実績のみ。
  const DETAIL_FORECAST_MODES = {
    revenue: 'latest-forecast',
    op_income: 'latest-forecast',
    net_income: 'latest-forecast',
    revenue_growth: 'latest-forecast',
    op_income_growth: 'latest-forecast',
    net_income_growth: 'latest-forecast',
    eps: 'latest-forecast',
    per: 'both',
    peg_ratio: 'both'
  };

  // 1つの指標を、表の何行として描くかに展開する。
  //   hasForecastCell … 左端の「会社予想」列に値を入れる行（最新決算期に開示された翌期予想）
  //   variant         … 決算期の各列に入れる値の種別
  // 'latest-forecast' の指標は実績1行だけで、予想は会社予想列に入る。
  // 'both' の指標は予想の推移も見たいので、決算期の列を予想で埋めた行を別に足す。
  // その行は会社予想列を使わない（最新決算期の列と同じ値になり重複するため）。
  function detailRowsFor(metricKey) {
    const def = METRIC_DEFS[metricKey];
    const hasForecast = !!(def && def.variants && def.variants.forecast);
    const mode = hasForecast ? DETAIL_FORECAST_MODES[metricKey] : null;
    const rows = [{
      key: metricKey,
      variant: VARIANT_ACTUAL,
      hasForecastCell: mode === 'latest-forecast'
    }];
    if (mode === 'both') {
      rows.push({ key: metricKey, variant: VARIANT_FORECAST, hasForecastCell: false });
    }
    // 「実績」「予想」バッジは同じ指標が2行に分かれる時だけ付ける。1行しかない
    // 指標に付けても、決算期の列が実績・会社予想列が予想であることは列見出しで
    // 分かるため、かえって行ラベルと会社予想列の値が食い違って見える。
    rows.forEach((r) => { r.showBadge = rows.length > 1; });
    return rows;
  }

  // 決算期の列に入れる値
  function detailPeriodValue(company, row, offset) {
    return computeVariantValue(company, row.key, row.variant, fyIndexFromOffset(offset));
  }

  // 左端の「会社予想」列に入れる値
  function detailForecastValue(company, row) {
    if (!row.hasForecastCell) return null;
    return computeVariantValue(company, row.key, VARIANT_FORECAST, fyIndexFromOffset(0));
  }

  // EDINET DBの企業概要（事業内容の一文要約 + AIによる直近決算サマリー）。
  // EDINET DB由来のデータにのみ含まれる（J-Quants由来データではundefined）。
  function companySummaryHtml(company) {
    if (!company.businessSummary && !company.aiSummary) return '';
    const parts = [];
    if (company.businessSummary) {
      parts.push(`<p class="text-[12px] font-semibold text-slate-700 mb-1.5">${esc(company.businessSummary)}</p>`);
    }
    if (company.aiSummary) {
      parts.push(`<p class="text-[11px] leading-relaxed text-slate-600 whitespace-pre-line">${esc(company.aiSummary)}</p>`);
      // EDINET DB利用規約第3-2条により、AI所見の表示にはこの免責文言を
      // 利用者自身のサービスにおいても明示することが求められている。
      parts.push(`<p class="mt-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">
        AI所見はLLMによる自動生成であり、事実と異なる記述を含む可能性があります。投資判断・与信判断の根拠として使用しないでください。
      </p>`);
    }
    return `
      <div class="mx-4 mt-3 px-3.5 py-3 rounded-lg border border-slate-200 bg-white">
        ${parts.join('')}
        <p class="mt-2 text-[10px] text-slate-400">出所: <a href="https://edinetdb.jp" target="_blank" rel="noopener noreferrer" class="underline hover:text-slate-600">Powered by EDINET DB</a></p>
      </div>`;
  }

  let selectedCompanyCode = null; // パネルに表示中の企業（データ更新時の再描画に使う）

  function closeCompanyDetail() {
    selectedCompanyCode = null;
    const panel = document.getElementById('company-detail-panel');
    if (!panel) return;
    panel.classList.add('hidden');
    panel.innerHTML = '';
  }

  function showCompanyDetail(company) {
    const panel = document.getElementById('company-detail-panel');
    if (!panel || !company) return;
    selectedCompanyCode = company.code;

    // 開示データの提供期間が短いプランでは大半の期が空になるため、値が1つも
    // 入っていない決算期は列ごと省く。
    const allRows = DETAIL_KEYS.reduce((acc, k) => acc.concat(detailRowsFor(k)), []);
    const offsets = [];
    for (let o = 0; o < FISCAL_YEARS.length; o += 1) {
      if (allRows.some((r) => detailPeriodValue(company, r, o) !== null)) offsets.push(o);
    }
    const showForecastCol = allRows.some((r) => detailForecastValue(company, r) !== null);

    const head = `
      <div class="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-3">
        <div class="flex items-start gap-2.5 min-w-0">
          <span class="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style="background-color:${company.color}"></span>
          <div class="min-w-0">
            <h3 class="text-sm font-bold text-slate-800 truncate">
              ${company.name} <span class="text-slate-400 font-semibold">(${company.code})</span>
            </h3>
            <p class="text-[11px] text-slate-500">${company.sector} / ${company.market}</p>
          </div>
        </div>
        <button type="button" id="close-company-detail" class="text-slate-400 hover:text-slate-600 shrink-0" title="閉じる">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      ${companySummaryHtml(company)}
      <div class="company-detail-overview"></div>`;

    if (offsets.length === 0) {
      panel.innerHTML = head +
        '<p class="px-4 py-6 text-xs text-slate-400 text-center">この企業には表示できる財務データがありません。</p>';
      panel.classList.remove('hidden');
      bindCompanyDetailPanel(panel);
      return;
    }

    // 列見出しは「相対位置／決算期／発表日」の3段。決算期と発表日はJ-Quantsから
    // 取得したJSONにしか入っていないため、無い場合は相対位置だけになる。
    const latestMeta = periodMetaAt(company, fyIndexFromOffset(0));
    const subLine = (text) => (text ? `<div class="detail-col-sub">${text}</div>` : '');
    const forecastHeader = showForecastCol
      ? `<th class="detail-num detail-forecast-col">
           <div class="detail-col-name">会社予想</div>
           ${subLine(latestMeta.label ? `${latestMeta.label}時点` : '最新決算期時点')}
           ${subLine(latestMeta.date ? `${latestMeta.date} 発表` : '')}
         </th>`
      : '';
    const headerCells = forecastHeader + offsets.map((o) => {
      const meta = periodMetaAt(company, fyIndexFromOffset(o));
      return `<th class="detail-num">
        <div class="detail-col-name">${periodLabel(o)}</div>
        ${subLine(meta.label)}
        ${subLine(meta.date ? `${meta.date} 発表` : '')}
      </th>`;
    }).join('');

    const colCount = offsets.length + (showForecastCol ? 1 : 0) + 1;

    const bodyRows = DETAIL_GROUPS.map((g) => {
      // その企業が値を持たない行は出さない（空行だらけになるのを防ぐ）。
      const rows = g.keys
        .reduce((acc, k) => acc.concat(detailRowsFor(k)), [])
        .filter((r) =>
          offsets.some((o) => detailPeriodValue(company, r, o) !== null) ||
          detailForecastValue(company, r) !== null
        );
      if (rows.length === 0) return '';
      const groupRow = `<tr class="detail-group-row"><td colspan="${colCount}">${g.label}</td></tr>`;
      return groupRow + rows.map((r) => {
        const isForecastRow = r.variant === VARIANT_FORECAST;
        const badge = !r.showBadge ? ''
          : isForecastRow
            ? '<span class="detail-badge detail-badge-forecast">予想</span>'
            : '<span class="detail-badge detail-badge-actual">実績</span>';
        const forecastCell = showForecastCol
          ? `<td class="detail-num detail-forecast-col detail-num-forecast">${formatMetricValue(r.key, detailForecastValue(company, r))}</td>`
          : '';
        const cells = offsets.map((o) =>
          `<td class="detail-num${isForecastRow ? ' detail-num-forecast' : ''}">${formatMetricValue(r.key, detailPeriodValue(company, r, o))}</td>`
        ).join('');
        return `<tr><th class="detail-metric">${badge}${METRIC_DEFS[r.key].label}</th>${forecastCell}${cells}</tr>`;
      }).join('');
    }).join('');

    panel.innerHTML = head + `
      <div class="px-4 pt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span>決算期の列はその期の<b class="text-slate-600">実績値</b>、左端の「会社予想」列は最新決算期に開示された<b class="text-brand-600">翌期の予想値</b>です。</span>
        <span>PER・PEGレシオのみ<span class="detail-badge detail-badge-actual">実績</span><span class="detail-badge detail-badge-forecast">予想</span>の2行に分けて推移を並べています。</span>
      </div>
      <div class="p-4 overflow-x-auto">
        <table class="company-detail-table">
          <thead><tr><th class="detail-metric">指標</th>${headerCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
        <p class="text-[11px] text-slate-400 mt-2">
          「会社予想」列は最新決算期の発表時に開示された翌期の予想値です。売上高・営業利益・純利益・各成長率・EPSはこの列にのみ予想を載せます（結果が出ている過去の期の予想は省略）。PER・PEGレシオは予想の推移も見られるよう、決算期の列を予想で埋めた行を別に設けています（この行は会社予想列と値が重複するため同列を使いません）。PBR・BPS・ROE・ROA・自己資本比率などは決算短信に会社予想の開示欄が無いため実績のみです。「-」は該当データがないことを表します。
        </p>
      </div>`;
    panel.classList.remove('hidden');
    bindCompanyDetailPanel(panel);
  }

  function bindCompanyDetailPanel(panel) {
    panel.querySelector('#close-company-detail').addEventListener('click', closeCompanyDetail);
    loadCompanyOverview(panel, selectedCompanyCode);
  }

  // ---- 企業概要（EDINETの有価証券報告書【事業の内容】） --------------------
  // 取得は edinet_server.py のローカルプロキシ経由で行う。EDINET APIはCORS
  // ヘッダを返さずAPIキーも必要なため、ページのJSから直接は呼べない。
  // プロキシを持たないサーバー（serve_nocache.py）や file:// で開いた場合は、
  // 何も表示せず黙って諦める（使えない機能のエラーを常時出すとノイズになる）。
  let overviewPollTimer = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function overviewBox(inner, tone) {
    const tones = {
      info: 'bg-slate-50 border-slate-200 text-slate-600',
      warn: 'bg-amber-50 border-amber-200 text-amber-800',
    };
    return `<div class="mx-4 mt-3 px-3 py-2.5 rounded-lg border text-[11px] leading-relaxed ${tones[tone] || tones.info}">${inner}</div>`;
  }

  async function loadCompanyOverview(panel, code) {
    const host = panel.querySelector('.company-detail-overview');
    if (overviewPollTimer) { clearTimeout(overviewPollTimer); overviewPollTimer = null; }
    if (!host || !code) return;
    if (!/^https?:$/.test(location.protocol)) return; // file:// ではプロキシを呼べない

    host.innerHTML = overviewBox('<i class="fa-solid fa-spinner fa-spin mr-1.5"></i>企業概要を取得しています…');

    let res, data;
    try {
      res = await fetch(`/api/edinet/overview?code=${encodeURIComponent(code)}`,
                        { headers: { Accept: 'application/json' } });
      data = await res.json();
    } catch (e) {
      host.innerHTML = ''; // プロキシ非対応のサーバー（JSONを返さない）
      return;
    }
    if (code !== selectedCompanyCode) return; // 表示中の企業が変わっていたら破棄する

    if (data.error === 'NO_API_KEY') {
      host.innerHTML = overviewBox(
        '<b>企業概要（EDINET）は未設定です。</b><br>' +
        '<a href="https://api.edinet-fsa.go.jp/" target="_blank" rel="noopener noreferrer" class="underline">金融庁EDINET</a>' +
        'で無料のAPIキーを取得し、環境変数 <code class="px-1 rounded bg-white border">EDINET_API_KEY</code> に設定してから ' +
        '<code class="px-1 rounded bg-white border">edinet_server.py</code> を起動してください。', 'warn');
      return;
    }
    if (data.error === 'INDEX_NOT_READY') {
      renderIndexBuilder(host, data);
      return;
    }
    if (data.error) {
      host.innerHTML = overviewBox(`企業概要を取得できませんでした: ${esc(data.message || data.error)}`, 'warn');
      return;
    }
    if (!data.found) {
      host.innerHTML = overviewBox(esc(data.message || 'EDINETに有価証券報告書が見つかりませんでした。'));
      return;
    }

    const meta = [
      data.periodEnd ? `${esc(data.periodEnd)}期` : null,
      data.submitDate ? `${esc(data.submitDate)} 提出` : null,
    ].filter(Boolean).join(' / ');
    const hasMore = data.text && data.lead && data.text.length > data.lead.length;

    host.innerHTML = `
      <div class="mx-4 mt-3 px-3.5 py-3 rounded-lg border border-slate-200 bg-white">
        <div class="flex items-center gap-2 mb-1.5">
          <i class="fa-solid fa-file-lines text-slate-400 text-[11px]"></i>
          <span class="text-[11px] font-bold text-slate-700">企業概要</span>
          <span class="text-[10px] text-slate-400">${meta}</span>
        </div>
        <p class="overview-lead text-[12px] leading-relaxed text-slate-700 whitespace-pre-line">${esc(data.lead)}</p>
        <p class="overview-full hidden text-[12px] leading-relaxed text-slate-700 whitespace-pre-line">${esc(data.text)}</p>
        ${hasMore ? '<button type="button" class="overview-toggle mt-1.5 text-[11px] font-semibold text-brand-600 hover:underline">全文を読む</button>' : ''}
        <p class="mt-2 text-[10px] text-slate-400">出典: ${esc(data.source)}</p>
      </div>`;

    const toggle = host.querySelector('.overview-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const lead = host.querySelector('.overview-lead');
        const full = host.querySelector('.overview-full');
        const open = !full.classList.contains('hidden');
        full.classList.toggle('hidden', open);
        lead.classList.toggle('hidden', !open);
        toggle.textContent = open ? '全文を読む' : '折りたたむ';
      });
    }
  }

  // 銘柄索引の構築UI。EDINETの書類一覧APIは提出日でしか引けず銘柄コードで
  // 検索できないため、初回だけ提出日を遡って索引を作る必要がある。
  function renderIndexBuilder(host, status) {
    if (status.building) {
      const pct = status.total ? Math.round((status.progress / status.total) * 100) : 0;
      host.innerHTML = overviewBox(
        `<b>企業概要の索引を作成しています…</b> ${pct}%（${status.progress}/${status.total}日ぶん走査）<br>` +
        '初回のみ数分かかります。完了後は銘柄を選ぶたびに自動で表示されます。');
      overviewPollTimer = setTimeout(() => pollIndexStatus(host), 2000);
      return;
    }
    // 索引構築のエラーは buildError で受ける。status.error はoverview応答の
    // マーカー（INDEX_NOT_READY）が入るため、ここで見ると必ず失敗表示になる。
    if (status.buildError) {
      host.innerHTML = overviewBox(`索引の作成に失敗しました: ${esc(status.buildError)}`, 'warn');
      return;
    }
    host.innerHTML = overviewBox(
      '<b>企業概要を表示するには、初回だけ索引の作成が必要です。</b><br>' +
      'EDINETは提出日でしか書類を検索できないため、提出日を遡って銘柄コードとの対応表を作ります（数分）。' +
      '<button type="button" class="overview-build-btn ml-2 font-semibold px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50">索引を作成</button>');
    host.querySelector('.overview-build-btn').addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      ev.target.textContent = '開始しています…';
      try {
        const r = await fetch('/api/edinet/index/build', { method: 'POST' });
        renderIndexBuilder(host, await r.json());
      } catch (e) {
        host.innerHTML = overviewBox('索引の作成を開始できませんでした。', 'warn');
      }
    });
  }

  async function pollIndexStatus(host) {
    if (!selectedCompanyCode || !host.isConnected) return;
    try {
      const r = await fetch('/api/edinet/status');
      const status = await r.json();
      if (status.indexReady && !status.building) {
        // 索引ができたので、表示中の銘柄の概要を取りに行く
        const panel = document.getElementById('company-detail-panel');
        if (panel) loadCompanyOverview(panel, selectedCompanyCode);
        return;
      }
      renderIndexBuilder(host, status);
    } catch (e) {
      overviewPollTimer = setTimeout(() => pollIndexStatus(host), 5000);
    }
  }

  function showModal(id) {
    const m = document.getElementById(id);
    m.classList.remove('hidden');
    m.classList.add('modal-open');
  }
  function hideModal(id) {
    const m = document.getElementById(id);
    m.classList.add('hidden');
    m.classList.remove('modal-open');
  }

  // ---------------- 企業を非表示にする確認ダイアログ ----------------
  let pendingHideConfirm = null; // 「非表示にする」が押された時に実行する処理

  function askHideConfirm(company, onConfirm) {
    pendingHideConfirm = onConfirm;
    document.getElementById('hide-confirm-text').textContent =
      `「${company.name}」を非表示にしますか？`;
    showModal('hide-confirm-modal');
  }

  function closeHideConfirm() {
    pendingHideConfirm = null;
    hideModal('hide-confirm-modal');
  }

  function bindHideConfirmEvents() {
    document.getElementById('hide-confirm-ok').addEventListener('click', () => {
      const fn = pendingHideConfirm;
      closeHideConfirm();
      if (fn) fn();
    });
    document.getElementById('hide-confirm-cancel').addEventListener('click', closeHideConfirm);
    document.getElementById('hide-confirm-modal').addEventListener('click', (e) => {
      if (e.target.id === 'hide-confirm-modal') closeHideConfirm();
    });
  }

  function setLoading(show, text) {
    const overlay = document.getElementById('loading-overlay');
    if (show) {
      document.getElementById('loading-text').textContent = text || '処理中...';
      overlay.classList.remove('hidden'); overlay.classList.add('modal-open');
    } else {
      overlay.classList.add('hidden'); overlay.classList.remove('modal-open');
    }
  }

  // ---------------- イベントバインド ----------------
  function bindEvents() {
    AXIS_KEYS.forEach((k) => {
      const logKey = 'log' + k.toUpperCase();
      document.getElementById(`axis-${k}`).addEventListener('change', (e) => {
        // 指標を変えると選べる種別・期間も変わるため、軸の設定を作り直す。
        state.axes[k] = createAxis(e.target.value);
        // 対数スケールは指標の分布特性（PER・時価総額のように広がる指標か、
        // 利益率・成長率のようにマイナスを取りうる指標か）に合わせて自動で
        // 切り替える。手動で変えたい場合はこの後チェックボックスで操作できる。
        const useLog = METRIC_DEFS[e.target.value].scaleType === 'log';
        state[logKey] = useLog;
        document.getElementById(`axis-${k}-log`).checked = useLog;
        renderAxisSubControls(k);
        refreshChart();
      });
      document.getElementById(`axis-${k}-log`).addEventListener('change', (e) => {
        state[logKey] = e.target.checked;
        refreshChart();
      });
    });
    document.getElementById('market-select').addEventListener('change', async (e) => {
      state.market = e.target.value;
      await ensureMarketLoaded(state.market);
    });

    document.getElementById('keyword-search').addEventListener('input', (e) => { state.keyword = e.target.value; });

    document.getElementById('apply-filter-btn').addEventListener('click', refreshChart);

    document.getElementById('add-custom-filter-btn').addEventListener('click', () => {
      const select = document.getElementById('custom-filter-metric-select');
      const metricKey = select.value;
      if (!metricKey || !METRIC_DEFS[metricKey]) {
        alert('指標を選択してください。');
        return;
      }
      state.customFilters.push({ axis: createAxis(metricKey), min: -Infinity, max: Infinity });
      renderCustomFilters();
      select.value = '';
      refreshChart();
    });

    document.getElementById('reset-filter-btn').addEventListener('click', async () => {
      state.market = 'all';
      state.activeSectors = new Set(companies.map((c) => c.sector));
      state.axisValueFilters = { x: { min: -Infinity, max: Infinity }, y: { min: -Infinity, max: Infinity }, z: { min: -Infinity, max: Infinity } };
      state.customFilters = [];
      state.keyword = '';
      state.hiddenCodes = new Set();
      document.getElementById('market-select').value = 'all';
      document.querySelectorAll('.sector-check').forEach((cb) => cb.checked = true);
      document.getElementById('keyword-search').value = '';
      document.getElementById('custom-filter-metric-select').value = '';
      AXIS_KEYS.forEach((k) => renderAxisFilter(k));
      renderCustomFilters();
      syncLegendActive();
      refreshChart();
      await ensureMarketLoaded('all');
    });

    document.querySelectorAll('.view-btn').forEach((btn) => {
      btn.addEventListener('click', () => ChartModule.setView(btn.dataset.view));
    });

    // 球体を右クリック→確認の上でその企業をチャートから非表示にする。
    // window.confirm()はブラウザによってはマウスイベント処理中の呼び出しが
    // 抑制されることがあるため、自前のモーダルで確認する。
    ChartModule.setHideRequestHandler((company) => {
      askHideConfirm(company, () => {
        state.hiddenCodes.add(company.code);
        // 非表示にした企業の財務情報を開いたままにしない。
        if (selectedCompanyCode === company.code) closeCompanyDetail();
        refreshChart();
      });
    });

    // 球体を左クリック→その企業の主要財務情報をチャート下のパネルに表示する。
    ChartModule.setSelectRequestHandler(showCompanyDetail);

    document.getElementById('open-report-btn').addEventListener('click', openReport);
    document.getElementById('close-report-btn').addEventListener('click', () => hideModal('report-modal'));
    document.getElementById('report-modal').addEventListener('click', (e) => { if (e.target.id === 'report-modal') hideModal('report-modal'); });

    document.getElementById('open-guide-btn').addEventListener('click', () => showModal('guide-modal'));
    document.getElementById('close-guide-btn').addEventListener('click', () => hideModal('guide-modal'));
    document.getElementById('guide-modal').addEventListener('click', (e) => { if (e.target.id === 'guide-modal') hideModal('guide-modal'); });

    document.getElementById('top-companies-list').addEventListener('click', (e) => {
      const item = e.target.closest('.top-company-item');
      if (!item) return;
      const code = item.dataset.code;
      const c = companies.find((x) => x.code === code);
      // 球の左クリックと同じ財務情報パネルを開く。
      if (c) showCompanyDetail(c);
    });
  }

  // ---------------- 初期化実行 ----------------
  async function init() {
    populateAxisSelects();
    // 対数スケールの初期状態をstateに合わせる（HTML側は全て未チェック）。
    AXIS_KEYS.forEach((k) => {
      document.getElementById(`axis-${k}-log`).checked = state['log' + k.toUpperCase()];
    });
    populateMarketSelect();
    populateCustomFilterMetricSelect();
    bindEvents();
    bindHideConfirmEvents();

    // 起動時：data/manifest.json経由で東証プライムの実データをfetchする。
    // 未生成・ネットワークエラー等で取得できなければ埋め込みサンプルにフォールバックする。
    setLoading(true, 'データを読み込み中...');
    const loaded = await loadLiveDataset();
    if (!loaded) {
      setDataset(DatasetStore.getSample(), DEFAULT_DATASET_META);
    }
    setLoading(false);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
