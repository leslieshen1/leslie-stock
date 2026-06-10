"""今日事(纯文本)—— 每天 17:00 北京自动出,落 ~/Downloads,复制即发。

自家源:Finnhub 经济+财报日历 + 自家 us-stocks 补公司名/市值。
比对手版多:预期/前值、市值上下文、重要度标记、自动"今日主角"。
不装假精度:财报只标 盘前/盘后(Finnhub 免费档没有精确到分的时间)。

用法: uv run python scripts/today_events.py [--date 2026-06-10]
"""
from __future__ import annotations
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
try:
    from dotenv import load_dotenv; load_dotenv(ROOT / ".env")
except Exception:
    pass
FINN = os.environ.get("FINNHUB_KEY") or ""
OUT_DIR = Path.home() / "Downloads"
ET = timezone(timedelta(hours=-4))

# 宏观事件中文名(常见高频;没映射的保留英文)
ZH = [
    (r"Core Inflation Rate MoM", "核心CPI 环比"),
    (r"Core Inflation Rate YoY", "核心CPI 同比"),
    (r"Inflation Rate MoM", "CPI 环比"),
    (r"Inflation Rate YoY", "CPI 同比"),
    (r"Core PPI|PPI MoM|Producer Price.*MoM", "PPI 环比"),
    (r"PPI YoY|Producer Price.*YoY", "PPI 同比"),
    (r"Core PCE.*MoM", "核心PCE 环比"),
    (r"Fed Interest Rate Decision|FOMC", "美联储利率决议"),
    (r"Non.?Farm Payrolls", "非农就业"),
    (r"Unemployment Rate", "失业率"),
    (r"Initial Jobless Claims", "首申失业金"),
    (r"Retail Sales MoM", "零售销售 环比"),
    (r"GDP Growth Rate", "GDP"),
    (r"Michigan Consumer Sentiment", "密歇根消费者信心"),
    (r"ISM Manufacturing", "ISM 制造业"),
    (r"ISM Services", "ISM 服务业"),
    (r"MBA Mortgage Applications", "MBA 按揭申请"),
    (r"EIA Crude Oil Stocks Change", "EIA 原油库存"),
    (r"Monthly Budget Statement", "月度财政收支"),
    (r"(\d+)-Year Note Auction", r"\1年期国债拍卖"),
    (r"(\d+)-Year Bond Auction", r"\1年期长债拍卖"),
]
# 低重要度白名单(low 也保留的)
LOW_KEEP = re.compile(r"MBA Mortgage Applications|10-Year Note Auction|30-Year Bond Auction", re.I)
# 中重要度黑名单(medium 也丢的:同族噪音,保代表行即可)
MED_DROP = re.compile(r"MBA (30-Year|Mortgage Market|Mortgage Refinance|Purchase)|"
                      r"EIA (?!Crude Oil Stocks Change)|CPI s\.a|^CPI$", re.I)


def zh_name(en: str) -> str:
    for pat, rep in ZH:
        m = re.search(pat, en, re.I)
        if m:
            return re.sub(pat, rep, en, flags=re.I) if "\\1" in rep else rep
    return en


def fnum(x) -> str:
    if x in (None, ""):
        return ""
    try:
        v = float(x)
        return f"{v:g}"
    except (TypeError, ValueError):
        return str(x)


def macro_lines(date: str) -> list[str]:
    j = requests.get("https://finnhub.io/api/v1/calendar/economic", params={"token": FINN}, timeout=25).json()
    rows = []
    for e in j.get("economicCalendar") or []:
        if e.get("country") not in ("US", "United States"):
            continue
        try:
            dt = datetime.strptime(str(e.get("time", "")), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).astimezone(ET)
        except ValueError:
            continue
        if dt.strftime("%Y-%m-%d") != date:
            continue
        name, imp = str(e.get("event", "")), str(e.get("impact", ""))
        if imp == "low" and not LOW_KEEP.search(name):
            continue
        if imp == "medium" and MED_DROP.search(name):
            continue
        if imp == "high" and re.search(r"CPI s\.a|^CPI$", name):
            continue
        mark = "🔴 " if imp == "high" else ""
        est, prev = fnum(e.get("estimate")), fnum(e.get("prev"))
        tail = " · ".join(x for x in [f"预期 {est}" if est else "", f"前值 {prev}" if prev else ""] if x)
        rows.append((dt.strftime("%H:%M"), f"{dt.strftime('%H:%M')}  {mark}{zh_name(name)}" + (f"  {tail}" if tail else "")))
    rows.sort()
    # 同名去重(Finnhub 偶有重复行)
    seen, out = set(), []
    for _, line in rows:
        key = re.sub(r"\s+", " ", line)
        if key not in seen:
            seen.add(key)
            out.append(line)
    return out


def earnings_lines(date: str) -> tuple[list[str], list[str], str]:
    us = {}
    try:
        us = {s["sym"]: (s.get("name"), s.get("mcapB")) for s in
              json.loads((ROOT / "web/public/data/us-stocks.json").read_text(encoding="utf-8"))["stocks"]}
    except Exception:
        pass
    j = requests.get("https://finnhub.io/api/v1/calendar/earnings",
                     params={"from": date, "to": date, "token": FINN}, timeout=25).json()
    ears = j.get("earningsCalendar") or []
    star = ("", 0.0)  # 主角财报(最大市值)

    def fmt(e) -> str | None:
        nonlocal star
        sym = e.get("symbol") or ""
        nm, mc = us.get(sym, (None, None))
        if mc and mc > star[1]:
            star = (sym, mc)
        eps = e.get("epsEstimate")
        bits = [f"${sym}"]
        if nm:
            bits.append(nm[:26])
        if mc and mc >= 1:
            bits.append(f"${mc:.0f}B")
        if isinstance(eps, (int, float)):
            bits.append(f"EPS est {eps:.2f}")
        return "  ".join(bits)

    def grp(hours: tuple[str, ...], cap: int) -> list[str]:
        g = [e for e in ears if (e.get("hour") or "") in hours]
        g.sort(key=lambda e: -(us.get(e.get("symbol"), (None, 0))[1] or 0))
        out, rest = [], []
        for e in g:
            mc = us.get(e.get("symbol"), (None, 0))[1] or 0
            (out if (len(out) < cap and mc >= 0.5) else rest).append(e)
        lines = [fmt(e) for e in out]
        if rest:
            small = [f"${e.get('symbol')}" for e in rest if e.get("symbol")][:8]
            if small:
                lines.append("小盘同日: " + " ".join(small))
        return lines

    return grp(("bmo",), 6), grp(("amc", "", "dmh"), 7), (f"${star[0]}" if star[0] else "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="")
    args = ap.parse_args()
    if not FINN:
        sys.exit("缺 FINNHUB_KEY")
    now = datetime.now(ET)
    date = args.date or now.strftime("%Y-%m-%d")
    wd = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][datetime.strptime(date, "%Y-%m-%d").weekday()]

    macro = macro_lines(date)
    bmo, amc, star = earnings_lines(date)
    hi_macro = [l for l in macro if "🔴" in l]
    lead_bits = []
    if hi_macro:
        m = re.search(r"(\d{2}:\d{2})\s+🔴\s+(\S+)", hi_macro[0])
        if m:
            lead_bits.append(f"{m.group(2).split(' ')[0]} {m.group(1)}")
    if star:
        lead_bits.append(f"{star} 盘后")

    L = [f"今日事 · {date.replace('-', '/')}({wd},全美东时间)", ""]
    if macro:
        L += ["【宏观】"] + macro + [""]
    if bmo:
        L += ["【盘前财报】"] + bmo + [""]
    if amc:
        L += ["【盘后财报】"] + amc + [""]
    if lead_bits:
        L += [f"今日主角:{' · '.join(lead_bits)}"]
    text = "\n".join(L).rstrip() + "\n"

    out = OUT_DIR / f"TodayEvents_{date.replace('-', '')}.txt"
    out.write_text(text, encoding="utf-8")
    print(text)
    print(f"→ {out}")


if __name__ == "__main__":
    main()
