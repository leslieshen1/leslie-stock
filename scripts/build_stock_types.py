"""给每只票打"股票类型"标签(成长/价值/周期/防御/垄断)→ stock-type-map.json。

Phase 1:规则法(sector/industry/概念关键词)+ 垄断/周期 curated 名单 + 手标覆盖。
够"先告诉你这是哪类股、该用什么尺子"用;AI 五方判读后续会输出更准的 type 覆盖它。

输出 web/public/data/stock-type-map.json: {sym: [primary, secondary?]}
用法: python scripts/build_stock_types.py
"""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
OUT = PUB / "stock-type-map.json"

# 明确的"垄断股"(估值要加垄断溢价、定性 > 定量)
MOAT = {"NVDA", "AAPL", "MSFT", "GOOGL", "GOOG", "META", "AVGO", "ASML", "TSM", "V", "MA",
        "COST", "ORCL", "ADBE", "NOW", "CRM", "NFLX", "LLY", "UNH", "AMZN", "ISRG", "INTU",
        "CDNS", "SNPS", "KLAC", "LRCX", "AMAT", "REGN", "VRTX", "CRWD"}
# 明确的"周期股"(别看 PE,看 EV/EBITDA + 周期位置)
CYCLICAL = {"MU", "WDC", "STX", "INTC", "XOM", "CVX", "COP", "OXY", "SLB", "HAL", "FCX",
            "AA", "X", "CLF", "NUE", "DOW", "LYB", "MOS", "CF", "MStr", "MSTR", "COIN",
            "RIO", "BHP", "VALE", "GLNG", "ZIM", "SBLK"}

SECTOR_RULE = {
    "Energy": "cyclical", "Basic Materials": "cyclical", "Materials": "cyclical",
    "Consumer Staples": "defensive", "Utilities": "defensive", "Real Estate": "defensive",
    "Finance": "value", "Financials": "value", "Financial": "value",
    "Industrials": "value", "Industrial": "value",
    "Technology": "growth", "Health Care": "growth", "Healthcare": "growth",
    "Consumer Discretionary": "growth", "Communication Services": "growth",
    "Telecommunications": "growth", "Miscellaneous": "growth",
}

OVERRIDE = {
    "688017": ["growth", "moat"],   # 绿的谐波:成长(人形渗透)× 垄断(谐波减速器卡脖子)
}


def classify_us(sym, sector, industry):
    if sym in OVERRIDE:
        return OVERRIDE[sym]
    ind = (industry or "").lower()
    base = SECTOR_RULE.get(sector, "growth")
    # 行业关键词修正
    if any(k in ind for k in ["memory", "dram", "nand", "oil", "gas", "mining", "steel", "metal", "shipping", "tanker", "coal"]):
        base = "cyclical"
    if sym in CYCLICAL:
        base = "cyclical"
    if "reit" in ind or "real estate" in ind:
        base = "defensive"
    types = [base]
    if sym in MOAT and "moat" not in types:
        types = ["moat", base] if base != "moat" else ["moat"]
    return types


def classify_a(code, name, sector, concepts):
    if code in OVERRIDE:
        return OVERRIDE[code]
    text = f"{name} {sector} {' '.join(concepts or [])}"
    if any(k in text for k in ["银行", "保险", "证券"]):
        return ["value"]
    if any(k in text for k in ["电力", "燃气", "水务", "公用", "高速公路", "港口"]):
        return ["defensive"]
    if any(k in text for k in ["金属", "矿", "稀土", "锂", "钢", "煤", "有色", "石油", "化工", "猪", "周期"]):
        return ["cyclical"]
    return ["growth"]  # A 股供应链成长/主题为主


def main():
    out = {}
    us = json.load(open(PUB / "us-stocks.json", encoding="utf-8")).get("stocks", [])
    for s in us:
        out[s["sym"]] = classify_us(s["sym"], s.get("sector"), s.get("industry"))
    man = json.load(open(PUB / "aleabit_manifest.json", encoding="utf-8"))
    for e in man:
        out[e["code"]] = classify_a(e["code"], e.get("name", ""), e.get("sector", ""), e.get("concepts"))
    # 手标兜底(保证覆盖)
    out.update(OVERRIDE)

    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    from collections import Counter
    c = Counter(v[0] for v in out.values())
    print(f"✓ stock-type-map.json: {len(out)} 只 · 主类型分布 {dict(c)}")
    print(f"  688017 = {out.get('688017')}")


if __name__ == "__main__":
    main()
