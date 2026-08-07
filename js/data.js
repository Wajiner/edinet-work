// ==========================================================================
// data.js
// 企業データセットの定義。
// J-Quants API V2から取得した東証プライム上場30社の実データを使用しています
// （取得日: 2026-07-29）。Freeプランの開示データ提供期間の制約により、
// 多くの企業で直近決算期（2024/03期）以外はnull（データなし）です。
// ==========================================================================

// ---- 業種カラーマップ（凡例の色と対応） -----------------------------------
const SECTOR_COLORS = {
  '情報・通信業': '#4C8DF6',
  '電気機器': '#EA4335',
  '輸送用機器': '#34A853',
  '化学': '#9B6BDE',
  '医薬品': '#F5A623',
  '小売業': '#4FC3F7',
  'その他製品': '#F06292',
  'その他金融業': '#9AA0A6',
  '銀行業': '#2C3E50',
  '保険業': '#16A085',
  '証券業': '#8E44AD',
  'サービス業': '#27AE60',
  '食品': '#E67E22',
  '建設業': '#8D6E63',
  '機械': '#607D8B',
  '鉄鋼・非鉄金属': '#B71C1C',
  '不動産業': '#00838F',
  '陸運業': '#5C6BC0',
  '空運業': '#26A69A',
  '電力・ガス業': '#FBC02D',
  '卸売業': '#7B1FA2',
  '精密機器': '#C2185B'
};
const SECTOR_LIST = Object.keys(SECTOR_COLORS);

// 収録カラーマップに無い業種にも色を割り当てるための補助パレットとキャッシュ
// （同一業種には常に同じ色を割り当てる）。
const EXTRA_COLOR_PALETTE = [
  '#3F51B5', '#009688', '#795548', '#FF7043', '#5E35B1',
  '#00ACC1', '#C0CA33', '#6D4C41', '#D81B60', '#546E7A'
];
const _dynamicSectorColors = {};
function getSectorColor(sector) {
  if (SECTOR_COLORS[sector]) return SECTOR_COLORS[sector];
  if (_dynamicSectorColors[sector]) return _dynamicSectorColors[sector];
  const idx = Object.keys(_dynamicSectorColors).length % EXTRA_COLOR_PALETTE.length;
  const color = EXTRA_COLOR_PALETTE[idx];
  _dynamicSectorColors[sector] = color;
  return color;
}
function getAllKnownSectors() {
  return [...new Set([...SECTOR_LIST, ...Object.keys(_dynamicSectorColors)])];
}

// 決算期（会計年度末）ラベル。index 0 が最も古い期、末尾が最新期。
// 会社によって決算期末月が異なるため、これは既定データセットの表示用ラベルに
// すぎない（指標の参照は常に配列のindex＝相対位置で行う）。J-Quantsから
// 取得したJSONを読み込むと、そのファイルのfiscalYearsの長さに合わせて
// 下のsetFiscalYears()で差し替えられる。
let FISCAL_YEARS = ['2019/03期','2020/03期','2021/03期','2022/03期','2023/03期','2024/03期'];
let LATEST_FY_INDEX = FISCAL_YEARS.length - 1;
const DEFAULT_FISCAL_YEARS = FISCAL_YEARS.slice();

// データセット切り替え時（JSON読み込み・初期データに戻す）に、期間配列の長さを
// 読み込んだデータセットに合わせて更新する。
function setFiscalYears(labels) {
  FISCAL_YEARS = Array.isArray(labels) && labels.length ? labels : DEFAULT_FISCAL_YEARS.slice();
  LATEST_FY_INDEX = FISCAL_YEARS.length - 1;
}

const MARKET_OPTIONS = ['東証プライム','東証スタンダード','東証グロース'];

// ---- 収録企業の実データ（J-Quants API V2、東証プライム30社） --------------
const COMPANIES_REAL = [
  {
    "code": "9432",
    "name": "日本電信電話",
    "sector": "情報・通信業",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        133745.69
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        19229.1
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        12795.21
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        14.377360496626096
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        9.566820433615469
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        9.993373094764745
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        1.2880081995216948
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        11.746204624431025
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        4.322089453251315
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        3.3819628647214848
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        136549.87713120002
      ]
    },
    "source": "jquants"
  },
  {
    "code": "9433",
    "name": "KDDI",
    "sector": "情報・通信業",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        57540.47
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        9615.84
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        6378.74
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        16.711438053947074
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        11.0856584939261
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        8.381464515700724
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        1.0008244415201433
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        11.003090098609231
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        4.5091990278565195
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        5.544554455445545
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        58143.485777
      ]
    },
    "source": "jquants"
  },
  {
    "code": "9984",
    "name": "ソフトバンクグループ",
    "sector": "情報・通信業",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        67565.0
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        null
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        -2276.46
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        null
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        -3.369288832975653
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        -37.56944850576057
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        0.8588889795077966
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        -1.7197483842655479
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        -0.4872117457312256
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        0.684931506849315
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        94432.4935752
      ]
    },
    "source": "jquants"
  },
  {
    "code": "4689",
    "name": "LINEヤフー",
    "sector": "情報・通信業",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        18146.63
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        2081.91
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        1131.99
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        11.472708706795697
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        6.23801774764791
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        29.119205298013245
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        1.085973968238287
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        3.2840003655368384
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        1.2516517913761092
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        1.264498521719354
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        33580.192331442
      ]
    },
    "source": "jquants"
  },
  {
    "code": "2432",
    "name": "ディー・エヌ・エー",
    "sector": "情報・通信業",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        1367.33
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        -282.7
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        -286.82
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        -20.675330754097402
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        -20.97664791966826
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        -9.82531055900621
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        1.3524128091820868
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        -13.035791387342346
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        -8.5437344358788
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        0.7902015013828527
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        3091.50374395
      ]
    },
    "source": "jquants"
  },
  {
    "code": "2121",
    "name": "ミクシィ",
    "sector": "情報・通信業",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        1468.68,
        null
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        191.77,
        null
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        70.82,
        null
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        13.057303156575973,
        null
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        4.822017049323202,
        null
      ],
      "per": [
        null,
        null,
        null,
        null,
        25.854979440377097,
        null
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        1.0452566109034294,
        null
      ],
      "roe": [
        null,
        null,
        null,
        null,
        4.030046093438798,
        null
      ],
      "roa": [
        null,
        null,
        null,
        null,
        3.415612852195889,
        null
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        4.266873545384018,
        null
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        1900.781313,
        null
      ]
    },
    "source": "jquants"
  },
  {
    "code": "6752",
    "name": "パナソニックホールディングス",
    "sector": "電気機器",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        84964.2
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        3609.62
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        4439.94
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        4.248401091283152
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        5.225659748458763
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        17.60685558067399
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        1.720417955224954
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        9.402861515791407
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        4.717721819598893
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        1.0450880859958196
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        82193.21083653
      ]
    },
    "source": "jquants"
  },
  {
    "code": "6758",
    "name": "ソニーグループ",
    "sector": "電気機器",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        130207.68
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        12088.31
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        9705.73
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        9.283868662739401
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        7.454038041381277
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        3.970619949510967
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        0.503894314204668
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        12.513665041925037
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        2.8456300947387216
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        2.7156549520766773
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        39476.5581257
      ]
    },
    "source": "jquants"
  },
  {
    "code": "8035",
    "name": "東京エレクトロン",
    "sector": "電気機器",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        18305.27
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        4562.63
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        3639.63
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        24.925226451180453
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        19.88296266594265
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        65.99043062200957
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        13.707525092032832
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        20.67760115442739
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        14.81655323794954
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        0.759860788863109
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        243928.4495076
      ]
    },
    "source": "jquants"
  },
  {
    "code": "6841",
    "name": "横河電機",
    "sector": "電気機器",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        5401.52
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        788.0
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        616.85
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        14.588486203883352
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        11.419933648306403
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        24.417663841928203
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        3.4163081946115987
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        13.869184262180081
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        9.167501404440111
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        0.6975933031042902
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        15402.9294034
      ]
    },
    "source": "jquants"
  },
  {
    "code": "6594",
    "name": "ニデック",
    "sector": "電気機器",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        23471.59
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        1627.99
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        1251.44
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        6.936002205219161
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        5.33172230769198
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        11.905964461178199
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        0.9128481707832259
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        7.542493728852582
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        3.959457514075494
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        2.892402622445044
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        15461.65625524
      ]
    },
    "source": "jquants"
  },
  {
    "code": "7203",
    "name": "トヨタ自動車",
    "sector": "輸送用機器",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        450953.25
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        53529.34
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        49449.33
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        11.870263713588937
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        10.965511391701911
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        8.13794611138438
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        1.1725563539718475
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        14.032423083543739
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        5.487401244304233
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        2.5184687709872398
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        485860.3265588
      ]
    },
    "source": "jquants"
  },
  {
    "code": "7267",
    "name": "本田技研工業",
    "sector": "輸送用機器",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        204288.02
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        13819.77
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        11071.74
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        6.764846024744868
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        5.419671696852316
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        5.575969541349389
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        0.4790120827422539
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        8.512877875470402
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        3.7185746696379245
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        null
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        66501.6
      ]
    },
    "source": "jquants"
  },
  {
    "code": "7201",
    "name": "日産自動車",
    "sector": "輸送用機器",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        126857.16
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        5687.18
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        4266.49
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        4.483136781558093
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        3.363223644609417
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        3.1845749977369424
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        0.21997398829473264
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        6.593712459680741
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        2.1488076318331704
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        5.6850483229107445
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        14106.177764016002
      ]
    },
    "source": "jquants"
  },
  {
    "code": "7269",
    "name": "スズキ",
    "sector": "輸送用機器",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        53742.55
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        4655.63
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        2677.17
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        8.66283791893016
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        4.9814718505169555
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        12.897398843930635
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        1.382381413359148
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        8.530373945679912
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        4.9709615498165665
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        6.834733893557423
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        35067.86724
      ]
    },
    "source": "jquants"
  },
  {
    "code": "7270",
    "name": "SUBARU",
    "sector": "輸送用機器",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        47029.47
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        4681.98
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        3850.84
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        9.955417315993568
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        8.18814245620884
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        4.601335428122545
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        0.6872076141313115
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        15.010715702929062
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        7.999004600813145
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        4.524114383269313
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        17663.91385539
      ]
    },
    "source": "jquants"
  },
  {
    "code": "7202",
    "name": "いすゞ自動車",
    "sector": "輸送用機器",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        33866.76
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        2930.85
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        1764.42
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        8.654060795895445
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        5.209887216846252
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        9.429366736256089
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        1.111213621592808
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        10.635257129320825
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        5.407353537433792
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        4.243542435424354
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        16854.94405592
      ]
    },
    "source": "jquants"
  },
  {
    "code": "7211",
    "name": "三菱自動車工業",
    "sector": "輸送用機器",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        27895.89
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        1909.71
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        1547.09
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        6.84584718394
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        5.545942430945921
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        2.981629316148889
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        0.4562513797924792
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        14.81239994791547
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        6.303153022852184
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        3.225806451612903
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        4619.8757376
      ]
    },
    "source": "jquants"
  },
  {
    "code": "4188",
    "name": "三菱ケミカルグループ",
    "sector": "化学",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        43872.18
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        2618.31
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        1195.96
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        5.9680417066122535
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        2.7260099680480887
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        11.105031521351256
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        0.7531401005154847
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        5.255823458192613
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        1.9591407209715175
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        3.4275921165381322
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        14062.705766952
      ]
    },
    "source": "jquants"
  },
  {
    "code": "4005",
    "name": "住友化学",
    "sector": "化学",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        24468.93
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        -4888.26
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        -3118.38
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        -19.977416258087295
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        -12.74424341399481
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        -2.6918034506266713
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        0.8693516699410607
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        -26.781785108805995
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        -7.925093358828795
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        1.7533606078316777
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        8502.553461284999
      ]
    },
    "source": "jquants"
  },
  {
    "code": "4183",
    "name": "三井化学",
    "sector": "化学",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        17497.43
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        741.24
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        499.99
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        4.236279270727187
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        2.8575053593584885
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        7.4831742651811854
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        0.4336607089735595
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        5.077040554180214
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        2.2564568676412646
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        7.113821138211382
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        3952.6062792
      ]
    },
    "source": "jquants"
  },
  {
    "code": "4901",
    "name": "富士フイルムホールディングス",
    "sector": "化学",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        29609.16
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        2767.25
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        2435.09
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        9.345925382550535
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        8.22411037665371
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        14.50393000148302
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        1.114690819567497
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        7.673647274222698
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        5.090645683250199
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        5.112474437627812
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        36495.35657856
      ]
    },
    "source": "jquants"
  },
  {
    "code": "3407",
    "name": "旭化成",
    "sector": "化学",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        27848.78
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        1407.46
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        438.06
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        5.053937730844941
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        1.5729952981782327
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        48.90822784810126
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        1.181394282219844
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        2.3696531205625804
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        1.1959931526484344
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        2.329343254610159
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        21543.21955456
      ]
    },
    "source": "jquants"
  },
  {
    "code": "4021",
    "name": "日産化学",
    "sector": "化学",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        2267.05
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        482.01
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        380.33
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        21.261551355285505
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        16.776427515934806
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        25.313393446228282
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        4.208281283324701
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        16.471418734273698
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        11.758249911889642
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        2.374746597161888
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        9585.528
      ]
    },
    "source": "jquants"
  },
  {
    "code": "4502",
    "name": "武田薬品工業",
    "sector": "医薬品",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        42637.62
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        2140.75
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        1440.67
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        5.020800879598815
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        3.378870584239927
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        57.660983820175915
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        1.1454926697098085
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        1.9805732880304592
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        0.953530897771311
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        3.540489642184558
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        84026.4342975
      ]
    },
    "source": "jquants"
  },
  {
    "code": "4523",
    "name": "エーザイ",
    "sector": "医薬品",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        7417.51
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        534.08
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        424.06
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        7.200259925500606
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        5.71701285202177
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        31.78682537535506
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        1.5394744168831211
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        4.717150087599766
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        3.0424759954627607
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        3.404255319148936
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        13938.646603
      ]
    },
    "source": "jquants"
  },
  {
    "code": "4507",
    "name": "塩野義製薬",
    "sector": "医薬品",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        4350.81
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        1533.1
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        1620.3
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        35.23711676676297
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        37.24134126748812
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        5.641796923958389
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        0.7232621394879093
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        12.935886606810682
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        11.435382993228966
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        5.077753094255791
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        9685.73805915
      ]
    },
    "source": "jquants"
  },
  {
    "code": "9843",
    "name": "ニトリホールディングス",
    "sector": "小売業",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        8957.99
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        1277.25
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        865.23
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        14.258220873209279
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        9.658751572618412
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        2.940753898800972
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        0.28388351130427547
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        9.653266511065391
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        6.985102677933508
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        6.528980679546968
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        2576.69531244
      ]
    },
    "source": "jquants"
  },
  {
    "code": "7912",
    "name": "大日本印刷",
    "sector": "その他製品",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        14248.22
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        754.5
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        1109.29
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        5.295398302384438
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        7.7854637281007735
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        7.221520129987362
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        0.657600006576
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        8.969852517249716
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        5.672292648554507
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        2.0
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        8871.691072
      ]
    },
    "source": "jquants"
  },
  {
    "code": "7911",
    "name": "凸版印刷",
    "sector": "その他製品",
    "market": "東証プライム",
    "color": null,
    "financials": {
      "revenue": [
        null,
        null,
        null,
        null,
        null,
        16782.49
      ],
      "opIncome": [
        null,
        null,
        null,
        null,
        null,
        742.86
      ],
      "netIncome": [
        null,
        null,
        null,
        null,
        null,
        743.95
      ],
      "operatingMargin": [
        null,
        null,
        null,
        null,
        null,
        4.4263991815278905
      ],
      "netMargin": [
        null,
        null,
        null,
        null,
        null,
        4.432894046115922
      ],
      "per": [
        null,
        null,
        null,
        null,
        null,
        22.667012134559744
      ],
      "pbr": [
        null,
        null,
        null,
        null,
        null,
        1.162059606197061
      ],
      "roe": [
        null,
        null,
        null,
        null,
        null,
        4.746676943317423
      ],
      "roa": [
        null,
        null,
        null,
        null,
        null,
        3.0578896594868565
      ],
      "dividendYield": [
        null,
        null,
        null,
        null,
        null,
        0.9144598971232616
      ],
      "marketCap": [
        null,
        null,
        null,
        null,
        null,
        17253.7905376
      ]
    },
    "source": "jquants"
  }
];

// ---- 完成した企業データセットを構築 ---------------------------------------
// 予想成長率・自己資本比率・配当性向は、これらのフィールド抽出に対応する前の
// JSON（旧スキーマ）を読み込んだ場合には存在しないため、nullで埋めて補完する。
const OPTIONAL_FINANCIAL_FIELDS = [
  // 中核指標。実データには必ず含まれるが、欠けたJSONを読み込んでも
  // 描画時に例外にならないよう同様に補完対象にしておく。
  'revenue', 'opIncome', 'netIncome', 'marketCap',
  'operatingMargin', 'netMargin', 'per', 'pbr', 'roe', 'roa', 'dividendYield',
  'equityRatio', 'payoutRatio',
  'revenueGrowthForecast', 'opIncomeGrowthForecast', 'netIncomeGrowthForecast',
  'revenueForecast', 'opIncomeForecast', 'netIncomeForecast',
  'revenueGrowthYoy', 'opIncomeGrowthYoy', 'netIncomeGrowthYoy',
  'operatingCfMargin', 'cashAndEquivalents', 'totalAssets', 'freeCashFlow', 'freeCashFlowYield',
  // 予想EPS・予想PERと、その算出に使った基準株価／発行済株数。
  'eps', 'bps', 'forecastEps', 'forecastPer', 'refPrice', 'sharesOutstanding',
  'periodLabels',
  // EDINET DB由来データのみで埋まるフィールド（J-Quants由来の企業では常にnull）。
  'roic', 'greenblattRoic', 'evEbitda', 'psr', 'netCashRatio',
  'avgAnnualSalary', 'netIncomePerEmployee', 'revenuePerEmployee',
  'consecutiveDividendIncreaseYears', 'rndRatio', 'femaleDirectorRatio',
  'revenueCagr3y', 'opIncomeCagr3y', 'netIncomeCagr3y'
];
function normalizeFinancials(financials) {
  const n = FISCAL_YEARS.length;
  const normalized = Object.assign({}, financials);
  OPTIONAL_FINANCIAL_FIELDS.forEach((key) => {
    if (!Array.isArray(normalized[key])) {
      normalized[key] = new Array(n).fill(null);
    }
  });
  return normalized;
}

function buildCompanyDataset() {
  return COMPANIES_REAL.map((c) => Object.assign({}, c, {
    color: getSectorColor(c.sector),
    financials: normalizeFinancials(c.financials)
  }));
}

const COMPANIES = buildCompanyDataset();