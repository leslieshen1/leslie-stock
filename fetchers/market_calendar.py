"""市场日历 —— 未来 ~10 天的宏观事件 + 重磅财报 → market-calendar.json。

盘报 tab 顶部的"接下来盯什么":
- 宏观:Finnhub economic calendar,筛美国高影响事件,同族(CPI 的环比/同比/核心…)合并成一行。
- 财报:Finnhub earnings calendar,只留大票(join us-stocks 市值 ≥ 阈值)。

输出 web/public/data/market-calendar.json:
  {generated_at, events:[{date,timeET,kind,title,detail,hi,sym?}...]}  按时间升序

用法: uv run python -m fetchers.market_calendar
"""
from __future__ import annotations
import json, os, re
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
try:
    from dotenv import load_dotenv; load_dotenv()
except Exception:
    pass

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
OUT = PUB / "market-calendar.json"
FINN = os.environ.get("FINNHUB_KEY") or os.environ.get("FINNHUB_TOKEN") or ""
HORIZON = 10          # 未来天数
MCAP_MIN = 20.0       # 财报只留 ≥200 亿美元的大票

# 高影响宏观类别:(中文名, 高亮, 命中正则, 取哪个子项做 detail)。同类别同日合并成一行。
CATS = [
    ("CPI 通胀", True, re.compile(r"\bcpi\b|inflation rate|consumer price index", re.I), re.compile(r"core.*mom", re.I)),
    ("PPI 物价", True, re.compile(r"\bppi\b|producer price", re.I), re.compile(r"\bmom\b", re.I)),
    ("PCE 物价(美联储锚)", True, re.compile(r"\bpce\b|personal consumption", re.I), re.compile(r"core.*mom", re.I)),
    ("美联储利率决议", True, re.compile(r"fomc|fed interest rate|interest rate decision|fed funds", re.I), None),
    ("非农就业", True, re.compile(r"non.?farm|nonfarm payroll", re.I), None),
    ("失业率", True, re.compile(r"unemployment rate", re.I), None),
    ("零售销售", True, re.compile(r"retail sales", re.I), re.compile(r"\bmom\b", re.I)),
    ("GDP", True, re.compile(r"\bgdp\b", re.I), None),
    ("首申失业金", False, re.compile(r"initial jobless", re.I), None),
    ("ISM / PMI", False, re.compile(r"ism manufacturing|ism services|manufacturing pmi|services pmi", re.I), None),
    # 注意:不能裸匹配 michigan——"Michigan Inflation Expectations" 是通胀预期不是信心
    ("消费者信心", False, re.compile(r"consumer sentiment|consumer confidence", re.I), None),
    ("耐用品订单", False, re.compile(r"durable goods", re.I), None),
]


def _et(utc_str: str):
    """'2026-06-10 12:30:00'(UTC)→ (date, 'HH:MM')ET。"""
    try:
        dt = datetime.strptime(utc_str.strip(), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        e = dt.astimezone(timezone(timedelta(hours=-4)))
        return e.strftime("%Y-%m-%d"), e.strftime("%H:%M")
    except Exception:
        return (utc_str[:10] if utc_str else None), ""


def _pct(x):
    """只把"像百分比"的小数值格式化成 %;指数点位(如 CPI=335)、失业人数(千)等大数 → 不显示。"""
    if x in (None, "", "None"):
        return None
    try:
        v = float(x)
    except (ValueError, TypeError):
        return None
    if abs(v) >= 50:
        return None
    return f"{v:g}%"


def fetch_macro(d0, d1):
    groups: dict = {}  # (date,label) -> 记录(取 pri 最高的子项做 detail)
    try:
        j = requests.get("https://finnhub.io/api/v1/calendar/economic", params={"token": FINN}, timeout=25).json()
        ev = j.get("economicCalendar") or j.get("result") or []
        for e in ev:
            if not isinstance(e, dict) or (e.get("country") or "") not in ("US", "United States"):
                continue
            name = str(e.get("event") or "")
            cat = next((c for c in CATS if c[2].search(name)), None)
            if not cat:
                continue
            label, hi, _rx, prefer = cat
            date, t = _et(str(e.get("time") or ""))
            if not date or not (d0 <= date <= d1):
                continue
            est, prev = _pct(e.get("estimate")), _pct(e.get("prev"))
            detail = " · ".join(x for x in [f"预期 {est}" if est else "", f"前值 {prev}" if prev else ""] if x)
            pri = 2 if (prefer and prefer.search(name)) else (1 if detail else 0)
            key = (date, label)
            g = groups.get(key)
            if g is None or pri > g["pri"]:
                groups[key] = {"date": date, "timeET": t, "kind": "macro", "title": label,
                               "detail": detail, "hi": hi, "pri": pri}
            elif g and t and t < (g["timeET"] or "99:99"):
                g["timeET"] = t
    except Exception as ex:
        print("  ⚠ macro 抓取失败:", str(ex)[:80])
    return [{k: v for k, v in g.items() if k != "pri"} for g in groups.values()]


def fetch_earnings(d0, d1):
    names, mcaps = {}, {}
    try:
        us = json.loads((PUB / "us-stocks.json").read_text(encoding="utf-8")).get("stocks", [])
        names = {s["sym"]: s.get("name") for s in us}
        mcaps = {s["sym"]: (s.get("mcapB") or 0) for s in us}
    except Exception:
        pass
    HOUR = {"bmo": "盘前", "amc": "盘后", "dmh": "盘中"}
    out = []
    try:
        j = requests.get("https://finnhub.io/api/v1/calendar/earnings",
                         params={"from": d0, "to": d1, "token": FINN}, timeout=25).json()
        for e in (j.get("earningsCalendar") or []):
            sym = e.get("symbol")
            mc = mcaps.get(sym, 0)
            if mc < MCAP_MIN:
                continue
            est = e.get("epsEstimate")
            detail = (f"预期 EPS {est:.2f} · " if isinstance(est, (int, float)) else "") + f"${mc:.0f}B"
            out.append({"date": e.get("date"), "timeET": HOUR.get(e.get("hour"), ""), "kind": "earnings",
                        "sym": sym, "title": names.get(sym) or sym, "detail": detail, "hi": mc >= 200})
    except Exception as ex:
        print("  ⚠ earnings 抓取失败:", str(ex)[:80])
    return out


def main():
    et = datetime.now(timezone(timedelta(hours=-4)))
    d0, d1 = et.strftime("%Y-%m-%d"), (et + timedelta(days=HORIZON)).strftime("%Y-%m-%d")
    print(f"📅 市场日历 {d0} → {d1}")
    events = fetch_macro(d0, d1) + fetch_earnings(d0, d1)
    events.sort(key=lambda e: (e["date"], e.get("timeET") or "99:99", 0 if e["kind"] == "macro" else 1))
    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    OUT.write_text(json.dumps({"generated_at": gen, "events": events}, ensure_ascii=False), encoding="utf-8")
    macro_n = sum(1 for e in events if e["kind"] == "macro")
    print(f"✅ {len(events)} 条(宏观 {macro_n} · 财报 {len(events)-macro_n}) → {OUT}")
    for e in events:
        tag = "宏观" if e["kind"] == "macro" else "财报"
        print(f"   {e['date']} {e.get('timeET') or '     ':5} [{tag}] {('🔴' if e['hi'] else '  ')} {e['title']}  {e.get('detail','')}")


if __name__ == "__main__":
    main()
