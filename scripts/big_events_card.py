"""TODAY'S BIG EVENTS 卡(报纸编辑部风)—— 全手画 HTML 模板,数字零 AI 渲染。

与网站「今日大事」同源同口径(Finnhub 宏观+财报 × us-stocks 名称/市值):
宏观降噪(MBA/EIA 折叠、low 白名单)+ KEY 标 high + Est/Prev 列 +
财报 PRE-MARKET / AFTER-HOURS 两栏(≥$0.5B 上正文,小盘归行)+ Focus 自动点主角。

版式:米色纸面 + 海军蓝衬线(Playfair)+ 橘红 Focus/KEY/时间 + 宝蓝分区标题,16:9。

用法: uv run python scripts/big_events_card.py [--date 2026-06-10]
输出 ~/Downloads/AInvest_events_<date>.png(3072×1728)
"""
from __future__ import annotations
import argparse
import json
import os
import re
import subprocess
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
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ASSETS = ROOT / "assets" / "brand-ainvest"
ET = timezone(timedelta(hours=-4))

# 英文名净化(Finnhub 原名 → 卡面名)
EN = [
    (r"Core Inflation Rate MoM", "Core CPI MoM"),
    (r"Core Inflation Rate YoY", "Core CPI YoY"),
    (r"Inflation Rate MoM", "CPI MoM"),
    (r"Inflation Rate YoY", "CPI YoY"),
    (r"EIA Crude Oil Stocks Change", "EIA Crude Oil Inventories"),
    (r"Monthly Budget Statement", "Monthly Federal Budget"),
    (r"(\d+)-Year Note Auction", r"\1-Year Treasury Auction"),
    (r"(\d+)-Year Bond Auction", r"\1-Year Treasury Bond Auction"),
    (r"Fed Interest Rate Decision", "FOMC Rate Decision"),
]
LOW_KEEP = re.compile(r"MBA Mortgage Applications|10-Year Note Auction|30-Year Bond Auction", re.I)
MED_DROP = re.compile(r"MBA (30-Year|Mortgage Market|Mortgage Refinance|Purchase)|"
                      r"EIA (?!Crude Oil Stocks Change)|CPI s\.a|^CPI$", re.I)


def en_name(s: str) -> str:
    for pat, rep in EN:
        if re.search(pat, s, re.I):
            return re.sub(pat, rep, s, flags=re.I)
    return s


def fnum(x) -> str:
    if x in (None, ""):
        return ""
    try:
        return f"{float(x):g}"
    except (TypeError, ValueError):
        return str(x)


def fetch(date: str):
    eco = requests.get("https://finnhub.io/api/v1/calendar/economic", params={"token": FINN}, timeout=25).json()
    macro, seen = [], set()
    for e in eco.get("economicCalendar") or []:
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
        nm = en_name(name)
        k = f"{dt:%H:%M}|{nm}"
        if k in seen:
            continue
        seen.add(k)
        macro.append({"t": f"{dt:%H:%M}", "hi": imp == "high", "name": nm,
                      "est": fnum(e.get("estimate")), "prev": fnum(e.get("prev"))})
    macro.sort(key=lambda m: (m["t"], not m["hi"]))

    us = {}
    try:
        us = {s["sym"]: (s.get("name"), s.get("mcapB")) for s in
              json.loads((ROOT / "web/public/data/us-stocks.json").read_text(encoding="utf-8"))["stocks"]}
    except Exception:
        pass
    ear = requests.get("https://finnhub.io/api/v1/calendar/earnings",
                       params={"from": date, "to": date, "token": FINN}, timeout=25).json()
    ears = ear.get("earningsCalendar") or []

    def grp(hours, cap):
        g = [e for e in ears if (e.get("hour") or "") in hours]
        g.sort(key=lambda e: -(us.get(e.get("symbol"), (None, 0))[1] or 0))
        main, small = [], []
        for e in g:
            sym = e.get("symbol") or ""
            nm, mc = us.get(sym, (None, None))
            if len(main) < cap and (mc or 0) >= 0.5:
                main.append({"sym": sym, "name": (nm or "")[:30], "mc": mc,
                             "eps": e.get("epsEstimate") if isinstance(e.get("epsEstimate"), (int, float)) else None})
            elif sym:
                small.append(sym)
        return main, small[:8]

    bmo, small_b = grp(("bmo",), 5)
    amc, small_a = grp(("amc", "", "dmh"), 5)
    # Focus:第一个 KEY 宏观 + 最大市值财报
    focus = []
    hi = next((m for m in macro if m["hi"]), None)
    if hi:
        focus.append(f"{hi['name'].replace(' MoM', '').replace(' YoY', '')} {hi['t']} ET")
    star = max(bmo + amc, key=lambda r: r["mc"] or 0, default=None)
    if star and (star["mc"] or 0) >= 20:
        focus.append(f"${star['sym']} {'Pre-Market' if star in bmo else 'After the Close'}")
    return macro, bmo, small_b, amc, small_a, " · ".join(focus)


# ===== 版式(报纸编辑部)=====
CREAM, INK, ORANGE, BLUE, RULE = "#F8F3E6", "#15243F", "#CE4B1E", "#1D5BD8", "#DCD5C2"


def macro_row(m) -> str:
    key = f'<span class="key">KEY</span>' if m["hi"] else '<span class="key-sp"></span>'
    est = f'<span class="lab">Est</span><span class="val">{m["est"]}</span>' if m["est"] else '<span class="lab"></span><span class="val"></span>'
    prev = f'<span class="lab">Prev</span><span class="val">{m["prev"]}</span>' if m["prev"] else '<span class="lab"></span><span class="val"></span>'
    cls = "t hi" if m["hi"] else "t"
    return (f'<div class="mrow"><span class="{cls}">{m["t"]}</span>{key}'
            f'<span class="mname{" b" if m["hi"] else ""}">{m["name"]}</span>'
            f'<span class="est">{est}</span><span class="prev">{prev}</span></div>')


def earn_rows(rows, small) -> str:
    out = ""
    for r in rows:
        mc = f"${r['mc']:.0f}B" if r["mc"] and r["mc"] >= 1 else ""
        eps = f"EPS est {r['eps']:.2f}" if r["eps"] is not None else ""
        out += (f'<div class="erow"><span class="esym">{r["sym"]}</span>'
                f'<span class="enm">{r["name"]}</span><span class="emc">{mc}</span>'
                f'<span class="eeps">{eps}</span></div>')
    if small:
        out += f'<div class="esmall">Small caps same day: <span class="blue">{", ".join(small)}</span></div>'
    return out


def build_html(date: str, macro, bmo, sb, amc, sa, focus) -> str:
    logo_svg = (ASSETS / "logo-ainvest.svg").read_text(encoding="utf-8")
    d = datetime.strptime(date, "%Y-%m-%d")
    wd = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][d.weekday()]
    title = f"TODAY&rsquo;S BIG EVENTS &bull; {d.month:02d}/{d.day:02d} &bull; {wd}"
    return f'''<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=STIX+Two+Text:ital,wght@0,500;0,600;0,700;1,500&display=swap" rel="stylesheet">
<style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  html,body {{ width:1656px; height:941px; }}
  body {{ font-variant-numeric:lining-nums tabular-nums; background:{CREAM}; color:{INK}; font-family:"STIX Two Text",Georgia,serif; padding:33px 64px 0; position:relative; }}
  h1 {{ font-family:"STIX Two Text",Georgia,serif; font-size:60px; font-weight:700; letter-spacing:0.01em; }}
  .focus {{ margin-top:10px; display:flex; align-items:baseline; }}
  .focus .f1 {{ font-size:32px; font-weight:700; }}
  .focus .f2 {{ font-size:32px; font-weight:700; color:{ORANGE}; margin-left:14px; }}
  .focus .note {{ margin-left:auto; font-size:20px; font-style:italic; color:#5B6472; }}
  .mtable {{ margin-top:18px; border-top:3px solid {INK}; }}
  .mrow {{ display:flex; align-items:baseline; gap:18px; padding:9px 4px; border-bottom:1px solid {RULE}; font-size:24px; }}
  .t {{ width:78px; font-weight:600; font-variant-numeric:tabular-nums; }}
  .t.hi {{ color:{ORANGE}; }}
  .key {{ background:{ORANGE}; color:#fff; font-family:-apple-system,sans-serif; font-size:14px; font-weight:800;
          letter-spacing:0.06em; padding:3px 10px; border-radius:4px; }}
  .key-sp {{ width:51px; display:inline-block; }}
  .mname {{ flex:1; }}
  .mname.b {{ font-weight:700; }}
  .est,.prev {{ display:flex; gap:12px; width:170px; justify-content:flex-end; font-variant-numeric:tabular-nums; }}
  .lab {{ color:{BLUE}; font-weight:600; font-size:21px; }}
  .prev .lab {{ color:#6B7280; }}
  .val {{ font-weight:700; min-width:58px; text-align:right; }}
  .earn {{ display:flex; margin-top:20px; gap:0; padding-bottom:86px; }}
  .ecol {{ flex:1; min-width:0; padding-right:36px; }}
  .ecol + .ecol {{ border-left:1px solid {RULE}; padding-left:36px; padding-right:0; }}
  .etitle {{ font-size:26px; font-weight:700; color:{BLUE};
             letter-spacing:0.04em; border-bottom:2.5px solid {BLUE}; display:inline-block; padding-bottom:4px; }}
  .erow {{ display:flex; align-items:baseline; gap:14px; padding:5.5px 0; font-size:21.5px; }}
  .esym {{ width:72px; font-weight:700; }}
  .enm {{ flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}
  .emc {{ width:72px; text-align:right; font-variant-numeric:tabular-nums; }}
  .eeps {{ width:148px; text-align:right; color:#3D4350; font-variant-numeric:tabular-nums; }}
  .esmall {{ margin-top:6px; font-size:19px; color:#5B6472; }}
  .blue {{ color:{BLUE}; font-weight:600; }}
  .logo {{ position:absolute; left:64px; bottom:34px; width:180px; }}
  .logo svg {{ width:100%; height:auto; }}
</style></head><body>
  <h1>{title}</h1>
  <div class="focus"><span class="f1">Focus:</span><span class="f2">{focus}</span>
    <span class="note">All times US Eastern (ET)</span></div>
  <div class="mtable">{"".join(macro_row(m) for m in macro)}</div>
  <div class="earn">
    <div class="ecol"><div class="etitle">PRE-MARKET EARNINGS</div><div style="margin-top:10px">{earn_rows(bmo, sb)}</div></div>
    <div class="ecol"><div class="etitle">AFTER-HOURS EARNINGS</div><div style="margin-top:10px">{earn_rows(amc, sa)}</div></div>
  </div>
  <div class="logo">{logo_svg}</div>
</body></html>'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="")
    args = ap.parse_args()
    if not FINN:
        sys.exit("缺 FINNHUB_KEY")
    date = args.date or datetime.now(ET).strftime("%Y-%m-%d")
    print(f"① 抓数 + 降噪({date})…")
    macro, bmo, sb, amc, sa, focus = fetch(date)
    print(f"   宏观 {len(macro)} 行 · 盘前 {len(bmo)}+{len(sb)} · 盘后 {len(amc)}+{len(sa)} · Focus: {focus}")
    html = build_html(date, macro, bmo, sb, amc, sa, focus)
    tmp = Path("/tmp/big_events.html")
    tmp.write_text(html, encoding="utf-8")
    out = OUT_DIR / f"AInvest_events_{date.replace('-', '')}.png"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--window-size=1656,941", "--force-device-scale-factor=2",
                    "--virtual-time-budget=8000",
                    f"--screenshot={out}", f"file://{tmp}"], capture_output=True, timeout=90)
    print(f"✅ {out}  ({out.stat().st_size//1024} KB)")


if __name__ == "__main__":
    main()
