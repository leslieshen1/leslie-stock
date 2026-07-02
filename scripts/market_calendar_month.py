"""当月市场日历 → 供盘报"关键事件前瞻"模块用。三源合一:

  财报   Finnhub /calendar/earnings(整月,按市值筛大票)          —— 全自动
  宏观   ForexFactory ff_calendar_thisweek/nextweek(US,High/Med) —— 近 2 周自动带预期
  远期大事 data/cal-anchors.json(手动:FOMC/NFP/CPI 日程,月初定一次) —— 骨架

输出:按周组织的当月日历 dict,可塞进 reports.json 的一条 calendar 盘报。
MVP 先 --preview 打印文本,确认数据对再接页面。

用法: python scripts/market_calendar_month.py [--month 2026-07] [--preview]
"""
from __future__ import annotations
import argparse
import json
import os
from datetime import date, datetime, timedelta
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
try:
    from dotenv import load_dotenv; load_dotenv(ROOT / ".env")
except Exception:
    pass
FINN = os.environ.get("FINNHUB_KEY") or ""
UA = {"user-agent": "Mozilla/5.0"}
MEGA = 20.0  # 财报市值门槛($B):只把 ≥$20B 的大票放进日历,小票太多是噪音


def us_caps() -> dict:
    try:
        return {s["sym"]: (s.get("name"), s.get("mcapB")) for s in
                json.loads((PUB / "us-stocks.json").read_text(encoding="utf-8"))["stocks"]}
    except Exception:
        return {}


def earnings(m1: str, m2: str, caps: dict) -> list[dict]:
    if not FINN:
        return []
    try:
        j = requests.get("https://finnhub.io/api/v1/calendar/earnings",
                         params={"from": m1, "to": m2, "token": FINN}, timeout=25).json()
    except Exception:
        return []
    seen, rows = set(), []
    for e in j.get("earningsCalendar") or []:
        sym = e.get("symbol") or ""
        if not sym or sym in seen:
            continue
        seen.add(sym)
        nm, mc = caps.get(sym, (None, None))
        if (mc or 0) < MEGA:
            continue
        rows.append({"date": e.get("date"), "kind": "earnings", "sym": sym,
                     "name": nm or sym, "mc": mc, "hour": e.get("hour") or ""})
    return sorted(rows, key=lambda r: (r["date"], -(r["mc"] or 0)))


def macro(m1: str, m2: str) -> list[dict]:
    out, seen = [], set()
    for ep in ("thisweek", "nextweek"):
        try:
            j = requests.get(f"https://nfs.faireconomy.media/ff_calendar_{ep}.json", headers=UA, timeout=20).json()
        except Exception:
            continue
        for x in j:
            if str(x.get("country")) not in ("USD", "US"):
                continue
            if x.get("impact") not in ("High", "Medium"):
                continue
            d = str(x.get("date", ""))[:10]
            if not (m1 <= d <= m2):
                continue
            k = f"{d}|{x.get('title')}"
            if k in seen:
                continue
            seen.add(k)
            out.append({"date": d, "kind": "macro", "title": x.get("title"),
                        "impact": x.get("impact"), "time": str(x.get("date", ""))[11:16],
                        "forecast": x.get("forecast") or "", "previous": x.get("previous") or ""})
    return out


def anchors(m1: str, m2: str) -> list[dict]:
    """手动/远期确定性大事(FOMC/NFP/CPI 日程 + 央行 + 假期),月初定一次,补 ForexFactory 够不到的远期。"""
    try:
        a = json.loads((PUB / "cal-anchors.json").read_text(encoding="utf-8"))
    except Exception:
        return []
    return [dict(e, kind="anchor") for e in a if m1 <= str(e.get("date", "")) <= m2]


def build(month: str) -> dict:
    y, mo = map(int, month.split("-"))
    m1 = f"{y}-{mo:02d}-01"
    last = (date(y + (mo == 12), (mo % 12) + 1, 1) - timedelta(days=1)).day
    m2 = f"{y}-{mo:02d}-{last:02d}"
    caps = us_caps()
    evs = earnings(m1, m2, caps) + macro(m1, m2) + anchors(m1, m2)
    # 按周分组(周一为界)
    weeks: dict[str, list] = {}
    for e in evs:
        try:
            d = datetime.strptime(e["date"], "%Y-%m-%d").date()
        except Exception:
            continue
        wk = (d - timedelta(days=d.weekday())).isoformat()  # 该周周一
        weeks.setdefault(wk, []).append(e)
    for wk in weeks:
        weeks[wk].sort(key=lambda e: (e["date"], {"anchor": 0, "macro": 1, "earnings": 2}.get(e["kind"], 3)))
    return {"month": month, "as_of": datetime.now().strftime("%Y-%m-%d"),
            "weeks": [{"weekOf": wk, "events": weeks[wk]} for wk in sorted(weeks)]}


def preview(cal: dict) -> None:
    WD = ["一", "二", "三", "四", "五", "六", "日"]
    print(f"\n=== {cal['month']} 市场日历 ===")
    for w in cal["weeks"]:
        print(f"\n■ 周 {w['weekOf']}")
        for e in w["events"]:
            d = datetime.strptime(e["date"], "%Y-%m-%d")
            tag = f"{d.month}/{d.day}(周{WD[d.weekday()]})"
            if e["kind"] == "macro":
                fp = f" 预期{e['forecast']}" if e["forecast"] else ""
                pv = f" 前值{e['previous']}" if e["previous"] else ""
                star = "★" if e["impact"] == "High" else " "
                print(f"  {tag} {star}[数据] {e['time']} {e['title']}{fp}{pv}")
            elif e["kind"] == "earnings":
                print(f"  {tag}  [财报] {e['sym']} {e['name'][:20]} ${e['mc']:.0f}B {e['hour']}")
            else:
                print(f"  {tag} ★[大事] {e.get('title') or e.get('name')} · {e.get('detail','')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", default=datetime.now().strftime("%Y-%m"))
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    cal = build(args.month)
    n = sum(len(w["events"]) for w in cal["weeks"])
    print(f"✓ {args.month}: {len(cal['weeks'])} 周 · {n} 个事件")
    if args.preview:
        preview(cal)
    if args.out:
        Path(args.out).write_text(json.dumps(cal, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"  写 {args.out}")


if __name__ == "__main__":
    main()
