"""对决周报卡 —— 五神 Arena 一周战报 → AInvest 品牌 PNG(全英文,海报铁律)。

数据 = data/arena-state.json(云端引擎撮合后的 SoT,先 git pull 再跑)。
版式 = AInvest 浅色品牌底 + Binance 式财务密度(榜单行/大数字/红绿信号),
       右侧 NAV race 折线 + Best trade / Toughest stop / Most active 三枚高光。
铁律 = 卡面零 CJK(渲染前正则拦截);AI personas 免责声明;Paper trading。

用法:
  uv run python scripts/arena_week_card.py                     # 最近一周(按 nav 最新日期)
  uv run python scripts/arena_week_card.py --headline "..."    # 报告派生标题覆盖机械标题
  uv run python scripts/arena_week_card.py --week-end 2026-06-12
"""
from __future__ import annotations
import argparse
import json
import re
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(Path(__file__).parent))
from share_card import logo_chip, ASSETS, OUT_DIR, CHROME, BLUE, GREEN, RED  # noqa: E402

STATE = ROOT / "data" / "arena-state.json"
START_CASH = 1_000_000.0

EN = {
    "buffett": ("Buffett", "Value / Moat / Long-hold"),
    "duan": ("Duan Yongping", "Discipline / Concentration"),
    "serenity": ("Serenity", "Bottleneck sniper / Hard stops"),
    "druckenmiller": ("Druckenmiller", "Macro trend / Momentum"),
    "sentiment": ("Sentiment", "Tape rotation / Fast in-out"),
}
# 折线/头像用的人物色(红绿留给涨跌信号,人物不用红绿)
MC = {"buffett": "#165DFF", "duan": "#7132F5", "serenity": "#0D9488",
      "druckenmiller": "#F59E0B", "sentiment": "#DB2777"}
SHORT = {"buffett": "Buffett", "duan": "Duan", "serenity": "Serenity",
         "druckenmiller": "Druck", "sentiment": "Sentiment"}


def fmt_pct(v: float) -> str:
    return f"{'+' if v >= 0 else '-'}{abs(v):.2f}%"


def fmt_nav(v: float) -> str:
    return f"${v:,.0f}"


def week_stats(st: dict, week_end: str | None) -> dict:
    all_dates = sorted({n["date"] for n in st["nav"]})
    if not all_dates:
        raise SystemExit("state 里没有 nav,引擎还没跑过")
    end = date.fromisoformat(week_end or all_dates[-1])
    monday = end - timedelta(days=end.weekday())
    wdates = [d for d in all_dates if monday <= date.fromisoformat(d) <= end]
    if not wdates:
        raise SystemExit(f"{monday}..{end} 没有任何 nav 日期")
    start_monday = (lambda d0: d0 - timedelta(days=d0.weekday()))(date.fromisoformat(all_dates[0]))
    week_no = (monday - start_monday).days // 7 + 1

    nav_map = {(n["master"], n["date"]): n["nav"] for n in st["nav"]}
    masters = []
    for m, (name, school) in EN.items():
        series = [START_CASH] + [nav_map.get((m, d), START_CASH) for d in wdates]
        final = series[-1]
        masters.append({"key": m, "name": name, "school": school, "series": series,
                        "nav": final, "pct": (final / START_CASH - 1) * 100,
                        "pnl": final - START_CASH})
    masters.sort(key=lambda x: -x["nav"])

    # 已实现盈亏:SELL 对最近一笔 BUY(周一所有底仓都来自 trades 里的初始 BUY)。
    # 建仓日(genesis)那 36 笔开局 BUY 不算"本周交易"——那是发牌,不是出手。
    genesis = all_dates[0]
    buys: dict[tuple, float] = {}
    realized, counts = [], {m: 0 for m in EN}
    src_ai = src_rule = 0
    for t in st["trades"]:
        key = (t["master"], t["sym"])
        if t["side"] == "BUY":
            buys[key] = t["price"]
        if t["date"] not in wdates or t["date"] == genesis:
            continue
        counts[t["master"]] += 1
        if (t.get("src") or "ai") == "ai":
            src_ai += 1
        else:
            src_rule += 1
        if t["side"] == "SELL" and key in buys and buys[key] > 0:
            realized.append({"master": t["master"], "sym": t["sym"],
                             "pct": (t["price"] / buys[key] - 1) * 100, "src": t.get("src") or "ai"})
    best = max(realized, key=lambda r: r["pct"], default=None)
    worst = min(realized, key=lambda r: r["pct"], default=None)
    active_key = max(counts, key=lambda k: counts[k])
    d0, d1 = date.fromisoformat(wdates[0]), date.fromisoformat(wdates[-1])
    label = f"{d0.strftime('%b %-d').upper()}–{d1.strftime('%-d' if d0.month == d1.month else '%b %-d').upper()}"
    return {"week_no": week_no, "dates": wdates, "label": label, "masters": masters,
            "best": best, "worst": worst,
            "active": {"key": active_key, "n": counts[active_key]},
            "n_trades": sum(counts.values()), "src_ai": src_ai, "src_rule": src_rule,
            "since": date.fromisoformat(genesis).strftime("%b %-d")}


def mech_headline(s: dict) -> str:
    w, runner = s["masters"][0], s["masters"][1]
    return (f"{w['name']} takes Week {s['week_no']}, {fmt_pct(w['pct'])} "
            f"in {len(s['dates'])} sessions. {runner['name']} {fmt_pct(runner['pct'])} close behind.")


# ---------- 版式 ----------
def race_svg(s: dict) -> str:
    """NAV race:x = Start + 每个交易日,y = 较 $1M 的 %。端点带人名标签,简单防重叠。"""
    W, H, PAD_L, PAD_R, PAD_T, PAD_B = 560, 300, 46, 172, 16, 30
    series = {m["key"]: [(v / START_CASH - 1) * 100 for v in m["series"]] for m in s["masters"]}
    ys_all = [y for arr in series.values() for y in arr]
    lo, hi = min(ys_all + [0]), max(ys_all + [0])
    span = (hi - lo) or 1
    lo -= span * 0.08; hi += span * 0.08; span = hi - lo
    n = len(next(iter(series.values())))
    X = lambda i: PAD_L + i * (W - PAD_L - PAD_R) / (n - 1)
    Y = lambda v: PAD_T + (hi - v) / span * (H - PAD_T - PAD_B)

    grid, zero_y = "", Y(0)
    grid += (f'<line x1="{PAD_L}" y1="{zero_y:.1f}" x2="{W-PAD_R}" y2="{zero_y:.1f}" '
             f'stroke="#94A3B8" stroke-width="1" stroke-dasharray="3 4" opacity="0.7"/>'
             f'<text x="{PAD_L-8}" y="{zero_y+4:.1f}" text-anchor="end" font-size="12" fill="#94A3B8">0%</text>')
    ticks = ["Start"] + [date.fromisoformat(d).strftime("%b %-d") for d in s["dates"]]
    for i, tk in enumerate(ticks):
        grid += f'<text x="{X(i):.1f}" y="{H-8}" text-anchor="middle" font-size="12.5" fill="#94A3B8">{tk}</text>'

    lines, labels = "", []
    for m in s["masters"]:
        arr, c = series[m["key"]], MC[m["key"]]
        pts = " ".join(f"{X(i):.1f},{Y(v):.1f}" for i, v in enumerate(arr))
        lines += (f'<polyline points="{pts}" fill="none" stroke="{c}" stroke-width="3" '
                  f'stroke-linejoin="round" stroke-linecap="round"/>'
                  f'<circle cx="{X(n-1):.1f}" cy="{Y(arr[-1]):.1f}" r="4.5" fill="{c}"/>')
        labels.append({"y": Y(arr[-1]), "c": c, "t": f"{SHORT[m['key']]} {fmt_pct(m['pct'])}"})
    labels.sort(key=lambda L: L["y"])           # 端点标签防重叠:自上而下推开
    for i in range(1, len(labels)):
        if labels[i]["y"] - labels[i - 1]["y"] < 21:
            labels[i]["y"] = labels[i - 1]["y"] + 21
    lab_html = "".join(f'<text x="{W-PAD_R+10}" y="{L["y"]+4:.1f}" font-size="14.5" font-weight="700" '
                       f'fill="{L["c"]}">{L["t"]}</text>' for L in labels)
    return (f'<svg viewBox="0 0 {W} {H}" style="width:100%;height:auto;display:block">'
            f'{grid}{lines}{lab_html}</svg>')


def chip_row(icon: str, label: str, body: str) -> str:
    return (f'<div class="hl"><span class="hl-ic">{icon}</span>'
            f'<span class="hl-lab">{label}</span><span class="hl-body">{body}</span></div>')


def build_html(s: dict, headline: str) -> str:
    logo_svg = (ASSETS / "logo-ainvest.svg").read_text(encoding="utf-8")
    rows = ""
    for i, m in enumerate(s["masters"]):
        c = GREEN if m["pct"] >= 0 else RED
        crown = '<span class="win">WEEK WINNER</span>' if i == 0 else ""
        rows += f"""
      <div class="mrow{' first' if i == 0 else ''}">
        <span class="rk">{i + 1}</span>
        <span class="av" style="background:{MC[m['key']]}1A;color:{MC[m['key']]}">{m['name'][0]}</span>
        <span class="who"><b>{m['name']}</b>{crown}<i>{m['school']}</i></span>
        <span class="num"><b style="color:{c}">{fmt_pct(m['pct'])}</b><i>{fmt_nav(m['nav'])}</i></span>
      </div>"""

    hl = ""
    if s["best"]:
        b = s["best"]
        hl += chip_row("&#9650;", "Best trade",
                       f'{logo_chip(b["sym"])}<b>${b["sym"]}</b> <b style="color:{GREEN}">{fmt_pct(b["pct"])}</b>'
                       f'<span class="dim">&middot; {EN[b["master"]][0]}</span>')
    if s["worst"] and s["worst"]["pct"] < 0:
        w = s["worst"]
        tag = "auto-stop" if w["src"] != "ai" else "AI cut"
        hl += chip_row("&#9660;", "Toughest exit",
                       f'{logo_chip(w["sym"])}<b>${w["sym"]}</b> <b style="color:{RED}">{fmt_pct(w["pct"])}</b>'
                       f'<span class="dim">&middot; {SHORT[w["master"]]} &middot; {tag}</span>')
    a = s["active"]
    hl += chip_row("&#9889;", "Most active",
                   f'<b>{EN[a["key"]][0]}</b><span class="dim">&middot; {a["n"]} of {s["n_trades"]} trades this week</span>')

    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  html,body {{ width:1600px; height:900px; }}
  body {{ font-family:-apple-system,"SF Pro Display",system-ui,sans-serif; color:#0F172A; overflow:hidden; position:relative;
         font-variant-numeric:tabular-nums;
         background:
           radial-gradient(820px 460px at -4% -10%, rgba(22,93,255,0.07), transparent 60%),
           radial-gradient(760px 520px at 104% 110%, rgba(22,93,255,0.05), transparent 58%),
           linear-gradient(165deg,#FAFBFD 0%,#F2F5F9 100%); }}
  .logo {{ position:absolute; top:52px; left:64px; width:190px; }}
  .logo svg {{ width:100%; height:auto; }}
  h1 {{ position:absolute; top:100px; left:62px; font-size:84px; font-weight:800; letter-spacing:-0.025em; color:#0E1525; }}
  .wk {{ position:absolute; top:124px; left:760px; padding:9px 18px; border-radius:999px; background:{BLUE}14;
         color:{BLUE}; font-size:24px; font-weight:800; letter-spacing:0.02em; white-space:nowrap; }}
  .sub {{ position:absolute; top:206px; left:64px; font-size:21px; font-weight:600; color:#64748B; }}
  .rule {{ position:absolute; top:248px; left:66px; width:104px; height:8px; background:{BLUE}; border-radius:4px; }}
  .head {{ position:absolute; top:276px; left:64px; width:1460px; font-size:33px; font-weight:600; color:#3B4456;
           white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}
  .board {{ position:absolute; top:352px; left:64px; width:850px; background:linear-gradient(180deg,#FFFFFF,#FBFCFE);
            border-radius:22px; border:1px solid rgba(15,23,42,0.05); padding:8px 26px;
            box-shadow:0 1px 0 rgba(255,255,255,.95) inset, 0 2px 3px rgba(15,23,42,.04), 0 18px 38px rgba(15,23,42,.08); }}
  .mrow {{ display:flex; align-items:center; gap:18px; padding:14.5px 4px; }}
  .mrow + .mrow {{ border-top:1px solid #EDF1F6; }}
  .mrow.first {{ background:linear-gradient(90deg,{BLUE}0D,transparent 70%); margin:0 -26px; padding:14.5px 30px; border-radius:18px; }}
  .rk {{ width:30px; font-size:24px; font-weight:800; color:#94A3B8; text-align:center; flex:none; }}
  .mrow.first .rk {{ color:{BLUE}; }}
  .av {{ width:46px; height:46px; border-radius:50%; display:flex; align-items:center; justify-content:center;
         font-size:21px; font-weight:800; flex:none; }}
  .who {{ flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }}
  .who b {{ font-size:25px; font-weight:750; letter-spacing:-0.01em; display:flex; align-items:center; gap:12px; }}
  .who i {{ font-style:normal; font-size:15px; color:#8A94A6; font-weight:550; }}
  .win {{ font-size:12.5px; font-weight:800; letter-spacing:0.06em; color:{BLUE}; background:{BLUE}14;
          padding:3px 10px; border-radius:999px; }}
  .num {{ text-align:right; display:flex; flex-direction:column; gap:1px; }}
  .num b {{ font-size:33px; font-weight:800; letter-spacing:-0.01em; }}
  .num i {{ font-style:normal; font-size:15.5px; color:#8A94A6; font-weight:600; }}
  .race {{ position:absolute; top:352px; left:946px; width:590px; background:linear-gradient(180deg,#FFFFFF,#FBFCFE);
           border-radius:22px; border:1px solid rgba(15,23,42,0.05); padding:18px 14px 8px;
           box-shadow:0 1px 0 rgba(255,255,255,.95) inset, 0 2px 3px rgba(15,23,42,.04), 0 18px 38px rgba(15,23,42,.08); }}
  .race .cap {{ font-size:17px; font-weight:700; color:#3B4456; margin:0 10px 4px; }}
  .hls {{ position:absolute; top:698px; left:946px; width:590px; display:flex; flex-direction:column; gap:9px; }}
  .hl {{ display:flex; align-items:center; gap:10px; background:linear-gradient(180deg,#FFFFFF,#FBFCFE);
         border:1px solid rgba(15,23,42,0.05); border-radius:16px; padding:10px 14px;
         box-shadow:0 2px 3px rgba(15,23,42,.04), 0 10px 24px rgba(15,23,42,.06); font-size:18.5px; }}
  .hl-ic {{ width:30px; height:30px; border-radius:9px; background:{BLUE}12; color:{BLUE};
            display:flex; align-items:center; justify-content:center; font-size:14px; flex:none; }}
  .hl-lab {{ font-weight:800; color:#3B4456; width:122px; flex:none; }}
  .hl-body {{ display:flex; align-items:center; gap:8px; min-width:0; white-space:nowrap; overflow:hidden; }}
  .hl-body b {{ font-weight:800; }}
  .dim {{ color:#8A94A6; font-weight:550; }}
  .lg {{ width:25px; height:25px; border-radius:50%; overflow:hidden; background:#fff; border:1px solid #E8EDF4;
         display:inline-flex; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(15,23,42,0.08); flex:none; }}
  .lg img {{ width:100%; height:100%; object-fit:cover; }}
  .lt {{ font-size:11px; font-weight:800; color:{BLUE}; background:{BLUE}10; }}
  .ft {{ position:absolute; bottom:20px; left:64px; width:850px; text-align:left; font-size:14px; color:#9AA3B2; }}
</style></head><body>
  <div class="logo">{logo_svg}</div>
  <h1>AI Masters Arena</h1>
  <span class="wk">WEEK {s["week_no"]} &middot; {s["label"]}</span>
  <div class="sub">Five AI investor personas &middot; $1,000,000 each &middot; live US-stock paper trading since {s["since"]} &middot; every call published before the close</div>
  <div class="rule"></div>
  <div class="head">{headline}</div>
  <div class="board">{rows}</div>
  <div class="race"><div class="cap">NAV race &middot; vs $1M start <span style="color:#8A94A6;font-weight:600">&middot; week: {s["n_trades"]} trades ({s["src_ai"]} AI calls &middot; {s["src_rule"]} guardrail)</span></div>{race_svg(s)}</div>
  <div class="hls">{hl}</div>
  <div class="ft">AI personas inspired by famous investors &middot; not affiliated &middot; paper trading, not financial advice &middot; Data: Nasdaq close &middot; AInvest</div>
</body></html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--week-end", default="", help="YYYY-MM-DD,默认 state 里最新 nav 日期")
    ap.add_argument("--headline", default="", help="报告派生标题(全英文),默认机械标题")
    args = ap.parse_args()

    st = json.loads(STATE.read_text(encoding="utf-8"))
    s = week_stats(st, args.week_end or None)
    headline = args.headline or mech_headline(s)
    print(f"Week {s['week_no']} ({s['label']}) · {len(s['dates'])} sessions · {s['n_trades']} trades")
    for m in s["masters"]:
        print(f"  {m['name']:14s} {fmt_pct(m['pct']):>8s}  {fmt_nav(m['nav'])}")
    print(f"  headline: {headline}")

    html = build_html(s, headline)
    cjk = re.findall(r"[一-鿿぀-ヿ가-힯]", html)
    if cjk:
        raise SystemExit(f"❌ 卡面出现 CJK(海报英文铁律): {''.join(sorted(set(cjk)))[:20]}")

    tmp = Path("/tmp/arena_week_card.html")
    tmp.write_text(html, encoding="utf-8")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    end = s["dates"][-1].replace("-", "")
    out = OUT_DIR / f"AInvest_arena_week{s['week_no']}_{end}.png"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--window-size=1600,900", "--force-device-scale-factor=2",
                    f"--screenshot={out}", f"file://{tmp}"],
                   capture_output=True, timeout=60)
    print(f"✅ {out}  ({out.stat().st_size // 1024} KB)")
    return str(out)


if __name__ == "__main__":
    main()
