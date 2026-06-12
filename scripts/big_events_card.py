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
OUT_DIR = Path.home() / "Downloads" / "AInvest卡片"   # 专属文件夹,好找
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


IPO_ALIAS = {"SPCX": "SpaceX"}  # 知名公司短名(Finnhub 全大写法律名太长)


def fetch_ipos(date: str):
    """当天 ≥$1B 的 IPO 行 + 未来 7 天 ≥$10B 巨无霸(进 Focus)。"""
    d1 = (datetime.strptime(date, "%Y-%m-%d") + timedelta(days=7)).strftime("%Y-%m-%d")
    try:
        j = requests.get("https://finnhub.io/api/v1/calendar/ipo",
                         params={"from": date, "to": d1, "token": FINN}, timeout=20).json()
    except Exception:
        return [], None
    rows, mega = [], None
    for i in j.get("ipoCalendar") or []:
        val = i.get("totalSharesValue") or 0
        nm = (i.get("name") or "").title()
        nm = re.sub(r"\b(Corp|Inc|Llc|Ltd)\b\.?", lambda m: m.group(1), nm)
        sym0 = i.get("symbol") or ""
        if sym0 in IPO_ALIAS:
            nm = IPO_ALIAS[sym0]
        rec = {"date": i.get("date"), "sym": sym0, "name": nm[:34],
               "exch": (i.get("exchange") or "").split()[0], "price": i.get("price") or "",
               "val": val}
        if rec["date"] == date and val >= 1e9:
            rows.append(rec)
        if val >= 1e10 and (mega is None or val > mega["val"]):
            mega = rec
    return rows, mega


def fetch(date: str, extra_macro: list | None = None):
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
    # 手动注入(Finnhub econ 日历 2026-06-11 起免费档 403;--macro-json 兜底,行格式同上)
    for m in (extra_macro or []):
        k = f"{m.get('t','')}|{m.get('name','')}"
        if k in seen:
            continue
        seen.add(k)
        macro.append({"t": m.get("t", ""), "hi": bool(m.get("hi")), "name": m.get("name", ""),
                      "est": str(m.get("est", "") or ""), "prev": str(m.get("prev", "") or "")})
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
        main, small, used = [], [], set()
        for e in g:
            sym = e.get("symbol") or ""
            if not sym or sym in used:
                continue  # Finnhub 同一 sym 偶发多行(PPIH 2026-06-11 踩过)
            used.add(sym)
            nm, mc = us.get(sym, (None, None))
            if len(main) < cap and (mc or 0) >= 0.5:
                main.append({"sym": sym, "name": (nm or "")[:30], "mc": mc,
                             "eps": e.get("epsEstimate") if isinstance(e.get("epsEstimate"), (int, float)) else None})
            else:
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
    ipo_rows, mega = fetch_ipos(date)
    if mega:
        wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][datetime.strptime(mega["date"], "%Y-%m-%d").weekday()]
        when = "Today" if mega["date"] == date else wd
        first = IPO_ALIAS.get(mega["sym"], mega["name"].split()[0])
        focus.append(f"{first} IPO {when}")
    return macro, ipo_rows, bmo, small_b, amc, small_a, " · ".join(focus), mega


WD3 = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
NASDAQ_HDRS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}


def yesterday_close() -> list[dict]:
    """四指数上一交易日收盘 % —— 只读 yclose.json(05:00 闭市时由 capture_yclose.py 落盘的 SoT)。

    绝不在盘前时段临场调 Nasdaq:2026-06-11 实测该端点部分边缘节点把盘前价标成
    "Closed at",同进程共识双询都防不住。文件超过 4 天视为停更,宁可不显示。
    """
    try:
        j = json.loads((ROOT / "web" / "public" / "data" / "yclose.json").read_text(encoding="utf-8"))
        age = (datetime.now(ET).date() - datetime.strptime(j["date"], "%Y-%m-%d").date()).days
        if age <= 4:
            return [{"label": r["label"], "pct": str(r["pct"])} for r in j.get("rows", [])]
    except Exception:
        pass
    return []


def ahead_events(date: str, mega) -> list[dict]:
    """未来 ~8 天看点:① 巨型 IPO(fetch 已算)② data/cards/ahead.json 手动确定性大事(FOMC 等,过期自动滤)③ 日历大财报。"""
    horizon = (datetime.strptime(date, "%Y-%m-%d") + timedelta(days=8)).strftime("%Y-%m-%d")

    def when(ds: str) -> str:
        dt = datetime.strptime(ds, "%Y-%m-%d")
        return f"{WD3[dt.weekday()]} {dt.month:02d}/{dt.day:02d}"

    rows = []
    if mega and date < mega["date"] <= horizon:
        big = (mega.get("val") or 0) >= 5e10
        rows.append({"when": when(mega["date"]), "name": f'{IPO_ALIAS.get(mega["sym"], mega["name"])} IPO ({mega["sym"]})',
                     "detail": "biggest IPO ever" if big else "mega IPO", "hi": True, "_d": mega["date"]})
    try:
        for m in json.loads((ROOT / "web" / "public" / "data" / "ahead.json").read_text(encoding="utf-8")):
            if date < str(m.get("date", "")) <= horizon:
                rows.append({"when": when(m["date"]), "name": str(m.get("name", ""))[:42],
                             "detail": str(m.get("detail", ""))[:40], "hi": bool(m.get("hi")), "_d": m["date"]})
    except Exception:
        pass
    try:
        cal = json.loads((ROOT / "web" / "public" / "data" / "market-calendar.json").read_text(encoding="utf-8"))["events"]
        ee = sorted([e for e in cal if e.get("kind") == "earnings" and date < str(e.get("date", "")) <= horizon],
                    key=lambda e: str(e.get("date", "")))
        for e in ee[:4]:
            det = (str(e.get("detail", ""))
                   .replace("预期", "Est").replace("盘前", "pre-market").replace("盘后", "after close"))[:36]
            rows.append({"when": when(e["date"]), "name": f'${e.get("sym", "")} earnings',
                         "detail": det, "hi": False, "_d": e["date"]})
    except Exception:
        pass
    # 海报英文铁律:任何字段仍含 CJK 的行直接丢弃
    rows = [r for r in rows if not re.search(r"[一-鿿]", r["name"] + r["detail"])]
    rows.sort(key=lambda r: (r["_d"], not r["hi"]))
    return rows


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


def ipo_row(i) -> str:
    val = f"${i['val']/1e9:.0f}B raise" if i["val"] >= 1e9 else ""
    price = f"${i['price']}" if i["price"] else ""
    return (f'<div class="mrow"><span class="t hi">&mdash;</span><span class="key">IPO</span>'
            f'<span class="mname b">{i["name"]} ({i["sym"]}) &mdash; {i["exch"]}</span>'
            f'<span class="est"><span class="lab">Price</span><span class="val">{price}</span></span>'
            f'<span class="prev"><span class="lab"></span><span class="val">{val}</span></span></div>')


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


def build_html(date: str, macro, ipos, bmo, sb, amc, sa, focus, yday=None, ahead=None) -> str:
    logo_svg = (ASSETS / "logo-ainvest.svg").read_text(encoding="utf-8")
    aime = (ASSETS / "aime-bullish.png").resolve()
    d = datetime.strptime(date, "%Y-%m-%d")
    wd = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][d.weekday()]
    title = f"TODAY&rsquo;S BIG EVENTS &bull; {d.month:02d}/{d.day:02d} &bull; {wd}"

    # ===== 密度自适应:今日内容少 → 底部补 YESTERDAY 收盘条 + AHEAD 前瞻(都是真数据,不是装饰)=====
    thin = (len(macro) + len(ipos) + len(bmo) + len(amc)) < 10
    ahead = ahead or []
    band_rows = ahead[:4] if thin else [r for r in ahead if r["hi"]][:2]
    yday = (yday or []) if thin else []
    band_html = ""
    if band_rows or yday:
        ych = "".join(
            f'<span class="ychip"><span class="ylab">{y["label"]}</span>'
            f'<span class="yval {"dn" if y["pct"].strip().startswith("-") else "up"}">{y["pct"]}%</span></span>'
            for y in yday)
        ycol = f'<div class="bcol bl"><div class="btitle gray">YESTERDAY &middot; CLOSE</div><div class="ychips">{ych}</div></div>' if ych else ""
        arows = "".join(
            f'<div class="arow"><span class="awhen{" hi" if r["hi"] else ""}">{r["when"]}</span>'
            f'<span class="aname{" b" if r["hi"] else ""}">{r["name"]}</span>'
            f'<span class="adet">{r["detail"]}</span></div>'
            for r in band_rows)
        acol = f'<div class="bcol br"><div class="btitle">AHEAD</div><div style="margin-top:10px">{arows}</div></div>' if arows else ""
        band_html = f'<div class="band">{ycol}{acol}</div>'
    return f'''<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=STIX+Two+Text:ital,wght@0,500;0,600;0,700;1,500&display=swap" rel="stylesheet">
<style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  html,body {{ width:1656px; height:941px; }}
  body {{ font-variant-numeric:lining-nums tabular-nums; background:{CREAM}; color:{INK}; font-family:"STIX Two Text",Georgia,serif; padding:33px 64px 0; position:relative; }}
  h1 {{ font-family:"STIX Two Text",Georgia,serif; font-size:56px; font-weight:700; letter-spacing:0.01em; }}
  .focus {{ margin-top:6px; display:flex; align-items:baseline; }}
  .focus .f1 {{ font-size:32px; font-weight:700; }}
  .focus .f2 {{ font-size:32px; font-weight:700; color:{ORANGE}; margin-left:14px; }}
  .focus .note {{ margin-left:auto; font-size:20px; font-style:italic; color:#5B6472; }}
  .mtable {{ margin-top:14px; border-top:3px solid {INK}; }}
  .mrow {{ display:flex; align-items:baseline; gap:18px; padding:8px 4px; border-bottom:1px solid {RULE}; font-size:24px; }}
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
  .earn {{ display:flex; margin-top:14px; gap:0; padding-bottom:24px; }}
  .ecol {{ flex:1; min-width:0; padding-right:36px; }}
  .ecol + .ecol {{ border-left:1px solid {RULE}; padding-left:36px; padding-right:0; }}
  .etitle {{ font-size:26px; font-weight:700; color:{BLUE};
             letter-spacing:0.04em; border-bottom:2.5px solid {BLUE}; display:inline-block; padding-bottom:4px; }}
  .erow {{ display:flex; align-items:baseline; gap:14px; padding:5.5px 0; font-size:21.5px; }}
  .esym {{ width:72px; font-weight:700; }}
  .enm {{ flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}
  .emc {{ width:72px; text-align:right; font-variant-numeric:tabular-nums; }}
  .eeps {{ width:148px; text-align:right; color:#3D4350; font-variant-numeric:tabular-nums; }}
  .esmall {{ margin-top:4px; font-size:18px; color:#5B6472; }}
  .blue {{ color:{BLUE}; font-weight:600; }}
  /* 瘦日填充带:昨收 + 前瞻 */
  .band {{ display:flex; margin-top:10px; border-top:3px solid {INK}; padding-top:16px; }}
  .bcol {{ min-width:0; }}
  .bcol.bl {{ width:430px; flex:none; padding-right:36px; }}
  .bcol.br {{ flex:1; }}
  .bcol.bl + .bcol.br {{ border-left:1px solid {RULE}; padding-left:36px; }}
  .btitle {{ font-size:26px; font-weight:700; color:{BLUE}; letter-spacing:0.04em;
             border-bottom:2.5px solid {BLUE}; display:inline-block; padding-bottom:4px; }}
  .btitle.gray {{ color:#5B6472; border-color:#5B6472; }}
  .ychips {{ margin-top:16px; display:flex; flex-direction:column; gap:9px; }}
  .ychip {{ display:flex; align-items:baseline; font-size:23px; }}
  .ylab {{ color:#3D4350; }}
  .yval {{ margin-left:auto; font-weight:700; font-variant-numeric:tabular-nums; }}
  .yval.up {{ color:#1E7A3C; }}
  .yval.dn {{ color:#C0331B; }}
  .arow {{ display:flex; align-items:baseline; gap:16px; padding:6.5px 0; font-size:22px; border-bottom:1px solid {RULE}; }}
  .arow:last-child {{ border-bottom:none; }}
  .awhen {{ width:128px; flex:none; font-weight:600; font-variant-numeric:tabular-nums; color:#3D4350; }}
  .awhen.hi {{ color:{ORANGE}; }}
  .aname {{ flex:none; }}
  .aname.b {{ font-weight:700; }}
  .adet {{ color:#5B6472; font-size:19px; margin-left:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}
  .foot {{ position:absolute; left:64px; bottom:24px; width:720px; display:flex; align-items:center;
            gap:18px; border-top:1.5px solid {RULE}; padding-top:12px; }}
  .foot .logo {{ width:150px; flex:none; }}
  .foot .logo svg {{ width:100%; height:auto; }}
  .cta {{ display:flex; align-items:center; gap:14px; }}
  .aime {{ width:92px; margin-bottom:-4px; filter:drop-shadow(0 6px 14px rgba(21,36,63,0.18)); }}
  .store {{ display:flex; gap:10px; align-items:center; }}
  .sb {{ height:44px; }}
</style></head><body>
  <h1>{title}</h1>
  <div class="focus"><span class="f1">Focus:</span><span class="f2">{focus}</span>
    <span class="note">All times US Eastern (ET)</span></div>
  <div class="mtable">{"".join(macro_row(m) for m in macro)}{"".join(ipo_row(i) for i in ipos)}</div>
  <div class="earn">
    <div class="ecol"><div class="etitle">PRE-MARKET EARNINGS</div><div style="margin-top:10px">{earn_rows(bmo, sb)}</div></div>
    <div class="ecol"><div class="etitle">AFTER-HOURS EARNINGS</div><div style="margin-top:10px">{earn_rows(amc, sa)}</div></div>
  </div>
  {band_html}
  <div class="foot">
    <div class="logo">{logo_svg}</div>
    <div class="cta">
      <img class="aime" src="file://{aime}"/>
      <span class="store">
        <svg class="sb" viewBox="0 0 140 46"><rect width="140" height="46" rx="9" fill="#15243F"/><path d="M28.5 23.6c0-3.4 2.8-5 2.9-5.1-1.6-2.3-4-2.6-4.9-2.7-2.1-.2-4.1 1.2-5.1 1.2-1 0-2.7-1.2-4.4-1.2-2.3 0-4.4 1.3-5.5 3.3-2.4 4.1-.6 10.2 1.7 13.5 1.1 1.6 2.4 3.4 4.2 3.4 1.7-.1 2.3-1.1 4.4-1.1 2 0 2.6 1.1 4.4 1.1 1.8 0 3-1.6 4.1-3.3 1.3-1.9 1.8-3.7 1.8-3.8-.1 0-3.5-1.4-3.6-5.3zM25.1 13.7c.9-1.1 1.6-2.7 1.4-4.3-1.4.1-3 .9-4 2.1-.9 1-1.7 2.7-1.5 4.2 1.6.1 3.1-.8 4.1-2z" fill="#fff"/><text x="40" y="19" font-family="-apple-system,sans-serif" font-size="10.5" fill="#cfd6e4">Download on the</text><text x="40" y="36" font-family="-apple-system,sans-serif" font-size="17" font-weight="600" fill="#fff">App Store</text></svg>
        <svg class="sb" viewBox="0 0 150 46"><rect width="150" height="46" rx="9" fill="#15243F"/><g transform="translate(12,10)"><path d="M0 0v26l13-13z" fill="#29B6F6"/><path d="M0 0l13 13 4.6-4.6L4 1.4z" fill="#66BB6A"/><path d="M0 26l13-13 4.6 4.6L4 24.6z" fill="#EF5350"/><path d="M17.6 8.4L22 13l-4.4 4.6L13 13z" fill="#FFCA28"/></g><text x="42" y="19" font-family="-apple-system,sans-serif" font-size="10.5" letter-spacing="0.06em" fill="#cfd6e4">GET IT ON</text><text x="42" y="36" font-family="-apple-system,sans-serif" font-size="17" font-weight="600" fill="#fff">Google Play</text></svg>
      </span>
    </div>
  </div>
</body></html>'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="")
    ap.add_argument("--macro-json", default="", help="宏观行手动注入(JSON 数组,行格式 {t,hi,name,est,prev});econ 端点 403 时的兜底")
    args = ap.parse_args()
    if not FINN:
        sys.exit("缺 FINNHUB_KEY")
    date = args.date or datetime.now(ET).strftime("%Y-%m-%d")
    extra = json.loads(Path(args.macro_json).read_text(encoding="utf-8")) if args.macro_json else None
    print(f"① 抓数 + 降噪({date})…")
    macro, ipos, bmo, sb, amc, sa, focus, mega = fetch(date, extra)
    yday = yesterday_close()
    ahead = ahead_events(date, mega)
    print(f"   宏观 {len(macro)} 行 · IPO {len(ipos)} · 盘前 {len(bmo)}+{len(sb)} · 盘后 {len(amc)}+{len(sa)} · 前瞻 {len(ahead)} · Focus: {focus}")
    html = build_html(date, macro, ipos, bmo, sb, amc, sa, focus, yday=yday, ahead=ahead)
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
