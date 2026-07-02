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
MACRO_HORIZON = 32    # 宏观 + anchor 看整月(远期 CPI/FOMC 也进,支撑"月度全览")
EARN_HORIZON = 10     # 财报只近 10 天全列;远期靠 cal-anchors 点名精选,免财报季一列几百家刷屏
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
    """宏观 = ForexFactory(无 key,带 impact/forecast/previous)+ cal-anchors(远期确定性大事)。
    换掉挂掉的 Finnhub economic(免费档 2026-06 起 403)。同(日,类别)去重,CATS 归一化中文名。"""
    out, seen = [], set()
    # ① ForexFactory 本周 + 下周(覆盖未来 ~10 天),筛美国 High/Medium
    for ep in ("thisweek", "nextweek"):
        try:
            j = requests.get(f"https://nfs.faireconomy.media/ff_calendar_{ep}.json",
                             headers={"user-agent": "Mozilla/5.0"}, timeout=20).json()
        except Exception as ex:
            print(f"  ⚠ ForexFactory {ep} 失败:", str(ex)[:70]); continue
        for x in j if isinstance(j, list) else []:
            if str(x.get("country")) not in ("USD", "US") or x.get("impact") not in ("High", "Medium"):
                continue
            date = str(x.get("date", ""))[:10]
            if not (d0 <= date <= d1):
                continue
            title = str(x.get("title") or "")
            cat = next((c for c in CATS if c[2].search(title)), None)
            label = cat[0] if cat else title[:32]
            hi = bool(cat and cat[1]) or x.get("impact") == "High"
            k = (date, label)
            if k in seen:
                continue
            seen.add(k)
            fc, pv = x.get("forecast") or "", x.get("previous") or ""
            detail = " · ".join(s for s in [f"预期 {fc}" if fc else "", f"前值 {pv}" if pv else ""] if s)
            out.append({"date": date, "timeET": str(x.get("date", ""))[11:16], "kind": "macro",
                        "title": label, "detail": detail, "hi": hi})
    # ② cal-anchors.json:远期确定性大事(FOMC/央行/关键财报点名),ForexFactory 够不到的
    try:
        for a in json.loads((PUB / "cal-anchors.json").read_text(encoding="utf-8")):
            date = str(a.get("date", ""))
            if not (d0 <= date <= d1):
                continue
            is_e = "财报" in (a.get("title") or "")
            k = (date, a.get("title"))
            if k in seen:
                continue
            seen.add(k)
            out.append({"date": date, "timeET": "", "kind": "earnings" if is_e else "macro",
                        "title": (a.get("title") or "").replace("财报:", ""),
                        "detail": a.get("detail", ""), "hi": bool(a.get("hi"))})
    except Exception:
        pass
    return out


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
    d0 = et.strftime("%Y-%m-%d")
    d_macro = (et + timedelta(days=MACRO_HORIZON)).strftime("%Y-%m-%d")  # 宏观+anchor 看整月
    d_earn = (et + timedelta(days=EARN_HORIZON)).strftime("%Y-%m-%d")    # 财报只近 10 天
    print(f"📅 市场日历 · 宏观→{d_macro} · 财报→{d_earn}")
    events = fetch_macro(d0, d_macro) + fetch_earnings(d0, d_earn)
    events.sort(key=lambda e: (e["date"], e.get("timeET") or "99:99", 0 if e["kind"] == "macro" else 1))
    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    # 空结果保护:两源都抓空(Finnhub 限流/挂/key 失效)时绝不用空覆盖好数据 ——
    # 2026-06-17 就是被一次空抓写成 events:[],害 /reports 日历(无事件即 return null)整块消失。
    if not events:
        try:
            keep = [e for e in json.loads(OUT.read_text(encoding="utf-8")).get("events", []) if (e.get("date") or "") >= d0]
        except Exception:
            keep = []
        print(f"  ⚠ 本次抓取为空 —— {('保留旧文件 %d 条未过期事件' % len(keep)) if keep else '旧文件也无未过期事件'},不写空覆盖")
        return
    OUT.write_text(json.dumps({"generated_at": gen, "events": events}, ensure_ascii=False), encoding="utf-8")
    macro_n = sum(1 for e in events if e["kind"] == "macro")
    print(f"✅ {len(events)} 条(宏观 {macro_n} · 财报 {len(events)-macro_n}) → {OUT}")
    for e in events:
        tag = "宏观" if e["kind"] == "macro" else "财报"
        print(f"   {e['date']} {e.get('timeET') or '     ':5} [{tag}] {('🔴' if e['hi'] else '  ')} {e['title']}  {e.get('detail','')}")


if __name__ == "__main__":
    main()
