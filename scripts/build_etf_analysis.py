"""ETF 段永平/巴菲特镜头 —— Nasdaq ETF screener + 逐只 summary(AUM/费率/beta/yield)
→ 规则分类(类型 + BG 判决)→ web/public/data/etf-analyses.json。

判决逻辑(段永平/巴菲特 DNA):
  - 宽基 + 低费率(≤0.10%)→ 指数定投友好(巴菲特唯一推荐普通人买的:低费率标普500)
  - 杠杆/反向 → 投机工具(段永平 Stop Doing:不杠杆、不做空;长期波动损耗)
  - 商品 → 配置/对冲·不生息(巴菲特:黄金不下蛋)
  - 行业/主题 → 择时押注,看清成分再说
  - 债券 → 配置/避险工具
LLM 一句话 thesis 另由 workflow 补(只补 top AUM)。

用法: uv run python scripts/build_etf_analysis.py [--limit N]
"""
from __future__ import annotations
import argparse, json, re, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import requests

ROOT = Path(__file__).parent.parent
OUT = ROOT / "web" / "public" / "data" / "etf-analyses.json"
CACHE = ROOT / "data" / "congress-cache"  # 复用缓存目录放 etf-summary 缓存
NH = {"user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "accept": "application/json", "origin": "https://www.nasdaq.com", "referer": "https://www.nasdaq.com/"}
SCREENER = "https://api.nasdaq.com/api/screener/etf?tableonly=true&limit=10000&download=true"


def num(x):
    if x in (None, "", "N/A", "--"):
        return None
    try:
        return float(str(x).replace("$", "").replace(",", "").replace("%", "").strip())
    except (ValueError, TypeError):
        return None


# ---------- 类型分类(从名字 + 费率)----------
KW = {
    "杠杆反向": r"\b(2x|3x|ultra|ultrapro|leveraged|inverse|bear|bull|daily|-1x|short|geared)\b",
    "债券": r"(bond|treasur|aggregate|fixed income|municipal|\bmuni\b|corporate|t-bill|\btips\b|duration|floating rate|senior loan|investment grade|\bagg\b|ultrashort)",
    "商品": r"(gold|silver|copper|crude|\boil\b|natural gas|commodit|platinum|palladium|uranium|metals?\b|carbon)",
    "宽基": r"(s&p ?500|total (stock |us )?market|total us|russell (1000|2000|3000)|nasdaq-?100|dow jones industrial|total world|all-?world|broad market|core s&p|core msci|msci (usa|world|acwi|eafe|emerging)|ftse (developed|emerging|all-?world|global)|developed markets|emerging markets|total international|extended market|mid-?cap index|small-?cap index)",
    "行业": r"(technology|financ|energy|health ?care|utilit|industrial|materials?|consumer|real estate|communication|biotech|semiconductor|\bbank|insurance|pharma|aerospace|defen[cs]e|\breit)",
    "主题": r"(\bai\b|artificial intelligence|robot|clean energy|solar|cyber|cloud|innovation|disrupt|cannabis|blockchain|crypto|bitcoin|ether|\bspace\b|genomic|electric vehicle|\bev\b|lithium|water|infrastructure|nuclear|quantum)",
    "因子/红利": r"(dividend|high yield equity|low volatility|min(imum)? vol|momentum|quality|equal weight|buffer|covered call|\bincome\b|growth|value|esg|multifactor)",
}
ORDER = ["杠杆反向", "债券", "商品", "宽基", "行业", "主题", "因子/红利"]

# 名字不含关键词的知名 ETF,直接按代码定型
SYMBOL_OVERRIDE = {
    **{s: "宽基" for s in "SPY IVV VOO VTI ITOT SCHB SCHX SPLG SPTM QQQ QQQM ONEQ DIA IWM IWB IWV VV VTHR SCHK QQEW".split()},
    **{s: "宽基" for s in "VEA VWO IEMG VXUS IXUS SCHF ACWI VT VEU SPDW SPEM SCHE GWX".split()},  # 国际宽基
    **{s: "因子/红利" for s in "VTV VUG VIG SCHD VYM DGRO MGK MGV".split()},
}


def classify(sym: str, name: str) -> str:
    if sym in SYMBOL_OVERRIDE:
        return SYMBOL_OVERRIDE[sym]
    n = name.lower()
    for t in ORDER:
        if re.search(KW[t], n):
            return t
    return "混合/其他"


def verdict(kind: str, expense: float | None) -> dict:
    e = expense
    if kind == "杠杆反向":
        return {"tag": "投机工具", "cls": "down", "why": "杠杆/反向,日内复利损耗,段永平 Stop Doing:不杠杆不做空,不是投资是赌场工具。"}
    if kind == "宽基":
        if e is not None and e <= 0.10:
            return {"tag": "指数定投友好", "cls": "up", "why": f"低费率宽基({e:g}%)——巴菲特唯一推荐普通人买的东西:长期定投、躺着拿。"}
        if e is not None and e <= 0.30:
            return {"tag": "可长持·费率尚可", "cls": "up", "why": f"宽基底子好,费率 {e:g}% 中等,长持可以但有更便宜的同类。"}
        return {"tag": "宽基·费率偏高", "cls": "neutral", "why": f"宽基逻辑没错,但费率{'' if e is None else f' {e:g}%'}偏高,长期复利被费率吃掉,找更便宜的。"}
    if kind == "商品":
        return {"tag": "配置/对冲·不生息", "cls": "neutral", "why": "商品不产生现金流(巴菲特:黄金不下蛋),只能做配置/对冲,不是生意。"}
    if kind == "债券":
        return {"tag": "配置/避险工具", "cls": "neutral", "why": "债券是配置和避险工具,看久期和信用,不是成长资产。"}
    if kind in ("行业", "主题"):
        hi = (e is not None and e >= 0.50)
        return {"tag": "择时押注·看清成分", "cls": "down" if hi else "neutral",
                "why": f"押注单一{'赛道' if kind=='主题' else '行业'},本质是择时{'+高费率('+format(e,'g')+'%)更要小心' if hi else ''};看清前十大成分再决定。"}
    if kind == "因子/红利":
        return {"tag": "策略增强·懂了再买", "cls": "neutral", "why": "因子/红利/buffer 等策略型,逻辑要自己看懂,别被名字买了。"}
    return {"tag": "看清成分再说", "cls": "neutral", "why": "混合型,先搞清它到底装了什么。"}


def fetch_summary(sym: str) -> dict:
    try:
        d = requests.get(f"https://api.nasdaq.com/api/quote/{sym}/summary?assetclass=etf",
                         headers=NH, timeout=10).json().get("data") or {}
        sd = d.get("summaryData") or {}
        g = lambda k: (sd.get(k) or {}).get("value")
        return {"aum": num(g("AUM")), "expense": num(g("ExpenseRatio")),
                "beta": num(g("Beta")), "yield": num(g("Yield"))}
    except Exception:
        return {"aum": None, "expense": None, "beta": None, "yield": None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 只(调试用)")
    ap.add_argument("--reclassify", action="store_true", help="不抓数据,只用已有 json 重跑分类/判决")
    args = ap.parse_args()

    if args.reclassify:
        print("♻ 重分类模式(读已有 etf-analyses.json,不抓数据)…")
        old = json.loads(OUT.read_text(encoding="utf-8"))["etfs"]
        etfs = []
        for e in old:
            kind = classify(e["sym"], e["name"])
            v = verdict(kind, e["expense"])
            e = {**e, "kind": kind, "verdict": v["tag"], "cls": v["cls"], "why": v["why"]}
            e.pop("thesis", None) if False else None  # 保留 thesis
            etfs.append(e)
    else:
        print("① ETF screener(全量名单)…")
        rows = requests.get(SCREENER, headers=NH, timeout=40).json()["data"]["data"]["rows"]
        if args.limit:
            rows = rows[:args.limit]
        print(f"   {len(rows)} 只 ETF,逐只抓 summary(AUM/费率/beta)…")
        t = time.time()
        with ThreadPoolExecutor(max_workers=20) as ex:
            summaries = list(ex.map(fetch_summary, [r["symbol"] for r in rows]))
        print(f"   summary 抓取完成 {time.time()-t:.0f}s")
        etfs = []
        for r, s in zip(rows, summaries):
            kind = classify(r["symbol"], r["companyName"])
            v = verdict(kind, s["expense"])
            etfs.append({
                "sym": r["symbol"], "name": r["companyName"],
                "price": num(r.get("lastSalePrice")), "pct": num(r.get("percentageChange")),
                "ret1y": num(r.get("oneYearPercentage")),
                "aum": s["aum"], "expense": s["expense"], "beta": s["beta"], "yield": s["yield"],
                "kind": kind, "verdict": v["tag"], "cls": v["cls"], "why": v["why"],
            })
    # AUM 降序(None 沉底);AUM 单位是千美元
    etfs.sort(key=lambda x: -(x["aum"] or 0))
    for i, e in enumerate(etfs):
        e["rank"] = i

    from datetime import datetime, timezone, timedelta
    et = datetime.now(timezone(timedelta(hours=-4))).strftime("%Y-%m-%d")
    payload = {"updated": et, "n": len(etfs),
               "kinds": {k: sum(1 for e in etfs if e["kind"] == k) for k in ORDER + ["混合/其他"]},
               "etfs": etfs}
    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    have_aum = sum(1 for e in etfs if e["aum"])
    print(f"✅ etf-analyses.json — {len(etfs)} 只({have_aum} 有 AUM)")
    print("   类型分布:", payload["kinds"])
    print("   AUM Top 8(千美元):")
    for e in etfs[:8]:
        print(f"     {e['sym']:5s} AUM={e['aum'] or 0:>13,.0f}k 费率={e['expense']}% [{e['kind']}] {e['verdict']}  {e['name'][:34]}")


if __name__ == "__main__":
    main()
