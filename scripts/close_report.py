"""收盘复盘 —— 每天北京 10:00am(美股隔夜已收盘,ET 约前一日 22:00)。
复盘当日美股:谁领涨/领跌、主线、盘后财报、消息面。
数据:Nasdaq(收盘价 + 当日涨跌,closed 时段 primaryData 即当日收盘)+ Finnhub(财报/新闻)。
gpt-5.5 综述,线上(GitHub Actions)/本地同一条 API。
用法: uv run python scripts/close_report.py [--no-email]
"""
from __future__ import annotations
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta

import requests

try:
    from dotenv import load_dotenv; load_dotenv()
except Exception:
    pass

# 复用盘前报告的工具:Nasdaq 报价 / gpt-5.5 综述 / 大票池 / 路径 / Finnhub key
from premarket_report import npm, llm_write, _pctnum, LIQUID, PUB, OUT, FINN


def gather():
    et = datetime.now(timezone(timedelta(hours=-4)))
    ctx = {"asof_et": et.strftime("%Y-%m-%d %H:%M ET %a")}

    # 1) 四大指数当日收盘(closed 时段 primaryData.percentageChange = 当日收盘涨跌)
    ctx["indices"] = {}
    for s, n in [("SPY", "标普500"), ("QQQ", "纳指100"), ("DIA", "道指"), ("IWM", "罗素2000")]:
        q = npm(s, "etf")
        if q and q.get("pm_pct") is not None:
            ctx["indices"][n] = {"close_pct": q["pm_pct"], "close_price": q["pm_price"]}
            ctx["market_status"] = q.get("status")
        time.sleep(0.15)

    # 2) 当日异动:候选池=固定大票 + us-stocks 高波动名;真实数字来自 Nasdaq(当日收盘涨跌)
    uni = list(dict.fromkeys(LIQUID))
    names = {}
    try:
        us = json.loads((PUB / "us-stocks.json").read_text(encoding="utf-8")).get("stocks", [])
        names = {s["sym"]: s.get("name") for s in us}
        for s in sorted([x for x in us if x.get("pct") is not None and (x.get("mcapB") or 0) >= 4],
                        key=lambda x: abs(x["pct"]), reverse=True)[:60]:
            if s["sym"] not in uni:
                uni.append(s["sym"])
    except Exception:
        pass
    rows = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for sym, q in zip(uni, ex.map(lambda x: npm(x), uni)):
            if q and q.get("pm_pct") is not None:
                rows.append({"sym": sym, "name": names.get(sym),
                             "close_price": q["pm_price"], "close_pct": q["pm_pct"]})
    rows.sort(key=lambda r: _pctnum(r["close_pct"]), reverse=True)
    ctx["gainers"] = rows[:8]
    ctx["losers"] = rows[-8:][::-1]

    # 3) 盘后/明日财报 + 消息面(Finnhub)
    ctx["earnings"] = []
    ctx["news"] = []
    if FINN:
        try:
            j = requests.get("https://finnhub.io/api/v1/calendar/earnings",
                             params={"from": str(et.date()), "to": str(et.date() + timedelta(days=1)), "token": FINN},
                             timeout=15).json()
            for e in (j.get("earningsCalendar") or []):
                ctx["earnings"].append({"sym": e.get("symbol"), "name": names.get(e.get("symbol")),
                                        "hour": e.get("hour"), "epsEst": e.get("epsEstimate"), "date": e.get("date")})
        except Exception:
            pass
        try:
            n = requests.get("https://finnhub.io/api/v1/news", params={"category": "general", "token": FINN}, timeout=15).json()
            ctx["news"] = [{"h": x.get("headline"), "src": x.get("source"), "sum": (x.get("summary") or "")[:160]} for x in (n or [])[:18]]
        except Exception:
            pass
    return ctx


PROMPT = """你是「我不是股神 · Not a Stock Guru」的收盘分析师。美股刚收盘,你写**今日收盘复盘**给外部读者。
下面这条 user 消息给你一份 JSON 数据。字段含义:
- indices=四大指数 ETF 的**当日收盘涨跌**(close_pct)。
- gainers/losers=当日**收盘涨跌**排序的异动票(close_pct=当日涨跌,close_price=收盘价)。
- earnings=今天盘后/明天的财报、news=消息面。

风格(Leslie 口吻,务必遵守):
- 中文,锐利、有框架、说人话、反共识、不绕弯;像看透美股是「正和合约游戏」的人在复盘。
- **基准是"今天这根 K 线"**:今天收涨还是收跌、谁领、什么驱动。不要预测明天涨跌(只点出明天的催化剂/财报)。
- **不是投资建议**——是「今天发生了什么、为什么」的复盘与信号。不喊单、不给目标价、不保证。
- 结合新闻找因果,不流水账。

结构(markdown,600-900 字。**不要输出大标题/日期**——外层已加,直接从第 1 节开始,每节用 ## 二级标题):
1. **一句话定调** —— 今天大盘收成什么样、谁领涨谁拖后。
2. **今天的主线** —— 挑出 2-3 条主线(板块/题材),每条讲清"涨/跌了多少 + 为什么"。
3. **消息面** —— 3-4 条驱动今天行情的新闻因果。
4. **盘后 & 明日看点** —— 今天盘后谁出财报、明天有什么重头戏,市场在赌什么。earnings 有 name 用 name,没 name 只写代码、绝不猜公司名/业务。
5. **一句话** —— 今天最该记住的那一点。

只输出第 1-5 节 markdown 正文,不要外层大标题、不要前后多余的话,不要提'五方'或任何内部产品功能。"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print("📰 抓收盘数据(Nasdaq)...")
    ctx = gather()
    (OUT / "_ctx_close.json").write_text(json.dumps(ctx, ensure_ascii=False, indent=1), encoding="utf-8")
    idx = ctx.get("indices", {})
    print("   收盘 " + " ".join(f"{k}{v['close_pct']}" for k, v in idx.items())
          + f" · 异动 {len(ctx.get('gainers', [])) + len(ctx.get('losers', []))}"
          + f" · 财报 {len(ctx.get('earnings', []))} · 新闻 {len(ctx.get('news', []))}")

    print("🧠 gpt-5.5 复盘(NDT,线上/本地同一条)...")
    report = llm_write(PROMPT, ctx)
    if not report:
        print("❌ gpt-5.5 无输出"); sys.exit(1)
    cut = report.find("## ")
    if cut > 0:
        report = report[cut:]
    report = report.strip()

    et = datetime.now(timezone(timedelta(hours=-4)))
    title = f"收盘复盘 · {et.strftime('%m-%d')}(美东收盘)"
    md = f"# {title}\n\n_收盘数据 · {et.strftime('%Y-%m-%d %H:%M ET')} · 我不是股神 · 非投资建议_\n\n{report}\n"
    path = OUT / f"close_{et.strftime('%Y%m%d')}.md"
    path.write_text(md, encoding="utf-8")
    print(f"✓ 报告 → {path}  ({len(report)} 字)")

    if "--no-email" not in sys.argv:
        try:
            from alerts.email_sender import send_briefing
            send_briefing(subject=f"📉 {title}", markdown_body=md)
            print("✉ 已发邮件")
        except Exception as e:
            print("⚠ 邮件跳过:", e)


if __name__ == "__main__":
    main()
