"""AInvest 分享卡片自动产出 —— 实时数据 → 品牌 HTML 模板 → headless Chrome → PNG。

架构(数字绝不交给图像模型):
  ① 数据层  Nasdaq 实时(指数 ETF + megacaps + semis,含上一交易日 pct 做注脚)
            + market-calendar.json(Next 24h:CPI/财报)
  ② 文案层  relay(NDT,OpenAI 兼容)写 headline;上游不可用 → 规则降级(探活自动切换)
  ③ 版式层  HTML/CSS(AInvest 品牌:蓝 #165DFF、白卡、SF Pro)+ 官方 Aime 素材
  ④ 出图    headless Chrome --screenshot @2x → deliverables/cards/*.png

用法:
  uv run python scripts/share_card.py                  # close 卡(最近一个收盘)
  uv run python scripts/share_card.py --type intraday  # 盘中卡
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


def gather(card_type: str) -> dict:
    with ThreadPoolExecutor(max_workers=10) as ex:
        idx = list(ex.map(lambda s: q(s, "etf"), [s for s, _ in IDX]))
        mega = [r for r in ex.map(q, MEGA) if r["pct"] is not None]
        semi = [r for r in ex.map(q, SEMI) if r["pct"] is not None]
    idx_map = {r["sym"]: r for r in idx}
    # 卡片日期:从报价时间戳里拿(收盘后 = 最近交易日)
    ts = idx_map.get("SPY", {}).get("ts", "")
    m = re.search(r"([A-Z][a-z]{2}) (\d{1,2})", ts)
    date_label = f"{m.group(1)} {m.group(2)}" if m else datetime.now(timezone(timedelta(hours=-4))).strftime("%b %-d")

    mega.sort(key=lambda r: r["pct"])
    semi.sort(key=lambda r: r["pct"])
    # Next 24h:市场日历里最近的重磅(宏观优先 + 财报)
    nxt = []
    try:
        evs = json.loads((PUB / "market-calendar.json").read_text(encoding="utf-8"))["events"]
        for e in evs:
            if not e.get("hi"):
                continue
            nxt.append(e)
            if len(nxt) >= 2:
                break
    except Exception:
        pass
    # 诚实性:盘口状态和卡片类型必须匹配 —— 请求盘前/盘中但市场没在那个时段,自动降级成收盘卡
    status = (idx_map.get("SPY", {}).get("status") or "").lower()
    if card_type == "premarket" and "pre" not in status:
        print(f"   ⚠ 盘口={status or 'closed'},非盘前 → 降级为 close 卡(数据=最近收盘)")
        card_type = "close"
    elif card_type == "intraday" and "open" not in status:
        print(f"   ⚠ 盘口={status or 'closed'},非盘中 → 降级为 close 卡")
        card_type = "close"
    if card_type in ("premarket", "intraday"):
        date_label = datetime.now(timezone(timedelta(hours=-4))).strftime("%b %-d")
    return {"type": card_type, "date": date_label, "idx": idx_map,
            "megaDown": mega[:3], "megaUp": mega[-3:][::-1],
            "semiDown": semi[:4], "semiUp": semi[-3:][::-1], "next": nxt}


# ---------- ② 文案(relay 探活,降级规则) ----------
def relay_headline(ctx: dict) -> str | None:
    key, base = os.environ.get("NDT_API_KEY"), os.environ.get("NDT_BASE_URL", "https://api.nadoutong.org")
    if not key:
        return None
    try:
        compact = {k: ([{x["sym"]: x["pct"]} for x in v] if isinstance(v, list) else
                       ({s: r["pct"] for s, r in v.items()} if k == "idx" else v))
                   for k, v in ctx.items() if k in ("idx", "megaDown", "semiDown")}
        r = requests.post(f"{base}/v1/chat/completions",
                          headers={"Authorization": f"Bearer {key}"},
                          json={"model": "gpt-5.4-mini", "max_tokens": 60,
                                "messages": [{"role": "user", "content":
                                              "One-line English market headline (<=10 words, no emoji) for this close: "
                                              + json.dumps(compact)}]},
                          timeout=30).json()
        if r.get("error"):
            return None
        return r["choices"][0]["message"]["content"].strip().strip('"')
    except Exception:
        return None


def rule_headline(ctx: dict) -> str:
    g = lambda s: ctx["idx"].get(s, {}).get("pct") or 0
    qq, sp, dw, ru = g("QQQ"), g("SPY"), g("DIA"), g("IWM")
    if qq < -0.5 and dw > 0 and ru > 0:
        return "Nasdaq falls alone. Value and small caps close green."
    if qq < 0 and sp < 0 and dw < 0 and ru < 0:
        return "Risk-off across the board."
    if qq > 0 and sp > 0 and dw > 0 and ru > 0:
        return "Green across the board. Tech leads." if qq >= ru else "Broad rally, small caps lead."
    if qq > 0.5 and dw < 0:
        return "Tech leads while value lags."
    return "A mixed close under the surface."


# ---------- ③ 版式 ----------
GREEN, RED, BLUE = "#16A34A", "#DC2626", "#165DFF"


def fp(v: float | None) -> str:
    if v is None:
        return "—"
    return f"{'+' if v >= 0 else '−'}{abs(v):.2f}%".replace("−", "-")


def row(r: dict, note: str = "") -> str:
    c = GREEN if (r["pct"] or 0) >= 0 else RED
    note_html = f'<div class="note">{note}</div>' if note else ""
    return f'''<div class="r"><span class="sym">${r["sym"]}</span><span class="pct" style="color:{c}">{fp(r["pct"])}</span>{note_html}</div>'''


def note_for(r: dict) -> str:
    pv = r.get("prevPct")
    if pv is None or abs(pv) < 5:
        return ""
    held = "holding" if (r["pct"] or 0) > -3 else "after"
    return f"{held} prev session {fp(pv)}"


def build_html(ctx: dict) -> str:
    logo_svg = (ASSETS / "logo-ainvest.svg").read_text(encoding="utf-8")
    qqpct = ctx["idx"].get("QQQ", {}).get("pct") or 0
    mood = "bearish" if qqpct < -0.4 else "bullish" if qqpct > 0.4 else "neutral"
    # 全身姿态库(gen_mascots.py 生成)优先;没有则退回官方头部素材
    body = ASSETS / f"aime-{mood}.png"
    aime = (body if body.exists() else ASSETS / "aime-head.png").resolve()
    full_body = body.exists()
    mood_glow = {"bearish": "rgba(220,38,38,0.16)", "bullish": "rgba(22,163,74,0.16)", "neutral": "rgba(22,93,255,0.10)"}[mood]
    tilt = "0deg" if full_body else {"bearish": "-5deg", "bullish": "3deg", "neutral": "0deg"}[mood]
    title = {"close": "Close", "intraday": "Intraday", "premarket": "Premarket"}[ctx["type"]]

    idx_cards = ""
    for s, name in IDX:
        r = ctx["idx"].get(s, {})
        pct = r.get("pct")
        up = (pct or 0) >= 0
        idx_cards += f'''
      <div class="card idx">
        <div class="idx-top"><span>{name}</span><span class="chip" style="background:{'#EAF7EF' if up else '#FDECEC'};color:{GREEN if up else RED}">{'↑' if up else '↓'}</span></div>
        <div class="idx-pct" style="color:{GREEN if up else RED}">{fp(pct)}</div>
      </div>'''

    mega_rows = "".join(row(r, note_for(r) if i == 0 else "") for i, r in enumerate(ctx["megaDown"]))
    mega_rows2 = "".join(row(r) for r in ctx["megaUp"])
    semi_rows = "".join(row(r, note_for(r) if i == 0 else "") for i, r in enumerate(ctx["semiDown"]))
    semi_rows2 = "".join(row(r, note_for(r) if i == 0 else "") for i, r in enumerate(ctx["semiUp"]))

    TITLE_EN = [("CPI", "CPI"), ("PPI", "PPI"), ("美联储利率决议", "FOMC rate decision"),
                ("零售销售", "Retail Sales"), ("非农", "Nonfarm Payrolls"), ("PCE", "PCE"), ("GDP", "GDP")]
    today_et = datetime.now(timezone(timedelta(hours=-4))).date()
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
        nxt_html += f'''<div class="nx"><span class="nx-t">{when} {t}:</span> <b>{name}</b> <span class="nx-d">{detail}</span></div>'''

    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  html,body {{ width:1600px; height:900px; }}
  body {{ font-family:-apple-system,"SF Pro Display","SF Pro Text",system-ui,sans-serif;
         background:linear-gradient(160deg,#FAFBFE 0%,#F1F4F9 100%); color:#0F172A; overflow:hidden; position:relative; }}
  .logo {{ position:absolute; top:52px; left:64px; width:190px; }}
  .logo svg {{ width:100%; height:auto; }}
  h1 {{ position:absolute; top:96px; left:64px; font-size:92px; font-weight:800; letter-spacing:-0.02em; }}
  h1 .date {{ color:#0F172A; }}
  .rule {{ position:absolute; top:208px; left:66px; width:96px; height:7px; background:{BLUE}; border-radius:4px; }}
  .head {{ position:absolute; top:236px; left:64px; font-size:33px; font-weight:600; color:#334155; }}
  .grid {{ position:absolute; top:312px; left:64px; display:flex; gap:22px; }}
  .card {{ background:#fff; border:1px solid #E8EDF4; border-radius:18px;
           box-shadow:0 14px 34px rgba(15,23,42,0.06); }}
  .idx {{ width:252px; padding:22px 24px 18px; }}
  .idx-top {{ display:flex; justify-content:space-between; align-items:center; font-size:21px; font-weight:600; color:#334155; }}
  .chip {{ width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:800; }}
  .idx-pct {{ margin-top:10px; font-size:46px; font-weight:800; letter-spacing:-0.01em; font-variant-numeric:tabular-nums; }}
  .panels {{ position:absolute; top:478px; left:64px; display:flex; gap:22px; }}
  .panel {{ width:526px; padding:22px 26px; }}
  .p-title {{ font-size:22px; font-weight:700; margin-bottom:14px; display:flex; align-items:center; gap:10px; }}
  .p-title .dot {{ width:26px; height:26px; border-radius:8px; background:{BLUE}1A; display:inline-flex; align-items:center; justify-content:center; color:{BLUE}; font-size:14px; }}
  .cols {{ display:flex; gap:30px; }}
  .col {{ flex:1; min-width:0; }}
  .col + .col {{ border-left:1px solid #EEF2F7; padding-left:30px; }}
  .r {{ display:flex; align-items:baseline; justify-content:space-between; padding:7px 0; font-size:23px; flex-wrap:wrap; }}
  .sym {{ font-weight:700; }}
  .pct {{ font-weight:800; font-variant-numeric:tabular-nums; }}
  .note {{ width:100%; font-size:15px; color:#64748B; margin-top:-2px; }}
  .next {{ position:absolute; left:64px; bottom:64px; width:1100px; background:#fff; border:1px solid #E8EDF4;
           border-radius:18px; box-shadow:0 14px 34px rgba(15,23,42,0.06); padding:20px 26px; display:flex; align-items:center; gap:26px; }}
  .next .lab {{ font-size:22px; font-weight:800; white-space:nowrap; }}
  .nx {{ font-size:19px; color:#334155; }}
  .nx + .nx {{ border-left:1px solid #EEF2F7; padding-left:24px; }}
  .nx-t {{ font-weight:700; color:{BLUE}; }}
  .nx-d {{ color:#64748B; }}
  .aime {{ position:absolute; right:14px; bottom:104px; width:475px; transform:rotate({tilt}); filter:drop-shadow(0 30px 60px {mood_glow}); }}
  .aime-glow {{ position:absolute; right:0px; bottom:70px; width:520px; height:520px; border-radius:50%;
                background:radial-gradient(closest-side,{mood_glow},transparent); }}
  .ft {{ position:absolute; bottom:26px; left:0; width:100%; text-align:center; font-size:15px; color:#94A3B8; }}
</style></head><body>
  <div class="logo">{logo_svg}</div>
  <h1>{title} · <span class="date">{ctx["date"]}</span></h1>
  <div class="rule"></div>
  <div class="head">{ctx["headline"]}</div>
  <div class="grid">{idx_cards}</div>
  <div class="panels">
    <div class="card panel">
      <div class="p-title"><span class="dot">◔</span>The split inside megacaps</div>
      <div class="cols"><div class="col">{mega_rows}</div><div class="col">{mega_rows2}</div></div>
    </div>
    <div class="card panel">
      <div class="p-title"><span class="dot">▦</span>The split inside semis</div>
      <div class="cols"><div class="col">{semi_rows}</div><div class="col">{semi_rows2}</div></div>
    </div>
  </div>
  <div class="next"><span class="lab">Next 24 hours:</span>{nxt_html}</div>
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
    print(f"   {ctx['date']} · " + " ".join(f"{s}{fp(ctx['idx'].get(s,{}).get('pct'))}" for s, _ in IDX))

    print("② 文案(relay 探活 → 失败走规则)…")
    hl = relay_headline(ctx)
    ctx["headline"] = hl or rule_headline(ctx)
    print(f"   headline[{'AI' if hl else '规则'}]: {ctx['headline']}")

    print("③ 渲染版式 → ④ Chrome 出图…")
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
