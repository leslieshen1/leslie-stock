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


# ---------- 板块分类(细分 sector + 大类 super)----------
# 顺序即优先级,首个命中即定板块。每项: (板块中文, 板块英文, 大类, 关键词正则)
SECTORS = [
    # —— 工具(杠杆/反向):风险特征压倒一切,先判 ——
    ("反向做空", "Inverse", "工具", r"\b(inverse|bear|short|-1x|-2x|-3x)\b|ProShares Short|Direxion.*Bear"),
    ("杠杆做多", "Leveraged", "工具", r"\b(2x|3x|ultra|ultrapro|leveraged|geared|bull|daily)\b"),
    # —— 债券 ——
    ("美国国债", "Treasury", "债券", r"(treasur|t-bill|\btips\b|govern?ment bond|gov't|\bgovt\b)"),
    ("市政债", "Municipal", "债券", r"(municipal|\bmuni\b|tax-?exempt)"),
    ("高收益债", "High-yield", "债券", r"(high.?yield|junk|\bhy\b bond|senior loan|bank loan|fallen angel)"),
    ("公司/综合债", "Corporate/Agg", "债券", r"(corporate bond|investment grade|aggregate bond|\bagg\b|total bond|core bond|fixed income|\bbond\b|ultrashort|floating rate|duration)"),
    # —— 商品 ——
    ("黄金", "Gold", "商品", r"\bgold\b"),
    ("白银/贵金属", "Silver/PM", "商品", r"(silver|platinum|palladium|precious metal)"),
    ("原油/天然气", "Oil & Gas", "商品", r"(crude|\boil\b|natural gas|\bgas\b|energy commodity|petroleum)"),
    ("广义商品", "Broad commodity", "商品", r"(commodit|copper|agricultur|\bcorn\b|wheat|carbon)"),
    # —— 宽基(地域/规模优先;纯美股宽基放最后,让 S&P 500 Momentum/Value 归到因子)——
    ("小盘/中盘", "Small/Mid", "宽基", r"(small.?cap|mid.?cap|russell 2000|micro.?cap|s&p 600|s&p 400|extended market)"),
    ("新兴市场", "Emerging mkts", "宽基", r"(emerging market|\bem\b|frontier|brazil|\bindia\b|latin america|southeast asia|vietnam|indonesia|saudi|mexico|south africa)"),
    ("中国/中概", "China", "宽基", r"(\bchina\b|chinese|\bkweb\b|csi 300|ftse china|hong kong|hang seng|\ba-?shares?\b)"),
    ("国际/全球", "Intl/Global", "宽基", r"(developed markets?|\beafe\b|all-?world|total world|total international|ftse (developed|all-?world|global)|msci (world|acwi|eafe)|international equity|\bex-?us\b|europe|japan|\bgermany\b|\buk\b|asia)"),
    # —— 行业 ——
    ("半导体", "Semiconductors", "行业", r"(semiconductor|\bsemis?\b|microchip|chipmaker|\bsox\b|\bsoxx\b)"),
    ("科技", "Technology", "行业", r"(technology|\btech\b|information tech|\bxlk\b)"),
    ("软件/云", "Software/Cloud", "行业", r"(software|\bsaas\b|\bcloud\b|internet)"),
    ("金融/银行", "Financials", "行业", r"(financ|\bbank|insurance|broker|capital markets|\bxlf\b)"),
    ("生物科技", "Biotech", "行业", r"(biotech|genomic|\bxbi\b|\bibb\b|life scien)"),
    ("医疗健康", "Health care", "行业", r"(health ?care|\bpharma|medical|\bxlv\b|drug)"),
    ("房地产", "Real estate", "行业", r"(real estate|\breit|\bxlre\b|mortgage)"),
    ("工业/国防", "Industrials/Defense", "行业", r"(industrial|aerospace|defen[cs]e|\bxli\b)"),
    ("必需消费", "Cons. staples", "行业", r"(consumer staple|\bxlp\b)"),
    ("可选消费", "Cons. discretionary", "行业", r"(consumer discretionary|retail|\bxly\b)"),
    ("公用事业", "Utilities", "行业", r"(utilit|\bxlu\b)"),
    ("材料", "Materials", "行业", r"(materials?|mining|\bgdx\b|\bxlb\b|steel|copper miner)"),
    ("通信", "Communication", "行业", r"(communicat|telecom|media|\bxlc\b)"),
    # —— 主题 ——
    ("AI/机器人", "AI/Robotics", "主题", r"(\bai\b|artificial intelligence|robot|automation|machine learning)"),
    ("加密/区块链", "Crypto", "主题", r"(crypto|bitcoin|ether|\bbtc\b|blockchain|digital asset)"),
    ("清洁能源", "Clean energy", "主题", r"(clean energy|solar|renewable|wind|green energy|hydrogen)"),
    ("电动车/电池", "EV/Battery", "主题", r"(electric vehicle|\bev\b|battery|lithium|autonomous)"),
    ("核能/铀", "Nuclear/Uranium", "主题", r"(nuclear|uranium)"),
    ("太空", "Space", "主题", r"(\bspace\b|satellite|aerospace explor)"),
    ("网络安全", "Cybersecurity", "主题", r"(cyber|security)"),
    ("水/基建", "Water/Infra", "主题", r"(\bwater\b|infrastructure)"),
    ("其他主题", "Other theme", "主题", r"(cannabis|gaming|esports|metaverse|quantum|innovation|disrupt|next gen|future|thematic)"),
    # 传统能源放主题之后:让 Clean/Solar/Renewable Energy 先归清洁能源
    ("能源", "Energy", "行业", r"(\benergy\b|oil ?& ?gas|\bxle\b|\bmlp\b|midstream|pipeline)"),
    # —— 因子/策略 ——
    ("红利", "Dividend", "因子策略", r"(dividend|\byield\b|income)"),
    ("价值", "Value", "因子策略", r"\bvalue\b"),
    ("成长", "Growth", "因子策略", r"\bgrowth\b"),
    ("低波/质量", "LowVol/Quality", "因子策略", r"(low.?vol|min(imum)? vol|quality|defensive)"),
    ("动量", "Momentum", "因子策略", r"momentum"),
    ("等权", "Equal weight", "因子策略", r"equal.?weight"),
    ("备兑/缓冲", "Covered call/Buffer", "因子策略", r"(covered call|buffer|defined outcome|premium income|option income)"),
    ("ESG/多因子", "ESG/Multifactor", "因子策略", r"(\besg\b|multifactor|multi-?factor|sustainab)"),
    # —— 美股宽基(兜底,放最后)——
    ("美股宽基", "US broad", "宽基", r"(s&p ?500|total (stock |us )?market|total us|nasdaq-?100|dow jones industrial|russell 1000|\bmega-?cap|broad market|core s&p|us equity)"),
]

# 名字不含关键词的知名 ETF,直接定板块
SYMBOL_OVERRIDE = {
    **{s: "美股宽基" for s in "SPY IVV VOO VTI ITOT SCHB SCHX SPLG SPTM QQQ QQQM ONEQ DIA VV VTHR SCHK QQEW".split()},
    **{s: "小盘/中盘" for s in "IWM IJR IJH VB VO SCHA SCHM".split()},
    **{s: "国际/全球" for s in "VEA VXUS IXUS SCHF ACWI VT VEU SPDW EFA IEFA".split()},
    **{s: "新兴市场" for s in "VWO IEMG EEM SPEM SCHE".split()},
    **{s: "中国/中概" for s in "KWEB MCHI FXI ASHR CQQQ".split()},
    **{s: "半导体" for s in "SMH SOXX".split()},   # SOXL/SOXS 是 3x 杠杆,留给工具规则
    **{s: "价值" for s in "VTV VLUE MGV".split()},
    **{s: "成长" for s in "VUG MGK SCHG".split()},
    **{s: "红利" for s in "SCHD VYM VIG DGRO DVY HDV NOBL".split()},
}


def classify(sym: str, name: str) -> tuple[str, str]:
    """→ (板块, 大类)"""
    if sym in SYMBOL_OVERRIDE:
        sec = SYMBOL_OVERRIDE[sym]
        sup = next(s for z, e, s, k in SECTORS if z == sec)
        return sec, sup
    n = name.lower()
    for zh, en, sup, kw in SECTORS:
        if re.search(kw, n):
            return zh, sup
    return "混合/其他", "其他"


def verdict(kind: str, expense: float | None) -> dict:
    e = expense
    if kind == "工具":
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
    if kind == "因子策略":
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


def fetch_metrics(sym: str) -> dict:
    """Nasdaq 5年日线 → 1Y/3Y/5Y 累计回报 + 最大回撤 + 年化波动率。"""
    out = {"ret1y": None, "ret3y": None, "ret5y": None, "mdd": None, "vol": None, "years": None}
    try:
        u = (f"https://api.nasdaq.com/api/quote/{sym}/historical?assetclass=etf"
             f"&fromdate=2021-05-01&todate=2026-12-31&limit=9999")
        rows = (((requests.get(u, headers=NH, timeout=15).json().get("data") or {})
                 .get("tradesTable") or {}).get("rows")) or []
        closes = []
        for r in reversed(rows):                       # 端点是最新在前 → 反转成时间正序
            c = num(r.get("close"))
            if c:
                closes.append(c)
        if len(closes) < 30:
            return out
        last = closes[-1]
        out["years"] = round(len(closes) / 252, 1)
        for k, days in (("ret1y", 252), ("ret3y", 756), ("ret5y", 1260)):
            if len(closes) > days:
                out[k] = round((last / closes[-days - 1] - 1) * 100, 1)
        # 最大回撤(全区间)
        peak, mdd = closes[0], 0.0
        for c in closes:
            peak = max(peak, c)
            mdd = min(mdd, c / peak - 1)
        out["mdd"] = round(mdd * 100, 1)
        # 年化波动率(日收益标准差 × √252)
        rets = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes))]
        if rets:
            mean = sum(rets) / len(rets)
            var = sum((x - mean) ** 2 for x in rets) / len(rets)
            out["vol"] = round((var ** 0.5) * (252 ** 0.5) * 100, 1)
    except Exception:
        pass
    return out


SUPERS = ["宽基", "行业", "主题", "因子策略", "债券", "商品", "工具", "其他"]


def _classify_into(e: dict) -> dict:
    sec, sup = classify(e["sym"], e["name"])
    v = verdict(sup, e.get("expense"))
    return {**e, "sector": sec, "kind": sup, "verdict": v["tag"], "cls": v["cls"], "why": v["why"]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 只(调试用)")
    ap.add_argument("--reclassify", action="store_true", help="不抓数据,只重跑板块分类/判决")
    ap.add_argument("--metrics", action="store_true", help="读已有 json,补 5年业绩(1Y/3Y/5Y/最大回撤/波动)")
    args = ap.parse_args()

    if args.reclassify or args.metrics:
        etfs = json.loads(OUT.read_text(encoding="utf-8"))["etfs"]
        if args.reclassify:
            print("♻ 重分类(板块/判决)…")
            etfs = [_classify_into(e) for e in etfs]
        if args.metrics:
            print(f"📈 抓 5年业绩(1Y/3Y/5Y/最大回撤)· {len(etfs)} 只…")
            t = time.time()
            with ThreadPoolExecutor(max_workers=24) as ex:
                mets = list(ex.map(fetch_metrics, [e["sym"] for e in etfs]))
            etfs = [{**e, **m} for e, m in zip(etfs, mets)]
            got = sum(1 for m in mets if m["mdd"] is not None)
            print(f"   业绩抓取完成 {time.time()-t:.0f}s · {got} 只有历史")
    else:
        print("① ETF screener(全量名单)…")
        rows = requests.get(SCREENER, headers=NH, timeout=40).json()["data"]["data"]["rows"]
        if args.limit:
            rows = rows[:args.limit]
        print(f"   {len(rows)} 只 ETF,逐只抓 summary(AUM/费率/beta)…")
        t = time.time()
        with ThreadPoolExecutor(max_workers=20) as ex:
            summaries = list(ex.map(fetch_summary, [r["symbol"] for r in rows]))
            print(f"   summary {time.time()-t:.0f}s · 逐只抓 5年业绩…")
            t = time.time()
            mets = list(ex.map(fetch_metrics, [r["symbol"] for r in rows]))
        print(f"   业绩 {time.time()-t:.0f}s")
        etfs = []
        for r, s, m in zip(rows, summaries, mets):
            e = {"sym": r["symbol"], "name": r["companyName"],
                 "price": num(r.get("lastSalePrice")), "pct": num(r.get("percentageChange")),
                 "aum": s["aum"], "expense": s["expense"], "beta": s["beta"], "yield": s["yield"], **m}
            if not e.get("ret1y"):
                e["ret1y"] = num(r.get("oneYearPercentage"))
            etfs.append(_classify_into(e))

    # AUM 降序(None 沉底);AUM 单位是千美元
    etfs.sort(key=lambda x: -(x["aum"] or 0))
    for i, e in enumerate(etfs):
        e["rank"] = i

    from datetime import datetime, timezone, timedelta
    et = datetime.now(timezone(timedelta(hours=-4))).strftime("%Y-%m-%d")
    # 板块聚合:每板块的数量 + 总 AUM(供前端排板块顺序)
    sectors: dict[str, dict] = {}
    for e in etfs:
        s = sectors.setdefault(e["sector"], {"sector": e["sector"], "super": e["kind"], "n": 0, "aum": 0})
        s["n"] += 1
        s["aum"] += e["aum"] or 0
    payload = {"updated": et, "n": len(etfs),
               "supers": {k: sum(1 for e in etfs if e["kind"] == k) for k in SUPERS},
               "sectors": sorted(sectors.values(), key=lambda x: -x["aum"]),
               "etfs": etfs}
    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    have = sum(1 for e in etfs if e.get("mdd") is not None)
    print(f"✅ etf-analyses.json — {len(etfs)} 只 · {have} 只有业绩 · {len(sectors)} 个板块")
    print("   大类:", payload["supers"])
    print("   板块 Top 10(按总 AUM):")
    for s in payload["sectors"][:10]:
        print(f"     {s['sector']:12s} [{s['super']}] {s['n']:4d} 只")


if __name__ == "__main__":
    main()
