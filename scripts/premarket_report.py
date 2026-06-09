"""盘前报告 —— 每天 20:30(北京)= 美东 08:30 = 开盘前 1h。

流程:python 抓"硬数据"(隔夜期货/宏观/今日财报/隔夜新闻/异动+五方)→ 攒成 context →
      claude -p 用 Leslie 的口吻综述成「今日盘前看点」→ alerts.email_sender 发邮件(+存档)。

数据全免费:Yahoo(期货/宏观)· Finnhub(财报日历+市场新闻,需 key)· 产品自有(us-stocks/us-analyses)。
用法: uv run python scripts/premarket_report.py [--no-email]
"""
from __future__ import annotations
import json, os, subprocess, sys, time
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
UA = {"user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124 Safari/537.36"}
FINN = os.environ.get("FINNHUB_KEY") or os.environ.get("FINNHUB_TOKEN") or ""

FUT = [("ES=F", "标普期货"), ("NQ=F", "纳指期货"), ("YM=F", "道指期货"), ("RTY=F", "罗素期货"),
       ("^VIX", "VIX"), ("CL=F", "原油"), ("GC=F", "黄金"), ("DX-Y.NYB", "美元"),
       ("^TNX", "美债10Y"), ("BTC-USD", "BTC")]


def yq(sym):
    u = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym.replace('^', '%5E')}?interval=5m&range=1d"
    for attempt in range(3):
        try:
            r = requests.get(u, headers=UA, timeout=15)
            if r.status_code == 429:
                time.sleep(1.5 * (attempt + 1)); continue
            m = (r.json().get("chart", {}).get("result") or [{}])[0].get("meta", {})
            p = m.get("regularMarketPrice"); pc = m.get("chartPreviousClose") or m.get("previousClose")
            if p is None:
                return None
            return {"price": round(p, 2), "pct": round((p - pc) / pc * 100, 2) if pc else None}
        except Exception:
            time.sleep(1.0 * (attempt + 1))
    return None


def gather():
    ctx = {"asof_et": datetime.now(timezone(timedelta(hours=-4))).strftime("%Y-%m-%d %H:%M ET")}
    # 1) 隔夜期货 + 宏观(节流防瞬时限流)
    ctx["futures"] = {}
    for s, name in FUT:
        ctx["futures"][name] = yq(s)
        time.sleep(0.4)
    # 兜底:macro.json 收盘指数(期货被限流时也有市场坐标)
    try:
        ctx["last_close"] = {x["name"]: {"price": x.get("price"), "pct": x.get("pct")}
                             for x in json.loads((PUB / "macro.json").read_text(encoding="utf-8")).get("series", [])}
    except Exception:
        ctx["last_close"] = {}
    # 2) 今日财报(Finnhub,今天 + 明天)
    ctx["earnings"] = []
    if FINN:
        try:
            today = datetime.now(timezone(timedelta(hours=-4))).date()
            j = requests.get("https://finnhub.io/api/v1/calendar/earnings",
                             params={"from": str(today), "to": str(today + timedelta(days=1)), "token": FINN}, timeout=15).json()
            for e in (j.get("earningsCalendar") or [])[:40]:
                ctx["earnings"].append({"sym": e.get("symbol"), "hour": e.get("hour"), "epsEst": e.get("epsEstimate"), "date": e.get("date")})
        except Exception:
            pass
        # 3) 隔夜市场新闻
        try:
            n = requests.get("https://finnhub.io/api/v1/news", params={"category": "general", "token": FINN}, timeout=15).json()
            ctx["news"] = [{"h": x.get("headline"), "src": x.get("source"), "sum": (x.get("summary") or "")[:160]} for x in (n or [])[:18]]
        except Exception:
            ctx["news"] = []
    # 4) 异动 + 五方(用最近 us-stocks 涨跌 + us-analyses 五方)
    try:
        us = json.loads((PUB / "us-stocks.json").read_text(encoding="utf-8")).get("stocks", [])
        an = json.loads((PUB / "us-analyses.json").read_text(encoding="utf-8")).get("stocks", {})
        order = json.loads((PUB / "us-panel-summary.json").read_text(encoding="utf-8")).get("order", [])
        big = [s for s in us if s.get("pct") is not None and (s.get("mcapB") or 0) >= 5]
        movers = sorted(big, key=lambda x: x["pct"], reverse=True)[:6] + sorted(big, key=lambda x: x["pct"])[:6]
        ctx["movers"] = []
        for s in movers:
            row = {"sym": s["sym"], "name": s.get("name"), "pct": s["pct"], "mcapB": s.get("mcapB")}
            p = an.get(s["sym"], {}).get("panel")
            if p:
                row["五方"] = {m: f"{p[m]['verdict']}({p[m]['score']})" for m in order if m in p}
                row["divergence"] = an[s["sym"]].get("divergence", "")[:120]
            ctx["movers"].append(row)
        ctx["covered"] = len(an)
    except Exception as e:
        ctx["movers"] = []; ctx["_err"] = str(e)[:80]
    return ctx


PROMPT = """你是「我不是股神 · Not a Stock Guru」的盘前分析师。现在是美东 08:30、美股开盘前 1 小时。
读取文件 {ctxfile}(JSON,含隔夜期货/宏观、今日财报日历、隔夜新闻、异动票+五方判读),写一份**今日盘前看点**报告。

风格(Leslie 的口吻,务必遵守):
- 中文,锐利、有框架、说人话、反共识、不绕弯;像一个交易了很多年、看透美股是「正和合约游戏」的人在给朋友划重点。
- **不是投资建议**——是「该看什么」的框架与信号梳理。不喊单、不给目标价、不保证。品牌是「我不是股神」。
- 结合新闻找**因果**(谁因为什么动),而不是罗列。点出**今天真正的看点和风险**。

结构(markdown,简洁,总长 600-900 字):
1. **一句话定调** —— 今天开盘前市场的体温(期货/VIX/利率给的信号)。
2. **隔夜发生了什么** —— 3-5 条,新闻驱动的因果,不流水账。
3. **今日看点** —— 财报(谁盘前/盘后出、市场在赌什么)、异动票(为什么动)、主题线索。
4. **五方视角** —— 挑 1-2 只异动/热门票,用我们的五方判读说「大师们在这只票上吵什么」(分歧即信号)。
5. **一句风险提示** —— 今天最该当心的那一个。

只输出报告 markdown 正文,不要前后多余的话。"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print("📰 抓盘前数据...")
    ctx = gather()
    ctxfile = OUT / "_ctx.json"
    ctxfile.write_text(json.dumps(ctx, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"   期货 {sum(1 for v in ctx['futures'].values() if v)}/10 · 财报 {len(ctx.get('earnings',[]))} · 新闻 {len(ctx.get('news',[]))} · 异动 {len(ctx.get('movers',[]))}")

    print("🧠 Claude 综述(claude -p)...")
    r = subprocess.run(["claude", "-p", PROMPT.format(ctxfile=str(ctxfile))],
                       capture_output=True, text=True, cwd=str(ROOT), timeout=600)
    report = (r.stdout or "").strip()
    if not report:
        print("❌ Claude 无输出:", (r.stderr or "")[:200]); sys.exit(1)

    et = datetime.now(timezone(timedelta(hours=-4)))
    title = f"盘前看点 · {et.strftime('%m-%d')}(开盘前 1h)"
    md = f"# {title}\n\n_生成于 {et.strftime('%Y-%m-%d %H:%M ET')} · 我不是股神 · 非投资建议_\n\n{report}\n"
    path = OUT / f"premarket_{et.strftime('%Y%m%d')}.md"
    path.write_text(md, encoding="utf-8")
    print(f"✓ 报告 → {path}  ({len(report)} 字)")

    if "--no-email" not in sys.argv:
        try:
            sys.path.insert(0, str(ROOT))
            from alerts.email_sender import send_briefing
            send_briefing(subject=f"📈 {title}", markdown_body=md)
            print("✉️ 已发邮件")
        except Exception as e:
            print(f"⚠ 邮件未发(在 .env 配 EMAIL_FROM/EMAIL_PASSWORD/EMAIL_TO 即可):{str(e)[:120]}")


if __name__ == "__main__":
    main()
