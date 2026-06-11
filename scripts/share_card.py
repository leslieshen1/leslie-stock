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
OUT_DIR = Path.home() / "Downloads" / "AInvest卡片"   # 专属文件夹,好找
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

NH = {"user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "accept": "application/json", "origin": "https://www.nasdaq.com", "referer": "https://www.nasdaq.com/"}

IDX = [("QQQ", "Nasdaq 100"), ("IWM", "Russell 2000"), ("SPY", "S&P 500"), ("DIA", "Dow")]
MEGA = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "TSLA", "V", "JPM"]
SEMI = ["AAOI", "AXTI", "MRVL", "SMCI", "NVTS", "ARM", "MU", "ACMR", "TSM", "AMD"]
SPACE = ["ASTS", "LUNR"]
CRYPTO = ["MSTR", "COIN"]


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


def macro_actuals() -> list[dict]:
    """今天已发布的重磅宏观(actual 已出):[{name, act, est}],核心 CPI 排最前。"""
    key = os.environ.get("FINNHUB_KEY") or ""
    if not key:
        return []
    try:
        j = requests.get("https://finnhub.io/api/v1/calendar/economic",
                         params={"token": key}, timeout=25).json()
    except Exception:
        return []
    et = timezone(timedelta(hours=-4))
    today = datetime.now(et).strftime("%Y-%m-%d")
    out = []
    NAMES = [("Core Inflation Rate MoM", "Core CPI"), ("Inflation Rate MoM", "CPI MoM"),
             ("Core PCE", "Core PCE"), ("Non?farm Payrolls", "Payrolls"),
             ("Fed Interest Rate Decision", "FOMC"), ("Retail Sales MoM", "Retail Sales"),
             ("PPI MoM", "PPI")]
    for e in j.get("economicCalendar") or []:
        if e.get("country") not in ("US", "United States") or str(e.get("impact")) != "high":
            continue
        try:
            dt = datetime.strptime(str(e.get("time", "")), "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).astimezone(et)
        except ValueError:
            continue
        if dt.strftime("%Y-%m-%d") != today or e.get("actual") in (None, ""):
            continue
        nm = next((short for pat, short in NAMES if re.search(pat.replace("?", ".?"), str(e.get("event", "")), re.I)), None)
        if not nm:
            continue
        try:
            out.append({"name": nm, "act": float(e["actual"]), "est": float(e["estimate"]) if e.get("estimate") not in (None, "") else None})
        except (TypeError, ValueError):
            continue
    out.sort(key=lambda r: 0 if "Core CPI" == r["name"] else 1)
    return out


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
    # 诚实性:close 卡在盘后/休市生成时,primaryData 是盘后漂移价 —— 指数瓦片必须用当日收盘(secondaryData)
    if card_type == "close" and ("after" in status or "post" in status):
        for r in idx_map.values():
            if r.get("prevPct") is not None:
                r["pct"] = r["prevPct"]
        for rows in (mega, semi):
            for r in rows:
                if r.get("prevPct") is not None:
                    r["pct"] = r["prevPct"]
    # 三主题面板(标杆样式:每板一行 3 只,|pct| 最大优先)
    with ThreadPoolExecutor(max_workers=6) as ex:
        space = [r for r in ex.map(q, SPACE) if r["pct"] is not None]
        crypto = [r for r in ex.map(q, CRYPTO) if r["pct"] is not None]
    def top3(rows):
        return sorted(rows, key=lambda r: -abs(r["pct"] or 0))[:3]
    panels = [
        {"icon": "bolt", "title": "Megacaps", "items": top3(mega)},
        {"icon": "chip", "title": "Semis & optical", "items": top3(semi)},
    ]
    third = max([("rocket", "Space", space), ("bitcoin", "Crypto names", crypto)],
                key=lambda t: max((abs(r["pct"] or 0) for r in t[2]), default=0))
    panels.append({"icon": third[0], "title": third[1], "items": top3(third[2])})
    return {"type": card_type, "date": date_label, "idx": idx_map, "sparks": sparks,
            "released": macro_actuals(), "panels": panels,
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
    # 重磅数据已落地 → 结果导向(如 "Cooler CPI: core 0.2 vs 0.3 est.")
    rel = (ctx.get("released") or [None])[0]
    if rel and rel.get("est") is not None:
        tone = "Cooler" if rel["act"] < rel["est"] else "Hotter" if rel["act"] > rel["est"] else "In-line"
        tail = ("Tape claws back." if qq > -0.7 else "Stocks still soft.") if qq < 0 else \
               ("Tape turns green." if not close else "Stocks close higher.")
        return f"{tone} {rel['name']}: {rel['act']:g} vs {rel['est']:g} est. {tail}"
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


def panel_items_html(items) -> str:
    bits = []
    for r in items:
        if isinstance(r, (list, tuple)):       # 报告 spec:[sym, "+7.52%"]
            sym, ps = r[0], str(r[1])
            c = RED if ps.strip().startswith("-") else GREEN
            bits.append(f'<span class="pi">{logo_chip(sym)}<b>${sym}</b>'
                        f'<span style="color:{c}">{ps}</span></span>')
        else:
            c = GREEN if (r["pct"] or 0) >= 0 else RED
            bits.append(f'<span class="pi">{logo_chip(r["sym"])}<b>${r["sym"]}</b>'
                        f'<span style="color:{c}">{fp(r["pct"])}</span></span>')
    return "".join(bits)


PANEL_ICON = {
    "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 6.5V12l4 2.5"/>',
    "bolt": '<path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/>',
    "chip": '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.5 5.5l2 2M16.5 16.5l2 2M18.5 5.5l-2 2M7.5 16.5l-2 2"/>',
    "rocket": '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 4c3 0 6 3 6 6-4 6-9 9-9 9l-4-4s3-5 7-11zM15 9a1.5 1.5 0 1 0 .01 0"/>',
    "bitcoin": '<circle cx="12" cy="12" r="9.5"/><path d="M9.5 7.5h4a2 2 0 0 1 0 4h-4zm0 4h4.6a2 2 0 0 1 0 4H9.5zM10.5 5.5v2M10.5 16.5v2M13 5.5v2M13 16.5v2"/>',
}


def build_html(ctx: dict) -> str:
    logo_svg = (ASSETS / "logo-ainvest.svg").read_text(encoding="utf-8")
    qqpct = ctx["idx"].get("QQQ", {}).get("pct") or 0
    mood = "bearish" if qqpct < -0.4 else "bullish" if qqpct > 0.4 else "neutral"
    body = ASSETS / f"aime-{mood}.png"
    aime = (body if body.exists() else ASSETS / "aime-head.png").resolve()
    glow = {"bearish": "rgba(220,38,38,0.13)", "bullish": "rgba(22,163,74,0.13)", "neutral": "rgba(22,93,255,0.09)"}[mood]
    title = {"close": "Close", "intraday": "Intraday", "premarket": "Pre-Market"}[ctx["type"]]

    # 指数瓦片(标杆:名称+圈箭头 / 巨号百分比 / 细分时线)
    idx_cards = ""
    for sym, name in IDX:
        r = ctx["idx"].get(sym, {})
        pct = r.get("pct")
        up = (pct or 0) >= 0
        c = GREEN if up else RED
        idx_cards += f"""
      <div class="tile">
        <div class="tile-top"><span>{name}</span>
          <span class="chip" style="background:{'#E7F5ED' if up else '#FCEAEA'};color:{c}">
            <svg viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="{'M7 14l5-6 5 6' if up else 'M7 10l5 6 5-6'}"/></svg></span></div>
        <div class="tile-pct" style="color:{c}">{fp(pct)}</div>
        {spark_svg(ctx["sparks"].get(sym, []), up)}
      </div>"""

    # 三主题面板(一行三只,带 logo)
    panels_html = ""
    for pn in ctx["panels"]:
        icon = PANEL_ICON.get(pn["icon"], PANEL_ICON["bolt"])
        panels_html += f"""
      <div class="panel">
        <div class="p-head"><span class="p-ic"><svg viewBox="0 0 24 24" fill="none" stroke="{BLUE}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">{icon}</svg></span>
          <span class="p-title">{pn["title"]}</span></div>
        <div class="p-items">{panel_items_html(pn["items"])}</div>
      </div>"""

    # 页脚事件条
    TITLE_EN = [("CPI", "CPI"), ("PPI", "PPI"), ("美联储利率决议", "FOMC rate decision"),
                ("零售销售", "Retail Sales"), ("非农", "Nonfarm Payrolls"), ("PCE", "PCE"), ("GDP", "GDP")]
    today_et = datetime.now(timezone(timedelta(hours=-4))).date()
    nxt_html = ""
    if ctx.get("footer_override"):
        for f_ in ctx["footer_override"]:
            dim = ' <span style="color:#64748B">' + f_["dim"] + "</span>" if f_.get("dim") else ""
            nxt_html += ('<span class="nx"><b class="nx-w">' + f_.get("when", "") + "</b> <b>"
                         + f_.get("name", "") + "</b>" + dim + "</span>")
    rel0 = None if ctx.get("footer_override") else (ctx.get("released") or [None])[0]
    if rel0 and rel0.get("est") is not None:
        nxt_html += (f'<span class="nx"><b class="nx-w">Out:</b> <b>{rel0["name"]} {rel0["act"]:g}</b>'
                     f' <span style="color:#64748B">vs {rel0["est"]:g} est</span></span>')
    for e in ([] if ctx.get("footer_override") else ctx["next"][:2]):
        if rel0 and e.get("kind") == "macro" and rel0["name"].split()[0].lower() in e.get("title", "").lower():
            continue  # 已出的不再当"看点"挂着
        try:
            d = datetime.strptime(e["date"], "%Y-%m-%d").date()
            when = "Today" if d == today_et else "Tomorrow" if (d - today_et).days == 1 else d.strftime("%a")
        except Exception:
            when = ""
        t_raw = str(e.get("timeET") or "")
        t = f"{t_raw} ET" if ":" in t_raw else {"盘后": "after the close", "盘前": "pre-market"}.get(t_raw, "")
        title_e = next((en for zh, en in TITLE_EN if zh in e["title"]), e["title"])
        name = f'${e["sym"]}' if e.get("sym") else title_e
        nxt_html += f'<span class="nx"><b class="nx-w">{when} {t}:</b> <b>{name}</b></span>'

    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  html,body {{ width:1600px; height:900px; }}
  body {{ font-family:-apple-system,"SF Pro Display",system-ui,sans-serif; color:#111827; overflow:hidden; position:relative;
         font-variant-numeric:tabular-nums;
         background:
           radial-gradient(820px 460px at -4% -10%, rgba(22,93,255,0.06), transparent 60%),
           radial-gradient(760px 520px at 104% 110%, {glow.replace("0.13", "0.08")}, transparent 58%),
           linear-gradient(165deg,#FAFBFD 0%,#F2F5F9 100%); }}
  .logo {{ position:absolute; top:56px; left:64px; width:200px; }}
  .logo svg {{ width:100%; height:auto; }}
  h1 {{ position:absolute; top:108px; left:62px; font-size:104px; font-weight:800; letter-spacing:-0.025em; color:#0E1525; }}
  .rule {{ position:absolute; top:238px; left:66px; width:104px; height:8px; background:{BLUE}; border-radius:4px; }}
  .head {{ position:absolute; top:268px; left:64px; font-size:35px; font-weight:600; color:#3B4456; }}
  .grid {{ position:absolute; top:346px; left:64px; display:flex; gap:18px; }}
  .tile {{ width:248px; padding:18px 20px 10px; background:linear-gradient(180deg,#FFFFFF,#FBFCFE);
           border-radius:22px; border:1px solid rgba(15,23,42,0.05);
           box-shadow:0 1px 0 rgba(255,255,255,.95) inset, 0 2px 3px rgba(15,23,42,.04), 0 18px 38px rgba(15,23,42,.08); }}
  .tile-top {{ display:flex; align-items:center; justify-content:space-between; font-size:19px; font-weight:600; color:#3B4456; }}
  .chip {{ width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; }}
  .chip svg {{ width:19px; height:19px; }}
  .tile-pct {{ margin-top:7px; font-size:46px; font-weight:800; letter-spacing:-0.02em; }}
  .spark {{ width:100%; height:42px; display:block; margin-top:4px; }}
  .panels {{ position:absolute; top:548px; left:64px; display:flex; gap:18px; }}
  .panel {{ width:330px; padding:18px 22px; background:linear-gradient(180deg,#FFFFFF,#FBFCFE);
            border-radius:22px; border:1px solid rgba(15,23,42,0.05);
            box-shadow:0 1px 0 rgba(255,255,255,.95) inset, 0 2px 3px rgba(15,23,42,.04), 0 18px 38px rgba(15,23,42,.08); }}
  .p-head {{ display:flex; align-items:center; gap:11px; min-width:0; }}
  .p-ic {{ width:34px; height:34px; border-radius:10px; background:{BLUE}12; display:flex; align-items:center; justify-content:center; flex:none; }}
  .p-ic svg {{ width:19px; height:19px; }}
  /* 标题永远单行:折行会把第三行内容挤进 footer(6/10 踩过)。溢出截断,spec 里标题保持 ≤20 字符 */
  .p-title {{ font-size:20px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0; }}
  .p-items {{ margin-top:12px; display:flex; flex-direction:column; gap:7px; }}
  .pi {{ display:flex; align-items:center; gap:9px; font-size:19px; }}
  .pi b {{ font-weight:700; }}
  .pi span[style] {{ margin-left:auto; font-weight:800; }}
  .lg {{ width:26px; height:26px; border-radius:50%; overflow:hidden; background:#fff; border:1px solid #E8EDF4;
         display:inline-flex; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(15,23,42,0.08); flex:none; }}
  .lg img {{ width:100%; height:100%; object-fit:cover; }}
  .lt {{ font-size:12px; font-weight:800; color:{BLUE}; background:{BLUE}10; }}
  .next {{ position:absolute; left:64px; bottom:48px; width:1040px; padding:18px 26px;
           background:linear-gradient(180deg,#FFFFFF,#FBFCFE); border-radius:20px; border:1px solid rgba(15,23,42,0.05);
           box-shadow:0 2px 3px rgba(15,23,42,.04), 0 18px 38px rgba(15,23,42,.08);
           display:flex; align-items:center; gap:22px; }}
  .next .ni {{ width:40px; height:40px; border-radius:50%; background:{BLUE}12; display:flex; align-items:center; justify-content:center; flex:none; }}
  .next .ni svg {{ width:21px; height:21px; }}
  .next .lab {{ font-size:22px; font-weight:800; white-space:nowrap; }}
  /* footer 永不折行:dim 文案过长曾把条目挤成 3-4 行、向上堆进面板区(6/11 踩过)。
     单行 + 溢出裁切;内容纪律:spec 的 footer dim ≤ ~30 字符 */
  .nx {{ font-size:20px; color:#3B4456; line-height:1.3; white-space:nowrap; }}
  .next {{ flex-wrap:nowrap; overflow:hidden; }}
  .nx + .nx {{ border-left:1px solid #E8EDF4; padding-left:22px; margin-left:2px; }}
  .nx-w {{ color:{BLUE}; }}
  .aime-glow {{ position:absolute; right:8px; bottom:64px; width:520px; height:520px; border-radius:50%;
                background:radial-gradient(closest-side,{glow},transparent); }}
  .ring {{ position:absolute; right:78px; bottom:108px; width:380px; height:58px; border-radius:50%;
           background:radial-gradient(closest-side, rgba(15,23,42,0.10), transparent 70%); }}
  .aime {{ position:absolute; right:54px; bottom:118px; width:412px; }}
  .ft {{ position:absolute; bottom:20px; left:0; width:100%; text-align:center; font-size:14px; color:#9AA3B2; }}
</style></head><body>
  <div class="logo">{logo_svg}</div>
  <h1>{title} &middot; {ctx["date"]} &middot; ET</h1>
  <div class="rule"></div>
  <div class="head">{ctx["headline"]}</div>
  <div class="grid">{idx_cards}</div>
  <div class="panels">{panels_html}</div>
  <div class="next"><span class="ni"><svg viewBox="0 0 24 24" fill="none" stroke="{BLUE}" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 6.5V12l4 2.5"/></svg></span><span class="lab">Next 24 hours:</span>{nxt_html}</div>
  <div class="aime-glow"></div><div class="ring"></div>
  <img class="aime" src="file://{aime}"/>
  <div class="ft">All times Eastern Time (ET) &middot; Data: Nasdaq &middot; AInvest</div>
</body></html>"""


# ---------- ④ 出图 ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", default="close", choices=["close", "intraday", "premarket"])
    ap.add_argument("--spec", default="", help="报告派生 spec(JSON):headline/panels/footer 覆盖机械模式 —— 图随报告")
    args = ap.parse_args()

    print("① 抓实时数据(Nasdaq)…")
    ctx = gather(args.type)
    print(f"   {ctx['date']} · " + " ".join(f"{s}{fp(ctx['idx'].get(s,{}).get('pct'))}" for s, _ in IDX)
          + f" · 走势线 {sum(1 for v in ctx['sparks'].values() if len(v) >= 8)}/4")

    spec = {}
    if args.spec:
        raw = Path(args.spec).read_text(encoding="utf-8") if Path(args.spec).exists() else args.spec
        spec = json.loads(raw)
    if spec.get("headline"):
        ctx["headline"] = spec["headline"]
        print(f"   headline[报告]: {ctx['headline']}")
    else:
        hl = relay_headline(ctx)
        ctx["headline"] = hl or rule_headline(ctx)
        print(f"   headline[{'AI' if hl else '规则'}]: {ctx['headline']}")
    if spec.get("panels"):
        ctx["panels"] = spec["panels"]      # [{icon,title,items:[[sym,"+7.52%"],...]}]
    if spec.get("footer"):
        ctx["footer_override"] = spec["footer"]  # [{"when","name","dim"}]

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
