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
- **时间轴铁律:今天是盘前,基准是"昨天(上一交易日)收盘"。yesterday_pct 是昨天那一天的涨跌,pm_pct 是盘前相对昨天收盘。先判断"昨天是涨是跌",再判断"盘前是延续还是反转/降速"。绝不要把更早之前的行情当成昨天,也不要假设昨天之前发生了什么(除非新闻里写了)。**
- **不是投资建议**——是「该看什么」的框架与信号。不喊单、不给目标价、不保证。
- 结合新闻找因果,不流水账。
- **有深度,不是摘要**:每条主线讲透"机构在怎么想、资金往哪走、谁站在对面",给出可跟踪的关键价位或触发条件;至少点出一个市场可能还没在定价的风险或反共识点。宁可少讲两只票,也要把主线讲到位。

结构(markdown,1400-2000 字。**不要输出大标题/日期**——外层已加,直接从下面第 1 节开始,每节用 ## 二级标题):
1. **一句话定调** —— 盘前大盘方向(ETF 盘前涨跌)给的体温:今天开盘大概率往哪边、谁在领。
2. **盘前在发生什么** —— 挑出**主线**。每条主线讲两步:①昨天(yesterday_pct)这批票是涨是跌 ②盘前(pm_pct)是顺昨天延续、还是掉头反转/降速。例:昨天大涨+盘前续涨=动能延续(注意是否降速);昨天大涨+盘前转跌=获利了结;昨天大跌+盘前反弹=超卖反抽。再接上因果。
3. **热门追踪** —— watchlist 这些市场重点盯的票今天什么状态:每只一句,结合盘前(pm_pct)和昨日(yesterday_pct)说动能/位置(延续/反转/降速/超卖);没盘前数据的就用昨日收盘。不喊单、不给目标价。
4. **隔夜消息面** —— 3-4 条新闻驱动的因果(地缘/宏观/油价等)。
5. **今日财报** —— 今天谁出(盘前/盘后)、明天的重头戏,市场在赌什么。earnings 里有 name 就用 name,**没有 name 的就只写代码、绝不要猜公司名/业务**。
6. **一句风险提示** —— 今天最该当心的那一个。

只输出第 1-6 节的 markdown 正文,不要外层大标题、不要前后多余的话,不要提'五方'或任何内部产品功能。"""


def _claude(system: str, user: str, max_tokens: int = 5000, retries: int = 3) -> str:
    """NDT 的 Anthropic 端点(/v1/messages)调 Claude Opus 4.8。
    报告专用 key:NDT_CLAUDE_KEY(NDT 的 gpt key 不带 Claude,故跟其它脚本的 NDT_API_KEY 分开)。
    model 可用 NDT_REPORT_MODEL 覆盖(默认 claude-opus-4-8)。线上/本地同一条 API。
    NDT 偶发 MODEL_BUSY/overloaded(retryable)→ 退避重试,别让一次抖动废掉整篇报告。"""
    key = os.environ.get("NDT_CLAUDE_KEY") or os.environ.get("NDT_API_KEY")
    base = (os.environ.get("NDT_BASE_URL") or "https://api.nadoutong.org").rstrip("/")
    model = os.environ.get("NDT_REPORT_MODEL", "claude-opus-4-8")
    if not key:
        raise RuntimeError("缺 NDT_CLAUDE_KEY(.env / GitHub secrets)")
    for attempt in range(retries + 1):
        try:
            r = requests.post(f"{base}/v1/messages",
                              headers={"Authorization": f"Bearer {key}",
                                       "Content-Type": "application/json",
                                       "anthropic-version": "2023-06-01"},
                              json={"model": model, "max_tokens": max_tokens,
                                    "system": system,
                                    "messages": [{"role": "user", "content": user}]},
                              timeout=180).json()
            if r.get("error"):
                raise RuntimeError(str(r["error"])[:200])
            parts = r.get("content") or []
            text = "".join(p.get("text", "") for p in parts if p.get("type") == "text").strip()
            if text:
                return text
            raise RuntimeError("空回复")
        except Exception as e:
            if attempt >= retries:
                raise
            print(f"   ↻ NDT 调用失败({str(e)[:90]}),{10 * (attempt + 1)}s 后重试…")
            time.sleep(10 * (attempt + 1))
    raise RuntimeError("NDT 重试耗尽")


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

    # 派生卡片 spec:英文标题随报告 → share_card.py --spec,保证图文同一个故事
    hl = card_headline(report)
    if hl:
        (OUT / "premarket_spec.json").write_text(json.dumps({"headline": hl}, ensure_ascii=False), encoding="utf-8")
        print(f"   🃏 卡片标题(随报告): {hl}")

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
