"""单股深度快照：聚合 BG 评估所需的所有数据。

包括：
- 实时行情 + 估值（来自 east_money，已绕过反爬）
- 财务关键指标（5 年 ROE / 毛利率 / FCF / 负债率 / 商誉等）
- 估值历史（PE / PB / 股息率，用于历史分位计算）

数据源策略：
1. 优先用 east_money（curl_cffi 已绕过反爬）
2. 退化到 akshare 的个股接口（数据源不同，有些能用）
3. 财务数据缺失时 graceful degrade，不报错，让 bg_evaluate 处理
"""
from __future__ import annotations

from typing import Any

import pandas as pd

from .east_money import fetch_single_quote


def snapshot(code: str, market: str = "a") -> dict:
    """对一只股票，聚合 BG 评估需要的所有数据。

    Args:
        code: 股票代码（A 股 6 位，港股 5 位）
        market: "a" / "hk"
    """
    quote = fetch_single_quote(code, market)

    if market == "a":
        financials = _fetch_a_financials(code)
        valuation_hist = _fetch_a_valuation_history(code)
    else:
        financials = _fetch_hk_financials(code)
        valuation_hist = None

    return {
        "code": code,
        "name": quote.get("name"),
        "market": market,
        "quote": quote,
        "financials": financials,
        "valuation_history": valuation_hist,
    }


# ----- A 股财务数据 -----

def _fetch_a_financials(code: str) -> dict | None:
    """A 股近 5 年关键财务指标。"""
    try:
        import akshare as ak
    except ImportError:
        return None

    metrics: dict[str, Any] = {}

    # 1. 财务分析指标（新浪源，多年）
    try:
        df = ak.stock_financial_analysis_indicator(symbol=code, start_year="2019")
        if df is not None and len(df) > 0:
            metrics.update(_extract_a_metrics_sina(df))
    except Exception as e:
        metrics["_sina_error"] = str(e)[:120]

    # 2. 主要指标摘要（东财源，备份）
    if "roe_avg_5y" not in metrics:
        try:
            df = ak.stock_financial_abstract(symbol=code)
            if df is not None and len(df) > 0:
                metrics.update(_extract_a_metrics_em(df))
        except Exception as e:
            metrics["_em_error"] = str(e)[:120]

    return metrics if metrics else None


def _extract_a_metrics_sina(df: pd.DataFrame) -> dict:
    """从新浪财务分析指标 DataFrame 提取 BG 需要的字段（含 5 年逐年明细）."""
    out: dict[str, Any] = {}
    df = df.copy()
    if "日期" in df.columns:
        df["日期"] = pd.to_datetime(df["日期"], errors="coerce")
        df = df.sort_values("日期", ascending=False)

    annual_mask = df["日期"].dt.month == 12 if "日期" in df.columns else None
    annual = df[annual_mask].head(5) if annual_mask is not None else df.head(5)

    # 历史明细（最近 5 年，从老到新方便绘图）
    history: dict[str, list] = {"dates": []}
    annual_chrono = annual.iloc[::-1]
    if "日期" in annual_chrono.columns:
        history["dates"] = [d.strftime("%Y") for d in annual_chrono["日期"] if pd.notna(d)]

    def _col_to_history(col: str, key: str) -> list[float | None]:
        if col not in annual_chrono.columns:
            return []
        vals = pd.to_numeric(annual_chrono[col], errors="coerce")
        return [None if pd.isna(v) else float(v) for v in vals]

    if "净资产收益率(%)" in annual.columns:
        vals = pd.to_numeric(annual["净资产收益率(%)"], errors="coerce").dropna()
        if len(vals) > 0:
            out["roe_avg_5y"] = float(vals.mean())
            out["roe_latest"] = float(vals.iloc[0])
        history["roe"] = _col_to_history("净资产收益率(%)", "roe")

    if "销售毛利率(%)" in annual.columns:
        vals = pd.to_numeric(annual["销售毛利率(%)"], errors="coerce").dropna()
        if len(vals) > 0:
            out["gross_margin_avg_5y"] = float(vals.mean())
            out["gross_margin_latest"] = float(vals.iloc[0])
        history["gross_margin"] = _col_to_history("销售毛利率(%)", "gross_margin")

    if "销售净利率(%)" in annual.columns:
        vals = pd.to_numeric(annual["销售净利率(%)"], errors="coerce").dropna()
        if len(vals) > 0:
            out["net_margin_avg_5y"] = float(vals.mean())
        history["net_margin"] = _col_to_history("销售净利率(%)", "net_margin")

    if "资产负债率(%)" in annual.columns:
        vals = pd.to_numeric(annual["资产负债率(%)"], errors="coerce").dropna()
        if len(vals) > 0:
            out["debt_ratio"] = float(vals.iloc[0])
        history["debt_ratio"] = _col_to_history("资产负债率(%)", "debt_ratio")

    if "总资产净利润率(%)" in annual.columns:
        vals = pd.to_numeric(annual["总资产净利润率(%)"], errors="coerce").dropna()
        if len(vals) > 0:
            out["roa_avg_5y"] = float(vals.mean())
        history["roa"] = _col_to_history("总资产净利润率(%)", "roa")

    if "经营现金净流量与净利润的比率(%)" in annual.columns:
        vals = pd.to_numeric(annual["经营现金净流量与净利润的比率(%)"], errors="coerce").dropna()
        if len(vals) > 0:
            avg = float(vals.mean())
            ratio = avg / 100 if avg > 10 else avg
            if 0.1 <= ratio <= 10:
                out["ocf_to_ni_avg_5y"] = ratio
        history["ocf_to_ni"] = _col_to_history("经营现金净流量与净利润的比率(%)", "ocf_to_ni")

    out["history"] = history
    return out


def _extract_a_metrics_em(df: pd.DataFrame) -> dict:
    """从东财财务摘要 DataFrame 提取 BG 需要的字段（如果新浪源失败时使用）。"""
    out: dict[str, Any] = {}
    # 东财 stock_financial_abstract 返回的列结构有些不同
    # 通常列是日期，行是指标名（"净资产收益率"、"毛利率"等）
    if df is None or len(df) == 0:
        return out
    if "选项" in df.columns or "指标" in df.columns:
        idx_col = "选项" if "选项" in df.columns else "指标"
        df_t = df.set_index(idx_col).T   # 转置：列=指标，行=日期
        df_t.index = pd.to_datetime(df_t.index, errors="coerce")
        df_t = df_t.sort_index(ascending=False)
        df_t = df_t.head(5)

        for key, target in [
            ("净资产收益率(%)", "roe_avg_5y"),
            ("毛利率(%)", "gross_margin_avg_5y"),
            ("资产负债率(%)", "debt_ratio"),
        ]:
            if key in df_t.columns:
                vals = pd.to_numeric(df_t[key], errors="coerce").dropna()
                if len(vals) > 0:
                    out[target] = float(vals.mean())
    return out


def _fetch_a_valuation_history(code: str) -> pd.DataFrame | None:
    """A 股估值历史（PE/PB/股息率）。"""
    try:
        import akshare as ak
        df = ak.stock_a_indicator_lg(symbol=code)
        if df is None or len(df) == 0:
            return None
        return df
    except Exception:
        return None


# ----- 港股财务数据 -----

def _fetch_hk_financials(code: str) -> dict | None:
    """港股近 5 年关键财务指标。"""
    try:
        import akshare as ak
    except ImportError:
        return None

    metrics: dict[str, Any] = {}

    try:
        # akshare 港股财务分析指标接口
        df = ak.stock_financial_hk_analysis_indicator_em(symbol=code, indicator="年度")
        if df is not None and len(df) > 0:
            metrics.update(_extract_hk_metrics(df))
    except Exception as e:
        metrics["_hk_error"] = str(e)[:120]

    return metrics if metrics else None


def _extract_hk_metrics(df: pd.DataFrame) -> dict:
    """从港股财务指标 DataFrame 提取 BG 需要的字段。"""
    out: dict[str, Any] = {}
    df = df.copy()
    # 取最近 5 年年报
    if "REPORT_DATE" in df.columns:
        df["REPORT_DATE"] = pd.to_datetime(df["REPORT_DATE"], errors="coerce")
        df = df.sort_values("REPORT_DATE", ascending=False).head(5)

    # 港股字段映射（可能是英文 colname）
    field_map = {
        "ROE_AVG": "roe_avg_5y",
        "GROSS_PROFIT_RATIO": "gross_margin_avg_5y",
        "DEBT_ASSET_RATIO": "debt_ratio",
        "ROA": "roa_avg_5y",
    }
    for src, tgt in field_map.items():
        if src in df.columns:
            vals = pd.to_numeric(df[src], errors="coerce").dropna()
            if len(vals) > 0:
                out[tgt] = float(vals.mean())
    return out


if __name__ == "__main__":
    import sys
    import json

    code = sys.argv[1] if len(sys.argv) > 1 else "600519"
    market = sys.argv[2] if len(sys.argv) > 2 else "a"

    snap = snapshot(code, market)
    print(f"=== {snap['name']} ({code}) [{market.upper()}] ===\n")
    print("--- Quote ---")
    print(json.dumps(snap["quote"], ensure_ascii=False, indent=2))
    print()
    print("--- Financials ---")
    print(json.dumps(snap["financials"], ensure_ascii=False, indent=2))
    print()
    if snap.get("valuation_history") is not None:
        vh = snap["valuation_history"]
        print(f"--- Valuation History --- ({len(vh)} 行)")
        print(vh.tail(3))
