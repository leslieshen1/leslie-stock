"""AInvest 分享卡片自动产出 —— 实时数据 → 品牌 HTML 模板 → headless Chrome → PNG。

架构(数字绝不交给图像模型):
  ① 数据层  Nasdaq 实时(指数 ETF + 当日分时走势线 + megacaps/semis,含上一交易日 pct 注脚)
            + market-calendar.json(Next 24h:CPI/财报)
  ② 文案层  relay(NDT)写 headline;上游不可用 → 规则降级(探活自动切换)
  ③ 版式层  AInvest 品牌(蓝 #165DFF/白卡/SF Pro)+ 官方 Aime 姿态(按行情换装)
            + 股票真 logo(官方 SVG → parqet CDN 缓存 → 字母圆标兜底)
  ④ 出图    headless Chrome @2x → ~/Downloads/AInvest_{type}_{date}.png

用法:
  uv run python scripts/share_card.py                  # close 卡(最近一个收盘)
  uv run python scripts/share_card.py --type intraday  # 盘中卡(盘口不符自动降级 close)
"""
from __future__ import annotations
import argparse
import json
import os
import re
import subprocess
import sys
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
ASSETS = ROOT / "assets" / "brand-ainvest"
LOGO_SKILL = Path.home() / ".claude" / "skills" / "ainvest-design" / "assets" / "stock-logos"
LOGO_CACHE = ASSETS / "stock-logos"   # parqet 下载缓存(入库,跑一次永久复用)
OUT_DIR = Path.home() / "Downloads"   # 直接落下载文件夹,拿了就发
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

NH = {"user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "accept": "application/json", "origin": "https://www.nasdaq.com", "referer": "https://www.nasdaq.com/"}

IDX = [("QQQ", "Nasdaq 100"), ("SPY", "S&P 500"), ("DIA", "Dow"), ("IWM", "Russell 2000")]
MEGA = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "TSLA", "V", "JPM"]
SEMI = ["AAOI", "AXTI", "MRVL", "SMCI", "NVTS", "ARM", "MU", "ACMR", "TSM", "AMD"]


# ---------- ① 数据 ----------
def q(sym: str, ac: str = "stocks"):
    try:
        d = requests.get(f"https://api.nasdaq.com/api/quote/{sym}/info?assetclass={ac}",
                         headers=NH, timeout=12).json().get("data", {})
        p, s = d.get("primaryData", {}) or {}, d.get("secondaryData", {}) or {}
        def num(x):
            try:
                return float(str(x).replace("%", "").replace("+", "").replace(",", "").replace("$", ""))
            except (ValueError, TypeError):
                return None
        return {"sym": sym, "pct": num(p.get("percentageChange")), "prevPct": num(s.get("percentageChange")),
                "ts": p.get("lastTradeTimestamp") or "", "status": d.get("marketStatus")}
    except Exception:
        return {"sym": sym, "pct": None, "prevPct": None, "ts": "", "status": None}


def chart_points(sym: str) -> list[float]:
    """当日分时收盘线(正常时段 9:30-16:00),降采样 ~80 点。给指数卡画真走势。"""
    try:
        d = requests.get(f"https://api.nasdaq.com/api/quote/{sym}/chart?assetclass=etf",
                         headers=NH, timeout=12).json().get("data") or {}
        rows = d.get("chart") or []
        def in_session(z):
            t = (z or {}).get("dateTime", "")
            m = re.match(r"(\d{1,2}):(\d{2}) (AM|PM)", t)
            if not m:
                return False
            hh, mm, ap = int(m.group(1)), int(m.group(2)), m.group(3)
            mins = (hh % 12) * 60 + mm + (720 if ap == "PM" else 0)
            return 570 <= mins <= 960  # 9:30–16:00
        ys = [r["y"] for r in rows if r.get("y") is not None and in_session(r.get("z"))]
        if len(ys) < 10:
            ys = [r["y"] for r in rows if r.get("y") is not None]  # 盘前时段:有什么画什么
        if len(ys) > 80:
            step = len(ys) / 80
            ys = [ys[int(i * step)] for i in range(80)]
        return ys
    except Exception:
        return []


def gather(card_type: str) -> dict:
    with ThreadPoolExecutor(max_workers=10) as ex:
        idx = list(ex.map(lambda s: q(s, "etf"), [s for s, _ in IDX]))
        sparks = dict(zip([s for s, _ in IDX], ex.map(chart_points, [s for s, _ in IDX])))
        mega = [r for r in ex.map(q, MEGA) if r["pct"] is not None]
        semi = [r for r in ex.map(q, SEMI) if r["pct"] is not None]
    idx_map = {r["sym"]: r for r in idx}
    ts = idx_map.get("SPY", {}).get("ts", "")
    m = re.search(r"([A-Z][a-z]{2}) (\d{1,2})", ts)
    date_label = f"{m.group(1)} {m.group(2)}" if m else datetime.now(timezone(timedelta(hours=-4))).strftime("%b %-d")

    mega.sort(key=lambda r: r["pct"])
    semi.sort(key=lambda r: r["pct"])
    nxt = []
    try:
        evs = json.loads((PUB / "market-calendar.json").read_text(encoding="utf-8"))["events"]
        nxt = [e for e in evs if e.get("hi")][:2]
    except Exception:
        pass
    # 诚实性:盘口状态和卡片类型必须匹配 —— 不在该时段就自动降级 close,绝不冒充
    status = (idx_map.get("SPY", {}).get("status") or "").lower()
    if card_type == "premarket" and "pre" not in status:
        print(f"   ⚠ 盘口={status or 'closed'},非盘前 → 降级为 close 卡(数据=最近收盘)")
        card_type = "close"
    elif card_type == "intraday" and "open" not in status:
        print(f"   ⚠ 盘口={status or 'closed'},非盘中 → 降级为 close 卡")
        card_type = "close"
    if card_type in ("premarket", "intraday"):
        date_label = datetime.now(timezone(timedelta(hours=-4))).strftime("%b %-d")
    return {"type": card_type, "date": date_label, "idx": idx_map, "sparks": sparks,
            "megaDown": mega[:3], "megaUp": mega[-3:][::-1],
            "semiDown": semi[:4], "semiUp": semi[-3:][::-1], "next": nxt}


# ---------- ② 文案(relay 探活,降级规则) ----------
def relay_headline(ctx: dict) -> str | None:
    key, base = os.environ.get("NDT_API_KEY"), os.environ.get("NDT_BASE_URL", "https://api.nadoutong.org")
    if not key:
        return None
    try:
        compact = {"idx": {s: r["pct"] for s, r in ctx["idx"].items()},
                   "down": [{x["sym"]: x["pct"]} for x in ctx["megaDown"] + ctx["semiDown"]]}
        r = requests.post(f"{base}/v1/chat/completions", headers={"Authorization": f"Bearer {key}"},
                          json={"model": "gpt-5.4-mini", "max_tokens": 60,
                                "messages": [{"role": "user", "content":
                                              "One-line English market headline (<=10 words, no emoji): " + json.dumps(compact)}]},
                          timeout=30).json()
        if r.get("error"):
            return None
        return r["choices"][0]["message"]["content"].strip().strip('"')
    except Exception:
        return None


def rule_headline(ctx: dict) -> str:
    g = lambda s: ctx["idx"].get(s, {}).get("pct") or 0
    qq, sp, dw, ru = g("QQQ"), g("SPY"), g("DIA"), g("IWM")
    close = ctx.get("type") == "close"   # 文案分时段:收盘说 close,盘前/盘中说 tape
    if qq < -0.5 and dw > 0 and ru > 0:
        return "Nasdaq falls alone. Value and small caps close green." if close else "Nasdaq falls alone. Value and small caps hold green."
    if qq < 0 and sp < 0 and dw < 0 and ru < 0:
        return "Risk-off across the board."
    if qq > 0 and sp > 0 and dw > 0 and ru > 0:
        return "Green across the board. Tech leads." if qq >= ru else "Broad rally, small caps lead."
    if qq > 0.5 and dw < 0:
        return "Tech leads while value lags."
    return "A mixed close under the surface." if close else "A split tape under the surface."


# ---------- ③ 版式 ----------
GREEN, RED, BLUE = "#16A34A", "#DC2626", "#165DFF"
INK, MUT, FNT = "#0F172A", "#64748B", "#94A3B8"


def fp(v: float | None) -> str:
    if v is None:
        return "—"
    return f"{'+' if v >= 0 else '-'}{abs(v):.2f}%"


def logo_uri(sym: str) -> str | None:
    """官方 SVG(design skill)→ parqet 缓存 → None(调用方画字母圆标)。"""
    p = LOGO_SKILL / f"{sym}.svg"
    if p.exists():
        return f"file://{p}"
    LOGO_CACHE.mkdir(parents=True, exist_ok=True)
    c = LOGO_CACHE / f"{sym}.png"
    if not c.exists():
        try:
            r = requests.get(f"https://assets.parqet.com/logos/symbol/{sym}?format=png&size=64", timeout=10)
            if r.status_code == 200 and len(r.content) > 200:
                c.write_bytes(r.content)
        except Exception:
            pass
    return f"file://{c}" if c.exists() else None


def logo_chip(sym: str) -> str:
    u = logo_uri(sym)
    if u:
        return f'<span class="lg"><img src="{u}"/></span>'
    return f'<span class="lg lt">{sym[0]}</span>'


def row(r: dict, note: str = "") -> str:
    c = GREEN if (r["pct"] or 0) >= 0 else RED
    note_html = f'<div class="note">{note}</div>' if note else ""
    return (f'<div class="r"><span class="rl">{logo_chip(r["sym"])}'
            f'<span class="sym">{r["sym"]}</span></span>'
            f'<span class="pct" style="color:{c}">{fp(r["pct"])}</span>{note_html}</div>')


def note_for(r: dict) -> str:
    pv = r.get("prevPct")
    if pv is None or abs(pv) < 5:
        return ""
    held = "holding" if (r["pct"] or 0) > -3 else "after"
    return f"{held} prev session {fp(pv)}"


def spark_svg(ys: list[float], up: bool) -> str:
    if len(ys) < 8:
        return ""
    lo, hi = min(ys), max(ys)
    rng = (hi - lo) or 1
    W, H = 200, 44
    pts = [f"{i * W / (len(ys) - 1):.1f},{H - 4 - (y - lo) / rng * (H - 8):.1f}" for i, y in enumerate(ys)]
    color = GREEN if up else RED
    area = f"M0,{H} L" + " L".join(pts) + f" L{W},{H} Z"
    return (f'<svg class="spark" viewBox="0 0 {W} {H}" preserveAspectRatio="none">'
            f'<path d="{area}" fill="{color}" opacity="0.08"/>'
            f'<polyline points="{" ".join(pts)}" fill="none" stroke="{color}" stroke-width="2.4" '
            f'stroke-linejoin="round" stroke-linecap="round"/></svg>')


def build_html(ctx: dict) -> str:
    logo_svg = (ASSETS / "logo-ainvest.svg").read_text(encoding="utf-8")
    qqpct = ctx["idx"].get("QQQ", {}).get("pct") or 0
    mood = "bearish" if qqpct < -0.4 else "bullish" if qqpct > 0.4 else "neutral"
    body = ASSETS / f"aime-{mood}.png"
    aime = (body if body.exists() else ASSETS / "aime-head.png").resolve()
    mood_glow = {"bearish": "rgba(220,38,38,0.15)", "bullish": "rgba(22,163,74,0.15)", "neutral": "rgba(22,93,255,0.10)"}[mood]
    title = {"close": "Close", "intraday": "Intraday", "premarket": "Premarket"}[ctx["type"]]

    idx_cards = ""
    for s, name in IDX:
        r = ctx["idx"].get(s, {})
        pct = r.get("pct")
        up = (pct or 0) >= 0
        idx_cards += f'''
      <div class="card idx">
        <div class="idx-top">{logo_chip(s)}<span class="idx-name">{name}</span>
          <span class="chip" style="background:{'#E8F6EE' if up else '#FDEDEE'};color:{GREEN if up else RED}">{'↑' if up else '↓'}</span></div>
        <div class="idx-pct" style="color:{GREEN if up else RED}">{fp(pct)}</div>
        {spark_svg(ctx["sparks"].get(s, []), up)}
      </div>'''

    mega_rows = "".join(row(r, note_for(r) if i == 0 else "") for i, r in enumerate(ctx["megaDown"]))
    mega_rows2 = "".join(row(r) for r in ctx["megaUp"])
    semi_rows = "".join(row(r, note_for(r) if i == 0 else "") for i, r in enumerate(ctx["semiDown"]))
    semi_rows2 = "".join(row(r, note_for(r) if i == 0 else "") for i, r in enumerate(ctx["semiUp"]))

    TITLE_EN = [("CPI", "CPI"), ("PPI", "PPI"), ("美联储利率决议", "FOMC rate decision"),
                ("零售销售", "Retail Sales"), ("非农", "Nonfarm Payrolls"), ("PCE", "PCE"), ("GDP", "GDP")]
    today_et = datetime.now(timezone(timedelta(hours=-4))).date()
    ICON = {"macro": ("#7C5CFC", "M4 7h16M4 12h16M4 17h10"), "earnings": ("#165DFF", "M5 17V9m5 8V5m5 12v-6m5 6V8")}
    nxt_html = ""
    for e in ctx["next"]:
        try:
            d = datetime.strptime(e["date"], "%Y-%m-%d").date()
            when = "Today" if d == today_et else "Tomorrow" if (d - today_et).days == 1 else d.strftime("%a")
        except Exception:
            when = ""
        t_raw = str(e.get("timeET") or "")
        t = f"{t_raw} ET" if ":" in t_raw else {"盘后": "after the close", "盘前": "pre-market"}.get(t_raw, "")
        title_e = next((en for zh, en in TITLE_EN if zh in e["title"]), e["title"])
        detail = (e.get("detail") or "").replace("预期", "consensus").replace("前值", "prior")
        name = f'${e["sym"]}' if e.get("sym") else title_e
        color, path = ICON[e["kind"]] if e["kind"] in ICON else ICON["macro"]
        nxt_html += (f'<div class="nx"><span class="nxi" style="background:{color}1A">'
                     f'<svg viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="2.2" stroke-linecap="round"><path d="{path}"/></svg></span>'
                     f'<span><span class="nx-t">{when} {t}:</span> <b>{name}</b><br/><span class="nx-d">{detail}</span></span></div>')

    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  html,body {{ width:1600px; height:900px; }}
  body {{ font-family:-apple-system,"SF Pro Display","SF Pro Text",system-ui,sans-serif; color:{INK}; overflow:hidden; position:relative;
         background:
           radial-gradient(900px 520px at -6% -12%, rgba(22,93,255,0.07), transparent 62%),
           radial-gradient(820px 560px at 106% 112%, {mood_glow.replace("0.15", "0.10")}, transparent 60%),
           radial-gradient(rgba(15,23,42,0.045) 1px, transparent 1px) 0 0/26px 26px,
           linear-gradient(165deg,#FBFCFE 0%,#F2F5FA 100%); }}
  .logo {{ position:absolute; top:50px; left:64px; width:188px; }}
  .logo svg {{ width:100%; height:auto; }}
  h1 {{ position:absolute; top:94px; left:64px; font-size:90px; font-weight:800; letter-spacing:-0.02em; }}
  .rule {{ position:absolute; top:204px; left:66px; width:96px; height:7px; background:{BLUE}; border-radius:4px; }}
  .head {{ position:absolute; top:233px; left:64px; font-size:32px; font-weight:600; color:#334155; }}
  .card {{ background:linear-gradient(180deg,#FFFFFF 0%,#FBFCFE 100%); border:1px solid #E6EBF2; border-radius:18px;
           box-shadow:0 1px 0 rgba(255,255,255,0.9) inset, 0 1px 2px rgba(15,23,42,0.05), 0 16px 40px rgba(15,23,42,0.07); }}
  .grid {{ position:absolute; top:306px; left:64px; display:flex; gap:20px; }}
  .idx {{ width:258px; padding:18px 20px 14px; }}
  .idx-top {{ display:flex; align-items:center; gap:9px; font-size:19px; font-weight:600; color:#334155; }}
  .idx-name {{ flex:1; }}
  .chip {{ width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:16px; font-weight:800; }}
  .idx-pct {{ margin:8px 0 6px; font-size:42px; font-weight:800; letter-spacing:-0.01em; font-variant-numeric:tabular-nums; }}
  .spark {{ width:100%; height:40px; display:block; }}
  .panels {{ position:absolute; top:496px; left:64px; display:flex; gap:20px; }}
  .panel {{ width:530px; padding:20px 24px; }}
  .p-title {{ font-size:21px; font-weight:700; margin-bottom:12px; display:flex; align-items:center; gap:10px; }}
  .p-title .dot {{ width:28px; height:28px; border-radius:9px; background:{BLUE}14; display:inline-flex; align-items:center; justify-content:center; }}
  .p-title .dot svg {{ width:16px; height:16px; }}
  .cols {{ display:flex; gap:26px; }}
  .col {{ flex:1; min-width:0; }}
  .col + .col {{ border-left:1px solid #EEF2F7; padding-left:26px; }}
  .r {{ display:flex; align-items:center; justify-content:space-between; padding:6.5px 0; font-size:22px; flex-wrap:wrap; }}
  .rl {{ display:flex; align-items:center; gap:10px; }}
  .lg {{ width:30px; height:30px; border-radius:50%; overflow:hidden; background:#fff; border:1px solid #E6EBF2;
         display:inline-flex; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(15,23,42,0.08); }}
  .lg img {{ width:100%; height:100%; object-fit:cover; }}
  .lt {{ font-size:14px; font-weight:800; color:{BLUE}; background:{BLUE}10; }}
  .sym {{ font-weight:700; }}
  .pct {{ font-weight:800; font-variant-numeric:tabular-nums; }}
  .note {{ width:100%; font-size:14px; color:{MUT}; margin:-2px 0 0 40px; }}
  .next {{ position:absolute; left:64px; bottom:60px; width:1080px; padding:18px 24px; display:flex; align-items:center; gap:24px; }}
  .next .lab {{ font-size:21px; font-weight:800; white-space:nowrap; }}
  .nx {{ font-size:18px; color:#334155; display:flex; align-items:center; gap:12px; }}
  .nx + .nx {{ border-left:1px solid #EEF2F7; padding-left:24px; }}
  .nxi {{ width:38px; height:38px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; flex:none; }}
  .nxi svg {{ width:20px; height:20px; }}
  .nx-t {{ font-weight:700; color:{BLUE}; }}
  .nx-d {{ color:{MUT}; font-size:15px; }}
  .aime {{ position:absolute; right:14px; bottom:104px; width:475px; filter:drop-shadow(0 30px 60px {mood_glow}); }}
  .aime-glow {{ position:absolute; right:0; bottom:70px; width:520px; height:520px; border-radius:50%;
                background:radial-gradient(closest-side,{mood_glow},transparent); }}
  .ft {{ position:absolute; bottom:22px; left:0; width:100%; text-align:center; font-size:14px; color:{FNT}; }}
</style></head><body>
  <div class="logo">{logo_svg}</div>
  <h1>{title} · {ctx["date"]}</h1>
  <div class="rule"></div>
  <div class="head">{ctx["headline"]}</div>
  <div class="grid">{idx_cards}</div>
  <div class="panels">
    <div class="card panel">
      <div class="p-title"><span class="dot"><svg viewBox="0 0 24 24" fill="none" stroke="{BLUE}" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.5 4"/></svg></span>The split inside megacaps</div>
      <div class="cols"><div class="col">{mega_rows}</div><div class="col">{mega_rows2}</div></div>
    </div>
    <div class="card panel">
      <div class="p-title"><span class="dot"><svg viewBox="0 0 24 24" fill="none" stroke="{BLUE}" stroke-width="2.2" stroke-linecap="round"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.5 5.5l2 2M16.5 16.5l2 2M18.5 5.5l-2 2M7.5 16.5l-2 2"/></svg></span>The split inside semis</div>
      <div class="cols"><div class="col">{semi_rows}</div><div class="col">{semi_rows2}</div></div>
    </div>
  </div>
  <div class="card next"><span class="lab">Next 24 hours:</span>{nxt_html}</div>
  <div class="aime-glow"></div>
  <img class="aime" src="file://{aime}" />
  <div class="ft">All times Eastern Time (ET) · Data: Nasdaq · AInvest</div>
</body></html>'''


# ---------- ④ 出图 ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="close", choices=["close", "intraday", "premarket"])
    args = ap.parse_args()

    print("① 抓实时数据(Nasdaq)…")
    ctx = gather(args.type)
    print(f"   {ctx['date']} · " + " ".join(f"{s}{fp(ctx['idx'].get(s,{}).get('pct'))}" for s, _ in IDX)
          + f" · 走势线 {sum(1 for v in ctx['sparks'].values() if len(v) >= 8)}/4")

    print("② 文案(relay 探活 → 失败走规则)…")
    hl = relay_headline(ctx)
    ctx["headline"] = hl or rule_headline(ctx)
    print(f"   headline[{'AI' if hl else '规则'}]: {ctx['headline']}")

    print("③ 渲染版式(logo 链:官方 SVG → parqet → 字母)→ ④ Chrome 出图…")
    html = build_html(ctx)
    tmp = Path("/tmp/share_card.html")
    tmp.write_text(html, encoding="utf-8")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    et = datetime.now(timezone(timedelta(hours=-4)))
    out = OUT_DIR / f"AInvest_{ctx['type']}_{et.strftime('%Y%m%d')}.png"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--window-size=1600,900", "--force-device-scale-factor=2",
                    f"--screenshot={out}", f"file://{tmp}"],
                   capture_output=True, timeout=60)
    print(f"✅ {out}  ({out.stat().st_size//1024} KB)")
    return str(out)


if __name__ == "__main__":
    main()
