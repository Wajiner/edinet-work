# ==========================================================================
# EDINET DB (edinetdb.jp) キャッシュ → サイト用データセット組み立てスクリプト
# --------------------------------------------------------------------------
# edinetdb_bulk_download.py が edinetdb_cache/raw/ に保存した生レスポンスから、
# サイトが読み込める形式（{formatVersion, fiscalYears, meta, companies:[...]}）
# のJSONを組み立てる。APIを一切呼ばないため、フィールドマッピングのロジックを
# 直しても再ダウンロードせずに何度でも無料で再実行できる。
#
# 実行方法:
#   python edinetdb_build_dataset.py
#
# 出力したJSONは、サイトの「データ管理」モーダル→「JSONを読み込む」から
# そのままアップロードできる。
# ==========================================================================

import json
import os
from datetime import datetime, timezone

# どのディレクトリから実行されても迷子にならないよう、相対パスは実行時の
# カレントディレクトリではなく、このスクリプト自身の場所を基準にする。
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

CACHE_DIR = os.path.join(BASE_DIR, "edinetdb_cache")
RAW_DIR = os.path.join(CACHE_DIR, "raw")
MASTER_FILE = os.path.join(CACHE_DIR, "companies_master.json")

OUTPUT_FILENAME = os.path.join(BASE_DIR, "edinetdb_dataset_universe_prime.json")

# 保持する期間スロット数。/ratios が最大15年分を返すためこれに合わせる
# （/financials は6年分だが、periodLabelsで会社ごとに実際の年数がわかる）。
N_SLOTS = 15


def load_json(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def build_company_record(fin_payload, ratios_payload, earnings_payload, n_slots=N_SLOTS):
    """1社ぶんの生レスポンスから、サイト用financialsを組み立てる。
    利用可能な期間が1つも無ければ (0, None) を返す。"""
    fin_rows = (fin_payload or {}).get("data") or []
    ratios_rows = (ratios_payload or {}).get("data") or []
    fin_by_year = {r["fiscal_year"]: r for r in fin_rows if r.get("fiscal_year") is not None}
    ratios_by_year = {r["fiscal_year"]: r for r in ratios_rows if r.get("fiscal_year") is not None}

    years = sorted(set(fin_by_year) | set(ratios_by_year))
    if not years:
        return 0, None
    years = years[-n_slots:]
    slot_years = [None] * (n_slots - len(years)) + years

    earnings_rows = ((earnings_payload or {}).get("data") or {}).get("earnings") or []
    # /earnings は開示日が新しい順に返る（実測確認済み）。最新の1件を
    # 「現在の会社予想」のスナップショットとして使う。
    latest_earnings = earnings_rows[0] if earnings_rows else None

    fy_month = None
    if latest_earnings and latest_earnings.get("fiscal_year_end"):
        try:
            fy_month = int(str(latest_earnings["fiscal_year_end"])[5:7])
        except (ValueError, TypeError):
            fy_month = None

    def label(y):
        if y is None:
            return None
        return f"{y}/{fy_month:02d}期" if fy_month else f"{y}年度"

    period_labels = [label(y) for y in slot_years]

    revenue = [None] * n_slots
    op_income = [None] * n_slots
    net_income = [None] * n_slots
    operating_margin = [None] * n_slots
    net_margin = [None] * n_slots
    per = [None] * n_slots
    pbr = [None] * n_slots
    roe = [None] * n_slots
    roa = [None] * n_slots
    dividend_yield = [None] * n_slots
    market_cap = [None] * n_slots
    equity_ratio = [None] * n_slots
    payout_ratio = [None] * n_slots
    operating_cf_margin = [None] * n_slots
    cash_and_equivalents = [None] * n_slots
    total_assets = [None] * n_slots
    free_cash_flow = [None] * n_slots
    free_cash_flow_yield = [None] * n_slots
    revenue_growth_yoy = [None] * n_slots
    op_income_growth_yoy = [None] * n_slots
    net_income_growth_yoy = [None] * n_slots
    eps = [None] * n_slots
    bps = [None] * n_slots
    shares_outstanding = [None] * n_slots
    revenue_forecast = [None] * n_slots
    op_income_forecast = [None] * n_slots
    net_income_forecast = [None] * n_slots
    revenue_growth_forecast = [None] * n_slots
    op_income_growth_forecast = [None] * n_slots
    net_income_growth_forecast = [None] * n_slots
    forecast_eps = [None] * n_slots
    forecast_per = [None] * n_slots

    # J-Quantsには無く、EDINET DBだけにあるフィールド。
    roic = [None] * n_slots
    greenblatt_roic = [None] * n_slots
    ev_ebitda = [None] * n_slots
    psr = [None] * n_slots
    net_cash_ratio = [None] * n_slots
    avg_annual_salary = [None] * n_slots
    net_income_per_employee = [None] * n_slots
    revenue_per_employee = [None] * n_slots
    consecutive_dividend_increase_years = [None] * n_slots
    rnd_ratio = [None] * n_slots
    female_director_ratio = [None] * n_slots
    revenue_cagr_3y = [None] * n_slots
    op_income_cagr_3y = [None] * n_slots
    net_income_cagr_3y = [None] * n_slots

    raw_financials = {}
    raw_ratios = {}

    for i, y in enumerate(slot_years):
        if y is None:
            continue
        fin = fin_by_year.get(y)
        rat = ratios_by_year.get(y)

        if fin:
            for k, v in fin.items():
                if is_number(v):
                    raw_financials.setdefault(k, [None] * n_slots)[i] = v
            rev = fin.get("revenue")
            op = fin.get("operating_income")
            ni = fin.get("net_income")
            if rev is not None:
                revenue[i] = rev / 1e8
            if op is not None:
                op_income[i] = op / 1e8
            if ni is not None:
                net_income[i] = ni / 1e8
            if fin.get("eps") is not None:
                eps[i] = fin["eps"]
            if fin.get("bps") is not None:
                bps[i] = fin["bps"]
            if fin.get("cash") is not None:
                cash_and_equivalents[i] = fin["cash"] / 1e8
            if fin.get("total_assets") is not None:
                total_assets[i] = fin["total_assets"] / 1e8
            cfo = fin.get("cf_operating")
            if cfo is not None and rev:
                operating_cf_margin[i] = (cfo / rev) * 100
            shares = fin.get("shares_issued_fiscal_year_end")
            if shares is None:
                shares = fin.get("shares_issued")
            if shares is not None:
                shares_outstanding[i] = shares
            if fin.get("avg_annual_salary") is not None:
                avg_annual_salary[i] = fin["avg_annual_salary"] / 10000  # 円 -> 万円
            if fin.get("female_director_ratio") is not None:
                female_director_ratio[i] = fin["female_director_ratio"] * 100

        if rat:
            for k, v in rat.items():
                if is_number(v):
                    raw_ratios.setdefault(k, [None] * n_slots)[i] = v
            if rat.get("per") is not None:
                per[i] = rat["per"]
            if rat.get("pbr") is not None:
                pbr[i] = rat["pbr"]
            if rat.get("roe") is not None:
                roe[i] = rat["roe"] * 100
            if rat.get("roa") is not None:
                roa[i] = rat["roa"] * 100
            if rat.get("dividend_yield") is not None:
                dividend_yield[i] = rat["dividend_yield"] * 100
            if rat.get("market_cap") is not None:
                market_cap[i] = rat["market_cap"] / 1e8
            if rat.get("equity_ratio") is not None:
                equity_ratio[i] = rat["equity_ratio"] * 100
            if rat.get("payout_ratio") is not None:
                payout_ratio[i] = rat["payout_ratio"] * 100
            if rat.get("net_margin") is not None:
                net_margin[i] = rat["net_margin"] * 100
            if rat.get("operating_margin") is not None:
                operating_margin[i] = rat["operating_margin"] * 100
            if rat.get("revenue_growth") is not None:
                revenue_growth_yoy[i] = rat["revenue_growth"] * 100
            if rat.get("ni_growth") is not None:
                net_income_growth_yoy[i] = rat["ni_growth"] * 100
            if rat.get("oi_growth") is not None:
                op_income_growth_yoy[i] = rat["oi_growth"] * 100
            if rat.get("fcf") is not None:
                free_cash_flow[i] = rat["fcf"] / 1e8
            if rat.get("fcf_yield") is not None:
                free_cash_flow_yield[i] = rat["fcf_yield"] * 100
            if rat.get("roic") is not None:
                roic[i] = rat["roic"] * 100
            if rat.get("greenblatt_roic") is not None:
                greenblatt_roic[i] = rat["greenblatt_roic"] * 100
            if rat.get("ev_ebitda") is not None:
                ev_ebitda[i] = rat["ev_ebitda"]
            if rat.get("psr") is not None:
                psr[i] = rat["psr"]
            if rat.get("net_cash_ratio") is not None:
                net_cash_ratio[i] = rat["net_cash_ratio"] * 100
            if rat.get("net_income_per_employee") is not None:
                net_income_per_employee[i] = rat["net_income_per_employee"] / 10000  # 円 -> 万円
            if rat.get("revenue_per_employee") is not None:
                revenue_per_employee[i] = rat["revenue_per_employee"] / 10000
            if rat.get("consecutive_dividend_increase_years") is not None:
                consecutive_dividend_increase_years[i] = rat["consecutive_dividend_increase_years"]
            if rat.get("rnd_ratio") is not None:
                rnd_ratio[i] = rat["rnd_ratio"] * 100
            if rat.get("revenue_cagr_3y") is not None:
                revenue_cagr_3y[i] = rat["revenue_cagr_3y"] * 100
            if rat.get("oi_cagr_3y") is not None:
                op_income_cagr_3y[i] = rat["oi_cagr_3y"] * 100
            if rat.get("ni_cagr_3y") is not None:
                net_income_cagr_3y[i] = rat["ni_cagr_3y"] * 100

        # ratiosにoperating_margin/net_marginが無い期は、financialsの実額から計算する。
        if operating_margin[i] is None and fin:
            rev, op = fin.get("revenue"), fin.get("operating_income")
            if rev and op is not None:
                operating_margin[i] = (op / rev) * 100
        if net_margin[i] is None and fin:
            rev, ni = fin.get("revenue"), fin.get("net_income")
            if rev and ni is not None:
                net_margin[i] = (ni / rev) * 100

    # 会社予想（/earningsの最新開示）は、最新スロット（末尾）にのみ付与する。
    # J-Quants版のNxFSales等が「最新開示に添付された翌期予想」を最新スロットの
    # 位置に置いていたのと同じ考え方。過去スロットの予想値は復元できない
    # （/earningsは直近の開示のみを保持し、過去分は遡って取得できないため）。
    last_idx = n_slots - 1
    if latest_earnings and slot_years[last_idx] is not None:
        rf = latest_earnings.get("forecast_revenue")
        of = latest_earnings.get("forecast_operating_income")
        nf = latest_earnings.get("forecast_net_income")
        if rf is not None:
            revenue_forecast[last_idx] = rf / 100  # 百万円 -> 億円
        if of is not None:
            op_income_forecast[last_idx] = of / 100
        if nf is not None:
            net_income_forecast[last_idx] = nf / 100
        if latest_earnings.get("forecast_revenue_change") is not None:
            revenue_growth_forecast[last_idx] = latest_earnings["forecast_revenue_change"]
        if latest_earnings.get("forecast_operating_income_change") is not None:
            op_income_growth_forecast[last_idx] = latest_earnings["forecast_operating_income_change"]
        if latest_earnings.get("forecast_net_income_change") is not None:
            net_income_growth_forecast[last_idx] = latest_earnings["forecast_net_income_change"]
        feps = latest_earnings.get("forecast_eps")
        if feps is not None:
            forecast_eps[last_idx] = feps
            cur_per, cur_eps = per[last_idx], eps[last_idx]
            # 基準株価が直接取れないため、実績PER×実績EPSで想定株価を逆算し、
            # それを予想EPSに適用して予想PERを求める。
            if cur_per is not None and cur_eps and feps:
                forecast_per[last_idx] = (cur_per * cur_eps) / feps

    financials = {
        "revenue": revenue, "opIncome": op_income, "netIncome": net_income,
        "operatingMargin": operating_margin, "netMargin": net_margin,
        "per": per, "pbr": pbr, "roe": roe, "roa": roa,
        "dividendYield": dividend_yield, "marketCap": market_cap,
        "equityRatio": equity_ratio, "payoutRatio": payout_ratio,
        "operatingCfMargin": operating_cf_margin,
        "cashAndEquivalents": cash_and_equivalents,
        "totalAssets": total_assets,
        "freeCashFlow": free_cash_flow, "freeCashFlowYield": free_cash_flow_yield,
        "revenueGrowthYoy": revenue_growth_yoy, "opIncomeGrowthYoy": op_income_growth_yoy,
        "netIncomeGrowthYoy": net_income_growth_yoy,
        "revenueForecast": revenue_forecast, "opIncomeForecast": op_income_forecast,
        "netIncomeForecast": net_income_forecast,
        "revenueGrowthForecast": revenue_growth_forecast,
        "opIncomeGrowthForecast": op_income_growth_forecast,
        "netIncomeGrowthForecast": net_income_growth_forecast,
        "eps": eps, "bps": bps, "forecastEps": forecast_eps, "forecastPer": forecast_per,
        "refPrice": [None] * n_slots,  # EDINET DBに基準株価フィールドが無いため常にnull
        "sharesOutstanding": shares_outstanding,
        "periodLabels": period_labels,
        # J-Quantsには無く、EDINET DBだけにあるフィールド。
        "roic": roic, "greenblattRoic": greenblatt_roic,
        "evEbitda": ev_ebitda, "psr": psr, "netCashRatio": net_cash_ratio,
        "avgAnnualSalary": avg_annual_salary,
        "netIncomePerEmployee": net_income_per_employee,
        "revenuePerEmployee": revenue_per_employee,
        "consecutiveDividendIncreaseYears": consecutive_dividend_increase_years,
        "rndRatio": rnd_ratio, "femaleDirectorRatio": female_director_ratio,
        "revenueCagr3y": revenue_cagr_3y, "opIncomeCagr3y": op_income_cagr_3y,
        "netIncomeCagr3y": net_income_cagr_3y,
        "raw": {
            "financials": raw_financials,
            "ratios": raw_ratios,
            "earningsLatest": latest_earnings,
        },
    }
    matched = sum(1 for y in slot_years if y is not None)
    return matched, financials


def main():
    if not os.path.exists(MASTER_FILE):
        raise SystemExit(f"{MASTER_FILE} が見つかりません。先に edinetdb_bulk_download.py を実行してください。")
    with open(MASTER_FILE, encoding="utf-8") as f:
        master = json.load(f)

    companies_out = []
    skipped_no_data = 0
    total_years_sum = 0

    for entry in master["companies"]:
        ec = entry["edinetCode"]
        fin_payload = load_json(os.path.join(RAW_DIR, f"{ec}_financials.json"))
        ratios_payload = load_json(os.path.join(RAW_DIR, f"{ec}_ratios.json"))
        earnings_payload = load_json(os.path.join(RAW_DIR, f"{ec}_earnings.json"))
        profile_payload = load_json(os.path.join(RAW_DIR, f"{ec}_profile.json"))
        analysis_payload = load_json(os.path.join(RAW_DIR, f"{ec}_analysis.json"))

        if fin_payload is None and ratios_payload is None:
            skipped_no_data += 1
            continue

        matched, fin_data = build_company_record(fin_payload, ratios_payload, earnings_payload)
        if matched == 0:
            skipped_no_data += 1
            continue

        total_years_sum += matched
        business_summary = ((profile_payload or {}).get("data") or {}).get("business_summary")
        ai_summary = (((analysis_payload or {}).get("data") or {}).get("ai_summary") or {}).get("text")
        companies_out.append({
            "code": entry["code"], "name": entry["name"],
            "sector": entry["sector"], "market": entry["market"],
            "color": None, "financials": fin_data, "source": "edinetdb",
            "fetchedAt": datetime.now().date().isoformat(),
            "businessSummary": business_summary, "aiSummary": ai_summary,
        })

    fiscal_years_placeholder = [f"{N_SLOTS - 1 - i}期前" for i in range(N_SLOTS - 1)] + ["最新期"]

    payload = {
        "formatVersion": 1,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "fiscalYears": fiscal_years_placeholder,
        "meta": {
            "type": "edinetdb",
            "downloadedAt": datetime.now(timezone.utc).isoformat(),
            "markets": sorted({c["market"] for c in companies_out if c.get("market")}),
            "companyCount": len(companies_out),
            "skippedNoData": skipped_no_data,
            "avgYearsPerCompany": round(total_years_sum / len(companies_out), 1) if companies_out else 0,
            "sourceMasterBuiltAt": master.get("builtAt"),
        },
        "companies": companies_out,
    }

    tmp = OUTPUT_FILENAME + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUTPUT_FILENAME)

    size_mb = os.path.getsize(OUTPUT_FILENAME) / 1024 / 1024
    print(f"{len(companies_out)}社を {OUTPUT_FILENAME} に書き出しました（{size_mb:.1f}MB）。")
    print(f"データが無く除外した銘柄: {skipped_no_data}社")
    if companies_out:
        print(f"1社あたり平均{payload['meta']['avgYearsPerCompany']}期分のデータ")
    print("\nサイトの「データ管理」モーダル→「JSONを読み込む」からアップロードしてください。")


if __name__ == "__main__":
    main()
