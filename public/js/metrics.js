/* ==========================================================================
   metrics.js
   軸・指標の定義と、指定した決算期に基づく指標値の算出ロジック。
   --------------------------------------------------------------------------
   1つの軸は次の3要素で決まる。
     ・基本指標   … 売上高／PER／PEGレシオ など
     ・データ種別 … 実績 か 会社予想 か（両方ある指標のみ選択できる）
     ・決算期     … 最新決算期／1期前／2期前 …（各社の相対位置）
   以前は「予想PER」「PER・1期前」のように全組み合わせを別々の選択肢として
   並べていたため一覧が30項目を超えて探しにくかった。基本指標を選んでから
   種別・期間を選ぶ方式に変え、選択肢を整理している。
   例外として「株価パフォーマンス」だけは開始期と終了期の2つを指定する。
   ========================================================================== */

// 配列から安全に値を取り出す（範囲外・null・NaNはすべてnullに寄せる）。
function pickAt(arr, i) {
  if (!Array.isArray(arr) || i < 0 || i >= arr.length) return null;
  const v = arr[i];
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return v;
}

// PEGレシオ＝PER ÷ 利益成長率(%)。成長率がマイナスの企業も「マイナスの
// PEGレシオ」としてそのまま表示する（割高・割安の判断材料として残す）。
// 成長率が0または欠損の場合のみ算出不能としてnullを返す。
function pegRatio(per, growth) {
  if (per === null || growth === null || growth === 0) return null;
  return per / growth;
}

// 期末株価（基準株価）はEDINET DBから直接提供されないため、同DBがPER・PBR算出に
// 使った株価をPER×EPS（またはPBR×BPS）から逆算して求める。両方欠けている期のみnull。
function impliedSharePrice(f, i) {
  const per = pickAt(f.per, i);
  const eps = pickAt(f.eps, i);
  if (per !== null && eps !== null) return per * eps;
  const pbr = pickAt(f.pbr, i);
  const bps = pickAt(f.bps, i);
  if (pbr !== null && bps !== null) return pbr * bps;
  return null;
}

const VARIANT_ACTUAL = 'actual';
const VARIANT_FORECAST = 'forecast';

// 軸に選択できる基本指標の定義。
// ・variants … データ種別ごとの算出関数。キーが1つだけの指標では種別セレクタを出さない。
// ・kind:'range' … 開始期・終了期の2つを指定する特殊な指標（株価パフォーマンス）。
const METRIC_DEFS = {
  // ---- 規模 ----
  revenue: {
    label: '売上高', unit: '億円', scaleType: 'log',
    variants: {
      actual: { label: '実績', compute: (f, i) => pickAt(f.revenue, i) },
      forecast: { label: '会社予想（翌期）', compute: (f, i) => pickAt(f.revenueForecast, i) }
    }
  },
  op_income: {
    label: '営業利益', unit: '億円', scaleType: 'log',
    variants: {
      actual: { label: '実績', compute: (f, i) => pickAt(f.opIncome, i) },
      forecast: { label: '会社予想（翌期）', compute: (f, i) => pickAt(f.opIncomeForecast, i) }
    }
  },
  net_income: {
    label: '純利益', unit: '億円', scaleType: 'log',
    variants: {
      actual: { label: '実績', compute: (f, i) => pickAt(f.netIncome, i) },
      forecast: { label: '会社予想（翌期）', compute: (f, i) => pickAt(f.netIncomeForecast, i) }
    }
  },
  market_cap: {
    label: '時価総額', unit: '億円', scaleType: 'log',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.marketCap, i) } }
  },
  total_assets: {
    label: '総資産', unit: '億円', scaleType: 'log',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.totalAssets, i) } }
  },

  // ---- 利益率 ----
  op_margin: {
    label: '営業利益率', unit: '%', scaleType: 'linear',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.operatingMargin, i) } }
  },
  net_margin: {
    label: '純利益率', unit: '%', scaleType: 'linear',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.netMargin, i) } }
  },
  operating_cf_margin: {
    label: '営業キャッシュフロー率', unit: '%', scaleType: 'linear',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.operatingCfMargin, i) } }
  },
  rnd_ratio: {
    label: '研究開発費率', unit: '%', scaleType: 'linear',
    hint: 'EDINET DB由来データのみ算出できます。研究開発費 ÷ 売上高。',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.rndRatio, i) } }
  },

  // ---- 成長率 ----
  // 実績YoYは前期の開示が揃っている企業でしか算出できない。開示データの提供
  // 期間が短い契約プランでは大半が欠損するため、その旨をヒントとして出す。
  revenue_growth: {
    label: '売上高成長率', unit: '%', scaleType: 'linear',
    variants: {
      actual: {
        label: '実績（前期比）', compute: (f, i) => pickAt(f.revenueGrowthYoy, i),
        hint: '前期の開示が揃っている企業のみ算出できます。'
      },
      forecast: { label: '会社予想（翌期比）', compute: (f, i) => pickAt(f.revenueGrowthForecast, i) }
    }
  },
  op_income_growth: {
    label: '営業利益成長率', unit: '%', scaleType: 'linear',
    variants: {
      actual: {
        label: '実績（前期比）', compute: (f, i) => pickAt(f.opIncomeGrowthYoy, i),
        hint: '前期の開示が揃っている企業のみ算出できます。'
      },
      forecast: { label: '会社予想（翌期比）', compute: (f, i) => pickAt(f.opIncomeGrowthForecast, i) }
    }
  },
  net_income_growth: {
    label: '純利益成長率', unit: '%', scaleType: 'linear',
    variants: {
      actual: {
        label: '実績（前期比）', compute: (f, i) => pickAt(f.netIncomeGrowthYoy, i),
        hint: '前期の開示が揃っている企業のみ算出できます。'
      },
      forecast: { label: '会社予想（翌期比）', compute: (f, i) => pickAt(f.netIncomeGrowthForecast, i) }
    }
  },
  // EDINET DB由来のみ（3〜5年分の開示が揃っている必要があるため、前期比より
  // 算出できる企業が限られる代わりに単年のブレを均した成長トレンドが見える）。
  revenue_cagr_3y: {
    label: '売上高CAGR（3年）', unit: '%', scaleType: 'linear',
    hint: 'EDINET DB由来データのみ算出できます（3年分の開示が必要）。',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.revenueCagr3y, i) } }
  },
  op_income_cagr_3y: {
    label: '営業利益CAGR（3年）', unit: '%', scaleType: 'linear',
    hint: 'EDINET DB由来データのみ算出できます（3年分の開示が必要）。',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.opIncomeCagr3y, i) } }
  },
  net_income_cagr_3y: {
    label: '純利益CAGR（3年）', unit: '%', scaleType: 'linear',
    hint: 'EDINET DB由来データのみ算出できます（3年分の開示が必要）。',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.netIncomeCagr3y, i) } }
  },

  // ---- 株価評価 ----
  // 予想PBRに相当する指標はJ-Quantsに予想BPSの項目が無いため用意できない
  // （決算短信の開示制度上、予想の1株当たり純資産という開示項目が存在しない）。
  per: {
    label: 'PER（株価収益率）', unit: '倍', scaleType: 'log',
    variants: {
      actual: { label: '実績', compute: (f, i) => pickAt(f.per, i) },
      forecast: { label: '会社予想（翌期EPS基準）', compute: (f, i) => pickAt(f.forecastPer, i) }
    }
  },
  pbr: {
    label: 'PBR（株価純資産倍率）', unit: '倍', scaleType: 'log',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.pbr, i) } }
  },
  ev_ebitda: {
    label: 'EV/EBITDA倍率', unit: '倍', scaleType: 'log',
    hint: 'EDINET DB由来データのみ算出できます。',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.evEbitda, i) } }
  },
  psr: {
    label: 'PSR（売上高倍率）', unit: '倍', scaleType: 'log',
    hint: 'EDINET DB由来データのみ算出できます。赤字企業のスクリーニングにも使えます。',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.psr, i) } }
  },
  peg_ratio: {
    label: 'PEGレシオ', unit: '倍', scaleType: 'linear',
    hint: 'PER ÷ 純利益成長率(%)。成長率がマイナスの企業はマイナスの値で表示します。',
    variants: {
      actual: {
        label: '実績（PER ÷ 実績成長率）',
        compute: (f, i) => pegRatio(pickAt(f.per, i), pickAt(f.netIncomeGrowthYoy, i)),
        hint: 'PER ÷ 純利益成長率(実績・前期比)。前期の開示が揃っている企業のみ算出できます。'
      },
      forecast: {
        label: '会社予想（予想PER ÷ 予想成長率）',
        compute: (f, i) => pegRatio(pickAt(f.forecastPer, i), pickAt(f.netIncomeGrowthForecast, i)),
        hint: '予想PER ÷ 純利益成長率(会社予想)。成長率がマイナスならPEGもマイナスで表示します。'
      }
    }
  },
  eps: {
    label: 'EPS（1株当たり利益）', unit: '円', scaleType: 'linear',
    variants: {
      actual: { label: '実績', compute: (f, i) => pickAt(f.eps, i) },
      forecast: { label: '会社予想（翌期）', compute: (f, i) => pickAt(f.forecastEps, i) }
    }
  },
  bps: {
    label: 'BPS（1株当たり純資産）', unit: '円', scaleType: 'linear',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.bps, i) } }
  },
  ref_price: {
    label: '期末株価（基準株価）', unit: '円', scaleType: 'log',
    hint: 'EDINET DBはこの株価そのものを開示していないため、同DBが公表するPER・PBRとEPS・BPSから逆算した推定値です（PER×EPS、算出できない期のみPBR×BPSで代用）。丸め誤差により実際の株価と若干ずれる場合があります。',
    variants: { actual: { label: '実績', compute: (f, i) => impliedSharePrice(f, i) } }
  },
  price_performance: {
    label: '株価パフォーマンス', unit: '%', scaleType: 'linear',
    kind: 'range',
    hint: 'PER/PBRとEPS/BPSから逆算した期末株価（基準株価）の騰落率です。',
    computeRange: (f, fromIndex, toIndex) => {
      const from = impliedSharePrice(f, fromIndex);
      const to = impliedSharePrice(f, toIndex);
      if (from === null || to === null || from === 0) return null;
      return ((to - from) / Math.abs(from)) * 100;
    }
  },

  // ---- 資本効率 ----
  roe: {
    label: 'ROE（株主資本利益率）', unit: '%', scaleType: 'linear',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.roe, i) } }
  },
  roa: {
    label: 'ROA（総資産利益率）', unit: '%', scaleType: 'linear',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.roa, i) } }
  },
  roic: {
    label: 'ROIC（投下資本利益率）', unit: '%', scaleType: 'linear',
    hint: 'EDINET DB由来データのみ算出できます。',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.roic, i) } }
  },
  greenblatt_roic: {
    label: '魔法の公式ROIC', unit: '%', scaleType: 'linear',
    hint: 'EDINET DB由来データのみ算出できます。Joel Greenblattの「魔法の公式」で使われる、のれん等を除いた投下資本に対する利益率。',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.greenblattRoic, i) } }
  },

  // ---- 財務健全性 ----
  equity_ratio: {
    label: '自己資本比率', unit: '%', scaleType: 'linear',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.equityRatio, i) } }
  },
  dividend_yield: {
    label: '配当利回り', unit: '%', scaleType: 'linear',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.dividendYield, i) } }
  },
  payout_ratio: {
    label: '配当性向', unit: '%', scaleType: 'linear',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.payoutRatio, i) } }
  },
  net_cash_ratio: {
    label: 'ネットキャッシュ比率', unit: '%', scaleType: 'linear',
    hint: 'EDINET DB由来データのみ算出できます。(現金等-有利子負債)÷時価総額。',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.netCashRatio, i) } }
  },
  consecutive_dividend_increase_years: {
    label: '連続増配年数', unit: '年', scaleType: 'linear',
    hint: 'EDINET DB由来データのみ算出できます。',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.consecutiveDividendIncreaseYears, i) } }
  },

  // ---- キャッシュフロー ----
  free_cash_flow: {
    label: 'フリーキャッシュフロー', unit: '億円', scaleType: 'log',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.freeCashFlow, i) } }
  },
  free_cash_flow_multiple: {
    label: 'FCF倍率', unit: '倍', scaleType: 'log',
    hint: '時価総額 ÷ フリーキャッシュフロー。PERのキャッシュフロー版で、値が小さいほどキャッシュ生成力に対して株価が割安。FCFがマイナスの期は算出できません。',
    variants: {
      actual: {
        label: '実績',
        compute: (f, i) => {
          const cap = pickAt(f.marketCap, i);
          const fcf = pickAt(f.freeCashFlow, i);
          if (cap === null || fcf === null || fcf <= 0) return null;
          return cap / fcf;
        }
      }
    }
  },
  cash_and_equivalents: {
    label: '現金等', unit: '億円', scaleType: 'log',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.cashAndEquivalents, i) } }
  },

  // ---- 人的資本 ----
  // EDINET DB由来のみ（有価証券報告書の「従業員の状況」等の開示に基づく）。
  avg_annual_salary: {
    label: '平均年間給与', unit: '万円', scaleType: 'linear',
    hint: 'EDINET DB由来データのみ算出できます。',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.avgAnnualSalary, i) } }
  },
  net_income_per_employee: {
    label: '1人当たり純利益', unit: '万円', scaleType: 'linear',
    hint: 'EDINET DB由来データのみ算出できます。純利益 ÷ 従業員数。',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.netIncomePerEmployee, i) } }
  },
  revenue_per_employee: {
    label: '1人当たり売上高', unit: '万円', scaleType: 'linear',
    hint: 'EDINET DB由来データのみ算出できます。売上高 ÷ 従業員数。',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.revenuePerEmployee, i) } }
  },
  female_director_ratio: {
    label: '女性役員比率', unit: '%', scaleType: 'linear',
    hint: 'EDINET DB由来データのみ算出できます。',
    variants: { actual: { label: '実績', compute: (f, i) => pickAt(f.femaleDirectorRatio, i) } }
  }
};

// 軸セレクタを見やすくするための分類（<optgroup>の並び順にもなる）。
const METRIC_GROUPS = [
  { label: '規模', keys: ['revenue', 'op_income', 'net_income', 'market_cap', 'total_assets'] },
  { label: '利益率', keys: ['op_margin', 'net_margin', 'operating_cf_margin', 'rnd_ratio'] },
  {
    label: '成長率',
    keys: ['revenue_growth', 'op_income_growth', 'net_income_growth',
      'revenue_cagr_3y', 'op_income_cagr_3y', 'net_income_cagr_3y']
  },
  {
    label: '株価評価',
    keys: ['per', 'pbr', 'ev_ebitda', 'psr', 'peg_ratio', 'eps', 'bps', 'ref_price', 'price_performance']
  },
  { label: '資本効率', keys: ['roe', 'roa', 'roic', 'greenblatt_roic'] },
  {
    label: '財務健全性',
    keys: ['equity_ratio', 'dividend_yield', 'payout_ratio', 'net_cash_ratio', 'consecutive_dividend_increase_years']
  },
  { label: 'キャッシュフロー', keys: ['free_cash_flow', 'free_cash_flow_multiple', 'cash_and_equivalents'] },
  {
    label: '人的資本',
    keys: ['avg_annual_salary', 'net_income_per_employee', 'revenue_per_employee', 'female_director_ratio']
  }
];
const METRIC_KEYS = METRIC_GROUPS.reduce((acc, g) => acc.concat(g.keys), []);

// 会社によって決算期末月が異なる（3月期以外も多い）ため、期間の指定は各社ごとの
// 相対位置（最新決算期を基準に何期前か）で行う。ラベルに具体的な暦年を含めない。
// 読み込んだデータセットによって保持している期数が変わるため、その都度生成する。
function getPeriodOptions() {
  const count = Math.max(1, FISCAL_YEARS.length);
  const options = [];
  for (let offset = 0; offset < count; offset += 1) {
    options.push({ offset, label: offset === 0 ? '最新決算期' : `${offset}期前` });
  }
  return options;
}

function fyIndexFromOffset(offset) {
  return LATEST_FY_INDEX - (Number.isFinite(offset) ? offset : 0);
}

// ---- 軸オブジェクト（{ metric, variant, offset, fromOffset, toOffset }）------

function createAxis(metricKey) {
  const def = METRIC_DEFS[metricKey];
  const variant = def && def.variants ? Object.keys(def.variants)[0] : VARIANT_ACTUAL;
  return { metric: metricKey, variant, offset: 0, fromOffset: 1, toOffset: 0 };
}

function isRangeMetric(metricKey) {
  const def = METRIC_DEFS[metricKey];
  return !!(def && def.kind === 'range');
}

// 指標の種別を切り替えた時など、選択中の値が新しい指標で使えない場合に補正する。
function normalizeAxis(axis) {
  const def = METRIC_DEFS[axis.metric];
  if (!def) return axis;
  if (def.kind !== 'range' && !def.variants[axis.variant]) {
    axis.variant = Object.keys(def.variants)[0];
  }
  const maxOffset = Math.max(0, FISCAL_YEARS.length - 1);
  axis.offset = Math.min(Math.max(0, axis.offset || 0), maxOffset);
  axis.fromOffset = Math.min(Math.max(0, axis.fromOffset || 0), maxOffset);
  axis.toOffset = Math.min(Math.max(0, axis.toOffset || 0), maxOffset);
  return axis;
}

function computeAxisValue(company, axis) {
  const def = METRIC_DEFS[axis.metric];
  if (!def) return null;
  const f = company.financials;
  if (def.kind === 'range') {
    return def.computeRange(f, fyIndexFromOffset(axis.fromOffset), fyIndexFromOffset(axis.toOffset));
  }
  const variant = def.variants[axis.variant] || def.variants[Object.keys(def.variants)[0]];
  return variant.compute(f, fyIndexFromOffset(axis.offset));
}

function periodLabel(offset) {
  return offset === 0 ? '最新決算期' : `${offset}期前`;
}

// チャートの軸タイトルやレポートの見出しに使う表示名。
// 指標名自体が「PER（株価収益率）」のように括弧を含むため、種別・期間は
// 括弧ではなく「・」で繋いで二重括弧にならないようにする。
function axisLabel(axis) {
  const def = METRIC_DEFS[axis.metric];
  if (!def) return '-';
  if (def.kind === 'range') {
    return `${def.label}・${periodLabel(axis.fromOffset)}→${periodLabel(axis.toOffset)}`;
  }
  const variantKeys = Object.keys(def.variants);
  const parts = [def.label];
  if (variantKeys.length > 1 && axis.variant === VARIANT_FORECAST) parts.push('会社予想');
  parts.push(periodLabel(axis.offset));
  return parts.join('・');
}

// 選択中の種別・期間に対する補足説明（無ければnull）。
function axisHint(axis) {
  const def = METRIC_DEFS[axis.metric];
  if (!def) return null;
  if (def.kind === 'range') return def.hint || null;
  const variant = def.variants[axis.variant];
  return (variant && variant.hint) || def.hint || null;
}

// ---- 表示フォーマット -------------------------------------------------------

// 億円単位の金額系指標は時価総額と同様、桁区切りの整数で表示する
// （営業利益・純利益は赤字の場合マイナス表示になる）。
const MONEY_METRIC_KEYS = new Set([
  'revenue', 'op_income', 'net_income', 'market_cap', 'total_assets',
  'free_cash_flow', 'cash_and_equivalents'
]);

function formatMetricValue(metricKey, value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const def = METRIC_DEFS[metricKey];
  if (!def) return '-';
  if (MONEY_METRIC_KEYS.has(metricKey)) {
    return Math.round(value).toLocaleString('ja-JP') + ' ' + def.unit;
  }
  return value.toFixed(1) + def.unit;
}

function formatAxisValue(axis, value) {
  return formatMetricValue(axis.metric, value);
}

// 軸以外（フィルターの時価総額下限・注目企業パネル等）から、指標を決算期の
// index直接指定で参照するための入口。常に「実績」の値を返す。
function computeMetricValue(company, metricKey, fyIndex) {
  const def = METRIC_DEFS[metricKey];
  if (!def || def.kind === 'range') return null;
  const variant = def.variants[VARIANT_ACTUAL] || def.variants[Object.keys(def.variants)[0]];
  return variant.compute(company.financials, fyIndex);
}

// 決算期ごとの「決算期ラベル（例: 2025/06期）」と「開示（発表）日」。
// どちらもJ-Quantsから取得したJSONにのみ含まれる補助情報で、既定の埋め込み
// データセットには無い。取れない項目はnullを返し、呼び出し側では相対表記
// （最新決算期／1期前…）だけにフォールバックする。
//
// 発表日は財務諸表の生データ側にしか無いため、決算期の配列と同じ並びで保持
// されている DiscNo（開示番号）をキーに rawStatements 側の DiscDate を引く。
// DiscNo の先頭8桁は発表日と一致しないので、そこから切り出してはいけない。
function periodMetaAt(company, fyIndex) {
  const f = (company && company.financials) || {};
  const labels = f.periodLabels;
  const label = (Array.isArray(labels) && fyIndex >= 0 && fyIndex < labels.length) ? labels[fyIndex] : null;

  let date = null;
  const discNos = f.raw && f.raw.DiscNo;
  const discNo = (Array.isArray(discNos) && fyIndex >= 0 && fyIndex < discNos.length) ? discNos[fyIndex] : null;
  if (discNo !== null && discNo !== undefined && Array.isArray(company.rawStatements)) {
    const stmt = company.rawStatements.find((s) => s && String(s.DiscNo) === String(discNo));
    if (stmt && stmt.DiscDate) date = String(stmt.DiscDate).replace(/-/g, '/');
  }
  return { label: label || null, date };
}

// 種別（実績／会社予想）を明示して、決算期のindex直接指定で値を参照する。
// その種別を持たない指標ではnullを返す（呼び出し側で列や行を省くために使う）。
function computeVariantValue(company, metricKey, variantKey, fyIndex) {
  const def = METRIC_DEFS[metricKey];
  if (!def || def.kind === 'range') return null;
  const variant = def.variants[variantKey];
  if (!variant) return null;
  return variant.compute(company.financials, fyIndex);
}

function formatCompactMarketCap(value) {
  if (value === null || value === undefined) return '-';
  return Math.round(value).toLocaleString('ja-JP') + '億円';
}
