"""盘前报告 —— 每天 20:30(北京)= 美东 08:30 = 开盘前 1h。对外版(给别人看,无五方)。

数据用**真盘前**(Nasdaq,不限流):
- 大盘方向 = SPY/QQQ/DIA/IWM 的盘前涨跌(代替期货)
- 盘前异动 = 一批流动性大票 + 昨日 top movers 的真盘前价(看反弹/延续)
- 今日财报 = Finnhub 日历 · 隔夜新闻 = Finnhub
→ claude -p 用 Leslie 口吻写「今日盘前看点」→ alerts.email_sender 发邮件 + 存档。

用法: uv run python scripts/premarket_report.py [--no-email]
"""
from __future__ import annotations
import json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
try:
    from dotenv import load_dotenv; load_dotenv()
except Exception:
    pass

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
OUT = ROOT / "data" / "reports"
FINN = os.environ.get("FINNHUB_KEY") or os.environ.get("FINNHUB_TOKEN") or ""
NH = {"user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "accept": "application/json", "origin": "https://www.nasdaq.com", "referer": "https://www.nasdaq.com/"}
# 固定流动性大票池(盘前异动从这里 + 昨日 movers 里找)
LIQUID = ("AAPL MSFT NVDA GOOGL AMZN META AVGO TSLA NFLX ORCL AMD MU TSM ARM SMCI AVGO QCOM "
          "JPM V MA COST WMT XOM UNH LLY HD BAC INTC PLTR COIN MSTR").split()

# 固定热门追踪:每期盘报必列一个 watchlist 段(不管有无异动都覆盖)。可随时增删。
HOT_WATCH = "SPCX MU NVDA AVGO AMD ARM SMCI PLTR TSLA COHR".split()


def npm(sym, asset="stocks"):
    """Nasdaq 报价。盘前时段:primaryData=盘前价(涨跌=相对上一交易日收盘),
    secondaryData=上一交易日(昨日)收盘价 + 昨日当天涨跌。返回 dict 或 None。"""
    try:
        d = requests.get(f"https://api.nasdaq.com/api/quote/{sym}/info?assetclass={asset}", headers=NH, timeout=10).json().get("data", {})
        p = d.get("primaryData", {}) or {}
        s = d.get("secondaryData", {}) or {}
        return {"status": d.get("marketStatus"), "pm_price": p.get("lastSalePrice"), "pm_pct": p.get("percentageChange"),
                "prev_close": s.get("lastSalePrice"), "prev_pct": s.get("percentageChange")}
    except Exception:
        return None


def _pctnum(x):
    try:
        return float(str(x or "0").replace("%", "").replace("+", "").replace(",", ""))
    except ValueError:
        return 0.0


def gather():
    et = datetime.now(timezone(timedelta(hours=-4)))
    ctx = {"asof_et": et.strftime("%Y-%m-%d %H:%M ET %a")}

    # 1) 大盘方向:ETF。pm_pct=盘前(vs 昨日收盘),yesterday_pct=昨日当天涨跌
    ctx["direction"] = {}
    for s, n in [("SPY", "标普500"), ("QQQ", "纳指100"), ("DIA", "道指"), ("IWM", "罗素2000")]:
        q = npm(s, "etf")
        if q:
            ctx["direction"][n] = {"pm_pct": q["pm_pct"], "yesterday_pct": q["prev_pct"]}
            ctx["market_status"] = q["status"]
        time.sleep(0.15)

    # 2) 盘前异动:候选池=固定大票 + us-stocks 高波动名(仅作"值得盯的流动性票"清单)。
    #    真实数字全来自 Nasdaq:yesterday_pct=昨日(上一交易日)真实收盘涨跌,pm_pct=盘前 vs 昨日收盘。
    uni = list(dict.fromkeys(LIQUID + HOT_WATCH))
    names = {}
    try:
        us = json.loads((PUB / "us-stocks.json").read_text(encoding="utf-8")).get("stocks", [])
        names = {s["sym"]: s.get("name") for s in us}
        for s in sorted([x for x in us if x.get("pct") is not None and (x.get("mcapB") or 0) >= 4],
                        key=lambda x: abs(x["pct"]), reverse=True)[:50]:
            if s["sym"] not in uni:
                uni.append(s["sym"])
    except Exception:
        pass
    rows = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for sym, q in zip(uni, ex.map(lambda x: npm(x), uni)):
            if q and q.get("pm_pct") is not None:
                rows.append({"sym": sym, "name": names.get(sym), "pm_price": q["pm_price"],
                             "pm_pct": q["pm_pct"], "yesterday_pct": q["prev_pct"], "yesterday_close": q["prev_close"]})
    rows.sort(key=lambda r: _pctnum(r["pm_pct"]), reverse=True)
    ctx["premarket_gainers"] = rows[:8]
    ctx["premarket_losers"] = rows[-8:][::-1]
    wl = {r["sym"]: r for r in rows}
    ctx["watchlist"] = [wl[s] for s in HOT_WATCH if s in wl]  # 固定热门票,每期必列
    ynames = {k: (v, None) for k, v in names.items()}  # 财报取名用

    # 3) 今日/明日财报 + 隔夜市场新闻(Finnhub)
    ctx["earnings"] = []
    ctx["news"] = []   # 必须先初始化:FINN 为空时下面整块跳过,否则 ctx 缺 news 字段
    if FINN:
        try:
            j = requests.get("https://finnhub.io/api/v1/calendar/earnings",
                             params={"from": str(et.date()), "to": str(et.date() + timedelta(days=1)), "token": FINN}, timeout=15).json()
            for e in (j.get("earningsCalendar") or []):
                nm = ynames.get(e.get("symbol"), (None, None))[0]
                ctx["earnings"].append({"sym": e.get("symbol"), "name": nm, "hour": e.get("hour"), "epsEst": e.get("epsEstimate"), "date": e.get("date")})
        except Exception:
            pass
        try:
            n = requests.get("https://finnhub.io/api/v1/news", params={"category": "general", "token": FINN}, timeout=15).json()
            ctx["news"] = [{"h": x.get("headline"), "src": x.get("source"), "sum": (x.get("summary") or "")[:160]} for x in (n or [])[:18]]
        except Exception:
            pass
    # 兜底:CI 没配 FINNHUB_KEY(或抓取失败)→ 读仓库里随刷新提交的文件,免得报告"字段为空"。
    if not ctx["earnings"]:
        try:
            ec = json.loads((PUB / "earnings-calendar.json").read_text(encoding="utf-8")).get("stocks", {})
            want = {str(et.date()), str(et.date() + timedelta(days=1))}
            for sym, rows in ec.items():
                for r in (rows or []):
                    if r.get("date") in want:
                        ctx["earnings"].append({"sym": sym, "name": ynames.get(sym, (None, None))[0], "hour": r.get("hour"),
                                                "epsEst": r.get("epsEst"), "date": r.get("date")})
        except Exception:
            pass
    if not ctx["news"]:
        try:
            mn = json.loads((PUB / "market-news.json").read_text(encoding="utf-8")).get("items", [])
            ctx["news"] = [{"h": x.get("title"), "src": x.get("source"), "sum": (x.get("summary") or "")[:160]} for x in mn[:18]]
        except Exception:
            pass
    # 联网核实:Google News 实时新闻(大盘 + 重点个股),前置到 ctx['news']
    movers = HOT_WATCH + [r.get("sym") for r in (ctx.get("premarket_gainers", []) + ctx.get("premarket_losers", [])) if r.get("sym")]
    enrich_news(ctx, list(dict.fromkeys(movers)))
    return ctx


PROMPT = """你是「我不是股神 · Not a Stock Guru」的盘前分析师。现在是美东开盘前约 1 小时(盘前时段)。
下面这条 user 消息给你一份 JSON 数据。字段含义务必看清:
- direction=四大指数 ETF:pm_pct=盘前涨跌(相对**上一交易日收盘**),yesterday_pct=上一交易日(昨天)当天涨跌。
- premarket_gainers/losers=按盘前涨跌排序的异动票:pm_pct=盘前(相对昨日收盘),yesterday_pct=**昨天(上一交易日)当天的真实收盘涨跌**,yesterday_close=昨日收盘价。
- watchlist=固定热门追踪票(SPCX/MU 等市场重点关注的票),每期必须逐一覆盖;字段同 gainers。
- earnings=今明财报、news=隔夜新闻。
写一份**今日盘前看点**给外部读者看。

风格(Leslie 的口吻,务必遵守):
- 中文,锐利、有框架、说人话、反共识、不绕弯;像交易多年、看透美股是「正和合约游戏」的人在划重点。
- **时间轴铁律:今天是盘前,基准是"上一交易日收盘"。yesterday_pct 是上一交易日那天的涨跌,pm_pct 是盘前相对上一交易日收盘。先判断"上一交易日是涨是跌",再判断"盘前是延续还是反转/降速"。绝不要把更早之前的行情当成上一交易日。⚠ 正文措辞一律用「上一交易日」,绝不要写「昨天」——本报告常在周一或假日次日跑,那时"昨天"是休市日、不是上一交易日,写"昨天"就错了。**
- **不是投资建议**——是「该看什么」的框架与信号。不喊单、不给目标价、不保证。
- 结合新闻找因果,不流水账。
- **新闻只用所给 news**:news = Google News + Finnhub **实时抓取的真新闻**(含按重点个股查的)。引用消息、讲因果都基于它;**绝不用训练记忆编造具体数字、金额、评级、并购、协议、事件**。所给 news/数据佐证不了的具体细节,写成"市场关注/有传闻"或干脆不写,别当事实写死。数据(指数/盘前涨跌/价格)一律以 JSON 为准。
- **有深度,不是摘要**:每条主线讲透"机构在怎么想、资金往哪走、谁站在对面",给出可跟踪的关键价位或触发条件;至少点出一个市场可能还没在定价的风险或反共识点。宁可少讲两只票,也要把主线讲到位。
- **排版加粗(必须做)**:正文是 markdown,把每条主线的**核心判断**、点名的**关键个股+关键价位**用 `**加粗**` 标出(只加粗关键词,别整段加粗),让读者一眼抓到重点。

结构(markdown,1400-2000 字。**不要输出大标题/日期**——外层已加,直接从下面第 1 节开始,每节用 ## 二级标题):
1. **一句话定调** —— 盘前大盘方向(ETF 盘前涨跌)给的体温:今天开盘大概率往哪边、谁在领。
2. **盘前在发生什么** —— 挑出**主线**。每条主线讲两步:①上一交易日(yesterday_pct)这批票是涨是跌 ②盘前(pm_pct)是顺上一交易日延续、还是掉头反转/降速。例:上一交易日大涨+盘前续涨=动能延续(注意是否降速);上一交易日大涨+盘前转跌=获利了结;上一交易日大跌+盘前反弹=超卖反抽。再接上因果。
3. **热门追踪** —— watchlist 这些市场重点盯的票今天什么状态:每只一句,结合盘前(pm_pct)和上一交易日(yesterday_pct)说动能/位置(延续/反转/降速/超卖);没盘前数据的就用上一交易日收盘。不喊单、不给目标价。
4. **隔夜消息面** —— 3-4 条新闻驱动的因果(地缘/宏观/油价等)。
5. **今日财报** —— 今天谁出(盘前/盘后)、明天的重头戏,市场在赌什么。earnings 里有 name 就用 name,**没有 name 的就只写代码、绝不要猜公司名/业务**。
6. **一句风险提示** —— 今天最该当心的那一个。

只输出第 1-6 节的 markdown 正文,不要外层大标题、不要前后多余的话,不要提'五方'或任何内部产品功能。"""


def _claude(system: str, user: str, max_tokens: int = 5000) -> str:
    """报告综述。优先 Claude Opus 4.8(NDT /v1/messages),它过载(MODEL_BUSY)或失败时自动降级
    gpt-5.5(/v1/responses)—— 统一在 ndt_llm.llm 里:退避重试 + 双模型兜底,一次过载不废整篇。"""
    from ndt_llm import llm
    return llm(user, system, max_tokens)


def llm_write(system_prompt: str, ctx: dict) -> str:
    """Claude Opus 4.8 综述。"""
    try:
        return _claude(system_prompt, json.dumps(ctx, ensure_ascii=False), 5000)
    except Exception as e:
        print("❌ NDT 请求失败:", e); sys.exit(1)


def card_headline(report_md: str) -> str | None:
    """从写好的中文报告提炼一句英文卡片标题(与报告口径一致),给 share_card.py --spec 用。
    失败 → None,卡片回退到自己的机械标题。"""
    sys_p = ("You read a Chinese US-market report and output ONE English headline for a social card: "
             "<=10 words, punchy, accurate, no emoji, no quotes, no markdown. It MUST match the report's "
             "overall market direction and main theme. Output only the headline, nothing else.")
    try:
        hl = _claude(sys_p, report_md[:6000], 60).strip().strip('"').strip()
        return hl if 0 < len(hl) <= 90 else None
    except Exception:
        return None


# ============================================================
# 联网核实:Google News RSS(免 key、实时真新闻)+ 报告主角 ticker 提取
# ============================================================
def google_news(query: str, n: int = 6) -> list[dict]:
    """Google News RSS 拉实时真新闻。返回 [{h, src, sum}]。免 key,标题形如 'Headline - Source'。"""
    import xml.etree.ElementTree as ET
    from urllib.parse import quote
    try:
        url = f"https://news.google.com/rss/search?q={quote(query)}&hl=en-US&gl=US&ceid=US:en"
        r = requests.get(url, headers={"user-agent": "Mozilla/5.0"}, timeout=12)
        items = list(ET.fromstring(r.content).iter("item"))[:n]
        out = []
        for it in items:
            title = (it.findtext("title") or "").strip()
            src = (it.findtext("source") or "").strip()
            if not src and " - " in title:
                title, src = title.rsplit(" - ", 1)
            elif src and title.endswith(" - " + src):
                title = title[: -(len(src) + 3)]
            if title:
                out.append({"h": title, "src": src, "sum": ""})
        return out
    except Exception:
        return []


def enrich_news(ctx: dict, tickers: list[str]) -> None:
    """联网核实:Google News RSS 抓实时真新闻(大盘 + 按重点个股),前置到 ctx['news']
    (Finnhub 留作补充)。让报告的消息面/因果有真来源,而非模型记忆。"""
    fresh = google_news("US stock market today", 8)
    seen = {x["h"] for x in fresh}
    for sym in [t for t in tickers if t][:6]:
        for it in google_news(f"{sym} stock", 2):
            if it["h"] not in seen:
                it["h"] = f"[{sym}] {it['h']}"
                fresh.append(it)
                seen.add(it["h"])
    if fresh:
        ctx["news"] = (fresh + (ctx.get("news") or []))[:30]
        print(f"   📡 Google News 联网核实: {len(fresh)} 条实时新闻(大盘 + 个股)")


def report_tickers(md: str) -> list[str]:
    """从写好的报告抽它讲到的主角 ticker(给卡片「热门标的」用,图文同源)。
    优先「热门追踪」段的 **TICKER** / $TICKER,不够再全文补,去重保序、剔除常见非代码大写词。"""
    import re
    STOP = {"AI", "US", "ET", "CPI", "PPI", "PCE", "GDP", "FOMC", "CEO", "CFO", "IPO", "ETF",
            "EPS", "YOY", "QOQ", "GPU", "CPU", "EV", "UI", "IP", "ID", "OK", "TV", "PC", "USD"}
    pat = re.compile(r"\*\*([A-Z]{2,5})\*\*|\$([A-Z]{2,5})\b")
    sec = re.search(r"热门追踪(.*?)(?=\n##|\Z)", md, re.S)
    order: list[str] = []
    for src in ([sec.group(1)] if sec else []) + [md]:
        for a, b in pat.findall(src):
            t = a or b
            if t and t not in STOP and t not in order:
                order.append(t)
        # 「热门追踪」段就是报告精选的热门票;够 5 个就不再全文扫(避免把明日财报/顺带提到的票也算进热门标的)
        if sec and len(order) >= 5:
            break
    return order[:12]


def write_card_spec(spec_path, report_md: str) -> None:
    """派生卡片 spec:英文标题 + 报告主角 tickers → share_card.py --spec(图文同一个故事)。"""
    spec = {"tickers": report_tickers(report_md)}
    hl = card_headline(report_md)
    if hl:
        spec["headline"] = hl
    spec_path.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    print(f"   🃏 卡片 spec(随报告): 标题={hl or '—'} · 主角={' '.join(spec['tickers']) or '—'}")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print("📰 抓真盘前数据(Nasdaq)...")
    ctx = gather()
    ctxfile = OUT / "_ctx.json"
    ctxfile.write_text(json.dumps(ctx, ensure_ascii=False, indent=1), encoding="utf-8")
    d = ctx.get("direction", {})
    print(f"   盘口 {ctx.get('market_status')} · 方向 " + " ".join(f"{k}{v['pm_pct']}" for k, v in d.items() if v.get("pm_pct"))
          + f" · 异动 {len(ctx.get('premarket_gainers', []))+len(ctx.get('premarket_losers', []))} · 财报 {len(ctx.get('earnings', []))} · 新闻 {len(ctx.get('news', []))}")

    print("🧠 Claude Opus 4.8 综述(NDT /v1/messages)...")
    report = llm_write(PROMPT, ctx)
    if not report:
        print("❌ 模型无输出"); sys.exit(1)
    # 砍掉模型可能加的 meta 前言/大标题:正文从第一个 ## 二级标题开始(Claude Opus 4.8 偶尔会先写
    # "我先按…来写:" 这种旁白,甚至和 ## 标题挤在一行,故按 "## " 出现位置切,而非逐行)。
    cut = report.find("## ")
    if cut > 0:
        report = report[cut:]
    lines = report.splitlines()
    while lines and (lines[0].startswith("# ") and not lines[0].startswith("## ") or not lines[0].strip()):
        lines.pop(0)
    report = "\n".join(lines).strip()

    et = datetime.now(timezone(timedelta(hours=-4)))
    title = f"盘前看点 · {et.strftime('%m-%d')}(开盘前 1h)"
    md = f"# {title}\n\n_盘前实时数据 · {et.strftime('%Y-%m-%d %H:%M ET')} · 我不是股神 · 非投资建议_\n\n{report}\n"
    path = OUT / f"premarket_{et.strftime('%Y%m%d')}.md"
    path.write_text(md, encoding="utf-8")
    print(f"✓ 报告 → {path}  ({len(report)} 字)")

    # 派生卡片 spec:英文标题 + 报告主角 tickers → share_card.py --spec,保证图文同一个故事
    write_card_spec(OUT / "premarket_spec.json", report)

    if "--no-email" not in sys.argv:
        try:
            sys.path.insert(0, str(ROOT))
            from alerts.email_sender import send_briefing
            send_briefing(subject=f"📈 {title}", markdown_body=md)
            print("✉️ 已发邮件")
        except Exception as e:
            print(f"⚠ 邮件未发(.env 配 EMAIL_PASSWORD 即可):{str(e)[:120]}")


if __name__ == "__main__":
    main()
