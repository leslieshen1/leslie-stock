"""AInvest 日报模板 #1「Aime Scan 洞察卡」—— 单一市场洞察 + 手机内同款可视化。

版式(1:1 方图,X/IG 通吃):
  左列  编辑部排版:logo + 蓝 kicker + 衬线大标题(Playfair)+ 副题 + 三行数据(图标+大数)+ 金句
  右列  CSS 手绘 iPhone:暗色 Aime Scan 头 + 白卡组(标题卡 / 甜甜圈+图例 / 高亮卡 / 分割条 / 趋势线)
  全部图表由同一份 spec 数据驱动 —— 数字绝不交给图像模型。

用法:
  uv run python scripts/aime_scan_card.py --spec data/cards/sp500-concentration.json
  uv run python scripts/aime_scan_card.py --spec '{"kicker":...}'   # 直接传 JSON
spec 字段见 DEMO_SPEC。输出 ~/Downloads/AInvest_scan_{slug}.png(2048×2048)。
"""
from __future__ import annotations
import argparse
import json
import re
import subprocess
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
ASSETS = ROOT / "assets" / "brand-ainvest"
OUT_DIR = Path.home() / "Downloads" / "AInvest卡片"   # 专属文件夹,好找
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

BLUE, INK, MUT, PAPER = "#165DFF", "#16181D", "#5B6472", "#F4F4F1"

DEMO_SPEC = {
    "slug": "sp500-concentration",
    "kicker": "Aime Scan",
    "headline": "S&P 500\nConcentration",
    "sub": "Top 10 names. 38% of the S&P 500.\nMore concentrated than the dot-com peak.",
    "stats": [
        {"label": "Today:", "value": "38%", "num": 38, "icon": "chart"},
        {"label": "2000:", "value": "27%", "num": 27, "icon": "people"},
        {"label": "1980s avg:", "value": "~20%", "num": 20, "icon": "screen"},
    ],
    "punchline": "Diversification doesn't mean what it used to.",
    "phone_title": "S&P 500\nConcentration",
    "phone_sub": "Top 10 names as % of index",
    "donut_center": ["38%", "TODAY"],
    "legend": [["Today", "38%", BLUE], ["Dot-com peak", "27%", "#7FA4FF"], ["1980s avg", "~20%", "#C2C9D6"]],
    "callout": {"title": "Record concentration", "sub": "Top 10 names now account for 38% of the index."},
    "split": {"a_label": "Top 10 names", "a": "38%", "b_label": "Rest of S&P 500", "b": "62%", "a_num": 38},
    "trend": {"label": "Concentration over time",
              "points": [["1980s avg", "~20%", 20], ["2000", "27%", 27], ["Today", "38%", 38]]},
}

ICONS = {
    "chart": '<rect x="3" y="12" width="4" height="8" rx="1"/><rect x="10" y="7" width="4" height="13" rx="1"/><rect x="17" y="3" width="4" height="17" rx="1"/>',
    "people": '<circle cx="8" cy="8" r="3.2"/><path d="M2.5 20c0-3.3 2.5-5.5 5.5-5.5S13.5 16.7 13.5 20"/><circle cx="16.5" cy="9.5" r="2.6"/><path d="M14 20c.2-2.8 2-4.6 4.5-4.6 1.6 0 3 .8 3.8 2.1"/>',
    "screen": '<rect x="3" y="4" width="18" height="13" rx="1.6"/><path d="M9 21h6M12 17v4"/>',
}


def donut_svg(legend, center) -> str:
    """三段比例环 + 中心数。segments 按 legend 数值占比(余量浅灰)。"""
    nums = []
    for _, v, _ in legend:
        m = re.search(r"([\d.]+)", v)
        nums.append(float(m.group(1)) if m else 0)
    total = max(sum(nums), 100)
    R, C = 42, 60
    circ = 2 * 3.14159 * R
    segs, acc = "", 0.0
    for (label, v, color), n in zip(legend, nums):
        frac = n / total
        dash = frac * circ
        segs += (f'<circle cx="{C}" cy="{C}" r="{R}" fill="none" stroke="{color}" stroke-width="15" '
                 f'stroke-dasharray="{dash:.1f} {circ - dash:.1f}" stroke-dashoffset="{-acc:.1f}" '
                 f'transform="rotate(-90 {C} {C})" stroke-linecap="butt"/>')
        acc += dash
    rest = circ - acc
    segs += (f'<circle cx="{C}" cy="{C}" r="{R}" fill="none" stroke="#EDF0F5" stroke-width="15" '
             f'stroke-dasharray="{rest:.1f} {circ - rest:.1f}" stroke-dashoffset="{-acc:.1f}" '
             f'transform="rotate(-90 {C} {C})"/>')
    return (f'<svg viewBox="0 0 120 120" class="donut">{segs}'
            f'<text x="{C}" y="{C - 2}" text-anchor="middle" font-size="22" font-weight="800" fill="{INK}">{center[0]}</text>'
            f'<text x="{C}" y="{C + 16}" text-anchor="middle" font-size="9.5" letter-spacing="1.5" fill="{MUT}">{center[1]}</text></svg>')


def trend_svg(points) -> str:
    nums = [p[2] for p in points]
    lo, hi = min(nums), max(nums)
    rng = (hi - lo) or 1
    W, H, pad = 300, 70, 16
    xs = [pad + i * (W - 2 * pad) / (len(nums) - 1) for i in range(len(nums))]
    ys = [H - 14 - (n - lo) / rng * (H - 30) for n in nums]
    pts = " ".join(f"{x:.0f},{y:.0f}" for x, y in zip(xs, ys))
    dots = "".join(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="4" fill="{BLUE}"/>' for x, y in zip(xs, ys))
    labels = "".join(
        f'<text x="{x:.0f}" y="{H + 14}" text-anchor="middle" font-size="9.5" fill="{MUT}">{p[0]}</text>'
        f'<text x="{x:.0f}" y="{H + 26}" text-anchor="middle" font-size="10" font-weight="700" fill="{INK}">{p[1]}</text>'
        for x, p in zip(xs, points))
    return (f'<svg viewBox="0 0 {W} {H + 32}" class="trend">'
            f'<polyline points="{pts}" fill="none" stroke="{BLUE}" stroke-width="2.6" stroke-linejoin="round"/>'
            f'{dots}{labels}</svg>')


def circuit_svg(color="#D8DCE2") -> str:
    """角落电路板纹理(轻、确定性)。"""
    return (f'<svg viewBox="0 0 200 200" fill="none" stroke="{color}" stroke-width="1.4">'
            '<path d="M10 60h54v-28h40M64 60v46h32M10 120h36v34M96 32v-20M96 106h60v-40h34M156 66V20"/>'
            '<circle cx="96" cy="32" r="3.4"/><circle cx="64" cy="60" r="3.4"/><circle cx="96" cy="106" r="3.4"/>'
            '<circle cx="46" cy="154" r="3.4"/><circle cx="156" cy="20" r="3.4"/><circle cx="190" cy="66" r="3.4"/></svg>')


def build_html(s: dict) -> str:
    logo_svg = (ASSETS / "logo-ainvest.svg").read_text(encoding="utf-8")
    aime = (ASSETS / "aime-head.png").resolve()
    headline = s["headline"].replace("\n", "<br/>")
    sub = s["sub"].replace("\n", "<br/>")
    phone_title = s["phone_title"].replace("\n", "<br/>")

    stat_rows = ""
    for st in s["stats"]:
        ic = ICONS.get(st.get("icon", "chart"), ICONS["chart"])
        stat_rows += (f'<div class="stat"><span class="si"><svg viewBox="0 0 24 24" fill="none" '
                      f'stroke="{BLUE}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{ic}</svg></span>'
                      f'<span class="sl">{st["label"]}</span><span class="sv">{st["value"]}</span></div>')

    legend_rows = "".join(
        f'<div class="lg-r"><span class="lg-dot" style="background:{c}"></span>'
        f'<span class="lg-l">{l}</span><span class="lg-v" style="color:{BLUE if c == BLUE else INK}">{v}</span></div>'
        for l, v, c in s["legend"])

    sp = s["split"]
    return f'''<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  html,body {{ width:1350px; height:1350px; }}
  body {{ font-family:-apple-system,"SF Pro Text",system-ui,sans-serif; color:{INK}; position:relative; overflow:hidden;
          background:linear-gradient(150deg,#F6F6F4 0%,{PAPER} 55%,#EFEFEC 100%); }}
  .serif {{ font-family:"Playfair Display",Georgia,"Times New Roman",serif; }}
  .cir1 {{ position:absolute; top:-12px; right:330px; width:300px; opacity:0.5; }}
  .cir2 {{ position:absolute; bottom:-20px; left:-26px; width:320px; opacity:0.45; transform:rotate(180deg); }}
  .logo {{ position:absolute; top:64px; left:72px; width:230px; }}
  .logo svg {{ width:100%; height:auto; }}
  .left {{ position:absolute; left:72px; top:186px; width:640px; }}
  .kicker {{ color:{BLUE}; font-size:34px; font-weight:700; letter-spacing:0.01em; }}
  h1 {{ margin-top:18px; font-size:82px; line-height:1.04; font-weight:700; letter-spacing:0.005em; }}
  .sub {{ margin-top:30px; font-size:31px; line-height:1.42; color:#3D4350; }}
  .stats {{ margin-top:42px; }}
  .stat {{ display:flex; align-items:center; gap:22px; padding:20px 0; border-bottom:1px solid #DDDFE2; }}
  .stat:first-child {{ border-top:1px solid #DDDFE2; }}
  .si {{ width:54px; height:54px; border:1.6px solid {BLUE}55; border-radius:12px; display:flex; align-items:center; justify-content:center; background:#fff; }}
  .si svg {{ width:30px; height:30px; }}
  .sl {{ font-size:33px; color:#3D4350; width:215px; }}
  .sv {{ font-size:55px; font-weight:700; color:{BLUE}; font-family:"Playfair Display",Georgia,serif; }}
  .punch {{ margin-top:36px; font-size:28px; color:{MUT}; }}
  /* ===== 手机 ===== */
  .phone {{ position:absolute; right:88px; top:74px; width:540px; height:1130px; background:#0B0C10;
            border-radius:78px; border:3px solid #3A3D45; box-shadow:0 60px 120px rgba(15,23,42,0.28),0 0 0 12px #17181D inset; padding:22px; }}
  .ph-island {{ position:absolute; top:38px; left:50%; transform:translateX(-50%); width:120px; height:34px; background:#000; border-radius:20px; }}
  .ph-status {{ display:flex; justify-content:space-between; padding:18px 30px 0; color:#fff; font-size:20px; font-weight:600; }}
  .ph-head {{ display:flex; align-items:center; gap:14px; padding:30px 26px 22px; color:#fff; }}
  .ph-head img {{ width:52px; height:52px; }}
  .ph-head .t {{ font-size:30px; font-weight:700; flex:1; }}
  .ph-head .m {{ font-size:26px; opacity:0.85; }}
  .ph-body {{ background:transparent; padding:0 8px; display:flex; flex-direction:column; gap:16px; }}
  .pc {{ background:#fff; border-radius:22px; padding:22px 24px; box-shadow:0 4px 16px rgba(0,0,0,0.18); }}
  .pc-title {{ font-family:"Playfair Display",Georgia,serif; font-size:34px; font-weight:700; line-height:1.1; }}
  .pc-sub {{ margin-top:8px; font-size:18px; color:{MUT}; }}
  .pc1 {{ background:linear-gradient(120deg,#fff 62%,#EDF2FF 100%); }}
  .row {{ display:flex; align-items:center; gap:18px; }}
  .donut {{ width:200px; height:200px; flex:none; }}
  .lg-r {{ display:flex; align-items:center; gap:10px; padding:7px 0; font-size:20px; }}
  .lg-dot {{ width:14px; height:14px; border-radius:50%; flex:none; }}
  .lg-l {{ color:#3D4350; flex:1; }}
  .lg-v {{ font-weight:800; }}
  .co {{ display:flex; gap:16px; align-items:center; }}
  .co-i {{ width:64px; height:64px; border-radius:50%; background:#EDF2FF; display:flex; align-items:center; justify-content:center; flex:none; }}
  .co-i svg {{ width:34px; height:34px; }}
  .co-t {{ font-family:"Playfair Display",Georgia,serif; font-size:26px; font-weight:700; }}
  .co-s {{ font-size:17px; color:{MUT}; margin-top:4px; }}
  .bar-lbl {{ display:flex; justify-content:space-between; font-size:18px; margin-bottom:10px; }}
  .bar-lbl b {{ color:{BLUE}; }} .bar-lbl span b {{ color:{INK}; }}
  .bar {{ height:16px; border-radius:8px; background:#E4E8EF; overflow:hidden; }}
  .bar > div {{ height:100%; width:{sp["a_num"]}%; background:{BLUE}; border-radius:8px; }}
  .trend {{ width:100%; height:auto; }}
  .tr-lbl {{ font-size:19px; font-weight:600; color:{BLUE}; margin-bottom:4px; }}
</style></head><body>
  <div class="cir1">{circuit_svg()}</div>
  <div class="cir2">{circuit_svg()}</div>
  <div class="logo">{logo_svg}</div>
  <div class="left">
    <div class="kicker">{s["kicker"]}</div>
    <h1 class="serif">{headline}</h1>
    <div class="sub">{sub}</div>
    <div class="stats">{stat_rows}</div>
    <div class="punch">{s["punchline"]}</div>
  </div>
  <div class="phone">
    <div class="ph-island"></div>
    <div class="ph-status"><span>9:41</span><span style="display:flex;gap:10px;align-items:center"><svg width="22" height="16" viewBox="0 0 22 16" fill="#fff"><rect x="0" y="10" width="4" height="6" rx="1"/><rect x="6" y="7" width="4" height="9" rx="1"/><rect x="12" y="4" width="4" height="12" rx="1"/><rect x="18" y="1" width="4" height="15" rx="1"/></svg><svg width="20" height="16" viewBox="0 0 24 18" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M2 6c6-5 14-5 20 0M5.5 10c4-3.4 9-3.4 13 0M9 13.6c2-1.7 4-1.7 6 0"/><circle cx="12" cy="16.6" r="1.4" fill="#fff" stroke="none"/></svg><svg width="28" height="15" viewBox="0 0 28 15" fill="none"><rect x="1" y="1" width="22" height="13" rx="4" stroke="#fff" stroke-width="1.6"/><rect x="3.5" y="3.5" width="15" height="8" rx="2" fill="#fff"/><rect x="24.5" y="5" width="3" height="5" rx="1.4" fill="#fff"/></svg></span></div>
    <div class="ph-head"><img src="file://{aime}"/><span class="t">Aime Scan</span><span class="m"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"><path d="M18 9a6 6 0 0 0-12 0c0 6-2.4 7.2-2.4 7.2h16.8S18 15 18 9"/><path d="M10.2 20a2 2 0 0 0 3.6 0"/></svg></span></div>
    <div class="ph-body">
      <div class="pc pc1"><div class="pc-title serif">{phone_title}</div><div class="pc-sub">{s["phone_sub"]}</div></div>
      <div class="pc"><div class="row">{donut_svg(s["legend"], s["donut_center"])}<div style="flex:1">{legend_rows}</div></div></div>
      <div class="pc"><div class="co"><span class="co-i"><svg viewBox="0 0 24 24" fill="none" stroke="{BLUE}" stroke-width="2" stroke-linecap="round"><path d="M4 19V9m5 10V5m5 14v-7m5 7V8"/><path d="M3 4l4 3 4-5 5 4 4-2" opacity="0.6"/></svg></span>
        <div><div class="co-t serif">{s["callout"]["title"]}</div><div class="co-s">{s["callout"]["sub"]}</div></div></div></div>
      <div class="pc"><div class="bar-lbl"><span><b>{sp["a_label"]}</b><br/><b style="font-size:22px">{sp["a"]}</b></span>
        <span style="text-align:right">{sp["b_label"]}<br/><b style="font-size:22px">{sp["b"]}</b></span></div>
        <div class="bar"><div></div></div></div>
      <div class="pc"><div class="tr-lbl">{s["trend"]["label"]}</div>{trend_svg(s["trend"]["points"])}</div>
    </div>
  </div>
</body></html>'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", default="", help="JSON 文件路径或 JSON 字符串;缺省用 DEMO_SPEC")
    args = ap.parse_args()
    if args.spec:
        raw = Path(args.spec).read_text(encoding="utf-8") if Path(args.spec).exists() else args.spec
        spec = {**DEMO_SPEC, **json.loads(raw)}
    else:
        spec = DEMO_SPEC

    html = build_html(spec)
    tmp = Path("/tmp/aime_scan_card.html")
    tmp.write_text(html, encoding="utf-8")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"AInvest_scan_{spec['slug']}_{datetime.now().strftime('%Y%m%d')}.png"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--window-size=1350,1350", "--force-device-scale-factor=1.6",
                    "--virtual-time-budget=8000",  # 等 Google Fonts(Playfair)加载
                    f"--screenshot={out}", f"file://{tmp}"], capture_output=True, timeout=90)
    print(f"✅ {out}  ({out.stat().st_size//1024} KB)")


if __name__ == "__main__":
    main()
