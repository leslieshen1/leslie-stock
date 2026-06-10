"""日报模板 #3「AI 合成版」—— Claude 写结构化版式语言,提供组件,gpt-image-2 负责画。

v2 教训(对照用户标杆样张):松散的"场景描述"出不来设计系统 —— prompt 必须是
**结构化版式语言**:STYLE SYSTEM(材质/色板/图标体系)+ LAYOUT(逐行分区,内容逐字)
+ HARD CONSTRAINTS(文字清单/留白/禁项)。短字符串分组后 ~20 条也能字符级全对。

分工:
  Claude     艺术指导:spec(结构化 JSON)→ 版式语言 prompt
  组件        Aime 姿态 PNG(带胸章,img2img 参考)+ 真 logo 生成后像素级覆盖
  gpt-image-2 新拟物材质/光影/图标/构图
  质检        生成后 Claude 多模态逐位核对所有字符串 —— 全对才可发

通道铁律:stream=true 必须 / 不支持透明底 / 有节流(45s 退避)。

用法:
  uv run python scripts/ai_card.py --spec data/cards/<topic>.ai.json   # 缺省 DEMO(盘前 Jun 9)
"""
from __future__ import annotations
import argparse
import base64
import json
import mimetypes
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

try:
    from dotenv import load_dotenv; load_dotenv()
except Exception:
    pass

ROOT = Path(__file__).parent.parent
ASSETS = ROOT / "assets" / "brand-ainvest"
OUT_DIR = Path.home() / "Downloads" / "AInvest卡片"   # 专属文件夹,好找
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
KEY = os.environ.get("NDT_API_KEY", "")
BASE = (os.environ.get("NDT_BASE_URL") or "https://api.nadoutong.org").rstrip("/")

# 标杆同款内容(盘前 Jun 9,来自当日盘前报告)—— 作为 DEMO 兼 A/B 基准
DEMO = {
    "slug": "premarket-jun9",
    "mood": "bullish",
    "size": "1536x1024",
    "title": "Pre-Market · Jun 9 · ET",
    "headline": "Green across the board, tech out front.",
    "indexes": [["Nasdaq 100", "+0.90%"], ["Russell 2000", "+1.09%"], ["S&P 500", "+0.51%"], ["Dow", "+0.35%"]],
    "panels": [
        {"icon": "chip", "title": "Semis & optical", "items": ["$AAOI +4.71%", "$MU +4.48%", "$AXTI +4.76%"]},
        {"icon": "rocket", "title": "Space", "items": ["$ASTS +7.46%", "$LUNR +3.72%"]},
        {"icon": "bitcoin", "title": "Crypto names", "items": ["$MSTR -1.62%", "$COIN -1.07%"]},
    ],
    "footer": {"icon": "clock", "text": "Tonight: $ORCL after the close", "highlight": "$ORCL"},
}

ICON_DESC = {"chip": "a thin-line microchip icon", "rocket": "a thin-line rocket icon",
             "bitcoin": "a thin-line bitcoin-circle icon", "clock": "a thin-line clock icon",
             "calendar": "a thin-line calendar icon", "bolt": "a thin-line lightning-bolt icon"}


def all_texts(s: dict) -> list[str]:
    """spec → 必须逐字正确的字符串清单(也是质检清单)。"""
    out = [s["title"], s["headline"]]
    for name, pct in s["indexes"]:
        out += [name, pct]
    for p in s["panels"]:
        out.append(p["title"])
        out += p["items"]
    out.append(s["footer"]["text"])
    return out


def layout_block(s: dict, idx_lines: str, panel_lines: str) -> str:
    """画幅感知布局:横版(左栏+右吉祥物)/ 方版(2×2 格)/ 竖版(纵向流+吉祥物坐底)。"""
    ft = s["footer"]
    w, h = (int(x) for x in s.get("size", "1536x1024").split("x"))
    mascot = ('the robot mascot from the reference image, FULL BODY, standing on a soft glowing ring '
              'shadow. Keep its design EXACTLY as the reference (glossy white, navy visor, arrow antenna, '
              'blue chest badge).')
    footer = (f'A full-width footer bar (same card style): {ICON_DESC.get(ft.get("icon", "clock"))} at left, '
              f'then "{ft["text"]}" with "{ft.get("highlight", "")}" in bold royal blue.')
    if w > h:  # 横版
        return f"""LAYOUT, top to bottom (left ~68% of canvas; right ~32% reserved for the mascot):
  1. Top-left corner: COMPLETELY EMPTY reserved space (~22% width, ~10% height) — a logo is added later.
  2. Below it: HUGE bold dark headline "{s['title']}" (largest text on the card),
     then a short royal-blue underline bar, then the sub-headline "{s['headline']}" in medium dark-grey.
  3. One row of FOUR equal index tiles:
{idx_lines}
  4. One row of {len(s["panels"])} theme panels (slightly wider than tall):
{panel_lines}  5. {footer}
  6. RIGHT side: {mascot} It overlaps nothing important."""
    if w == h:  # 方版
        return f"""LAYOUT, top to bottom (full-width vertical flow):
  1. Top-left corner: COMPLETELY EMPTY reserved space (~26% width, ~8% height) — a logo is added later.
  2. HUGE bold dark headline "{s['title']}", then a short royal-blue underline bar,
     then the sub-headline "{s['headline']}" in medium dark-grey.
  3. A 2×2 GRID of four equal index tiles:
{idx_lines}
  4. One compact row of {len(s["panels"])} theme panels:
{panel_lines}  5. {footer}
  6. Bottom-right corner: {mascot} Medium size, tucked into the corner, overlapping nothing important."""
    # 竖版
    return f"""LAYOUT, top to bottom (single-column vertical flow, generous spacing):
  1. Top: COMPLETELY EMPTY reserved band (~40% width, ~6% height, left-aligned) — a logo is added later.
  2. HUGE bold dark headline "{s['title']}" (may wrap to two lines), then a short royal-blue underline bar,
     then the sub-headline "{s['headline']}" in medium dark-grey.
  3. A 2×2 GRID of four equal index tiles:
{idx_lines}
  4. {len(s["panels"])} theme panels STACKED vertically (each full-width, compact height):
{panel_lines}  5. {footer}
  6. Bottom: {mascot} Sitting/standing at bottom-center-right, large, beside or below the footer,
     overlapping nothing important."""


def compile_prompt(s: dict) -> str:
    """结构化版式语言:风格系统 + 画幅感知布局 + 硬约束。"""
    idx_lines = "\n".join(
        f'     Tile {i+1}: name "{n}" (small, dark, top-left), a small circled '
        f'{"green up-arrow" if v.startswith("+") else "red down-arrow"} icon top-right, '
        f'then a HUGE {"deep-green" if v.startswith("+") else "red"} percentage "{v}".'
        for i, (n, v) in enumerate(s["indexes"]))
    panel_lines = ""
    for i, p in enumerate(s["panels"]):
        items = " · ".join(p["items"])
        panel_lines += (f'     Panel {i+1}: {ICON_DESC.get(p["icon"], "a thin-line icon")} at left, bold title '
                        f'"{p["title"]}", below it ticker items "{items}" '
                        f'(each +value deep-green #15803D, each -value red #DC2626).\n')
    ft = s["footer"]
    texts = "\n".join(f'  - "{t}"' for t in all_texts(s))

    return f"""Design a premium fintech social-media card, light theme, landscape.

STYLE SYSTEM (follow strictly):
- Background: near-white paper (#F4F6F9) with an extremely subtle cool gradient; generous whitespace.
- All tiles/panels: soft white rounded-rectangle cards (corner radius ~24px) with gentle neumorphic
  depth — light source top-left, soft diffuse shadow below-right, faint inner top highlight. No hard borders.
- Typography: clean modern sans-serif (SF Pro style). Ink #16181D for headings; deep green #15803D for
  positive numbers; red #DC2626 for negative numbers; royal blue #165DFF ONLY for the underline accent
  and the highlighted ticker "{ft.get('highlight', '')}".
- Icons: minimal thin-line style, dark ink, consistent stroke weight.

{layout_block(s, idx_lines, panel_lines)}

HARD CONSTRAINTS:
- Render EXACTLY these text strings, character-for-character; NO other words, numbers, tickers,
  charts or labels anywhere on the card:
{texts}
- All numbers crisp, large, perfectly legible. No watermark, no signature, no fake browser/phone chrome."""


def sse_events(resp):
    buf = []
    for raw in resp:
        line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
        if line == "":
            for piece in buf:
                if piece.startswith("data:"):
                    data = piece[5:].strip()
                    if data and data != "[DONE]":
                        try:
                            yield json.loads(data)
                        except json.JSONDecodeError:
                            pass
            buf = []
        else:
            buf.append(line)


def gen_image(prompt: str, refs: list[Path], size: str, out_raw: Path) -> bool:
    content = []
    for p in refs:
        mime = mimetypes.guess_type(str(p))[0] or "image/png"
        content.append({"type": "input_image",
                        "image_url": f"data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()}"})
    content.append({"type": "input_text", "text": prompt})
    body = {"model": "gpt-5.5",
            "input": [{"role": "user", "content": content}],
            "stream": True,  # 必须
            "tools": [{"type": "image_generation", "size": size, "quality": "high", "output_format": "png"}],
            "tool_choice": "required"}
    req = urllib.request.Request(f"{BASE}/v1/responses", data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {KEY}",
                                          "Content-Type": "application/json",
                                          "Accept": "text/event-stream"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            for ev in sse_events(resp):
                if ev.get("type") == "response.output_item.done":
                    item = ev.get("item", {})
                    if item.get("type") == "image_generation_call" and item.get("result"):
                        out_raw.write_bytes(base64.b64decode(item["result"]))
                        return True
    except Exception as e:
        print(f"   ({type(e).__name__}: {str(e)[:100]})")
    return False


def composite_logo(raw: Path, out: Path, size: str) -> None:
    """真 logo 像素级覆盖到左上保留区(绝不让 AI 画 logo)。"""
    w, h = (int(x) for x in size.split("x"))
    logo_svg = (ASSETS / "logo-ainvest.svg").read_text(encoding="utf-8")
    html = f"""<!doctype html><html><head><style>
      * {{margin:0;padding:0}} html,body {{width:{w}px;height:{h}px}}
      img.bg {{position:absolute;inset:0;width:100%;height:100%}}
      .logo {{position:absolute;top:46px;left:58px;width:250px}}
      .logo svg {{width:100%;height:auto}}
    </style></head><body>
      <img class="bg" src="file://{raw.resolve()}"/>
      <div class="logo">{logo_svg}</div>
    </body></html>"""
    tmp = Path("/tmp/ai_card_composite.html")
    tmp.write_text(html, encoding="utf-8")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    f"--window-size={w},{h}", "--force-device-scale-factor=1.5",
                    f"--screenshot={out}", f"file://{tmp}"], capture_output=True, timeout=60)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", default="")
    ap.add_argument("--tries", type=int, default=3)
    args = ap.parse_args()
    spec = DEMO
    if args.spec:
        raw = Path(args.spec).read_text(encoding="utf-8") if Path(args.spec).exists() else args.spec
        spec = {**DEMO, **json.loads(raw)}
    if not KEY:
        sys.exit("缺 NDT_API_KEY(.env)")

    mascot = ASSETS / f"aime-{spec['mood']}.png"
    refs = [mascot if mascot.exists() else ASSETS / "aime-head.png"]
    prompt = compile_prompt(spec)
    n_texts = len(all_texts(spec))
    print(f"🎬 版式语言编译完成({n_texts} 条逐字文字 · 参考 {refs[0].name})")

    raw_png = Path(f"/tmp/ai_card_{spec['slug']}_raw.png")
    ok = False
    for i in range(1, args.tries + 1):
        print(f"🖼  gpt-image-2 第 {i} 发…")
        if gen_image(prompt, refs, spec.get("size", "1536x1024"), raw_png):
            ok = True
            break
        time.sleep(45 * i)
    if not ok:
        sys.exit("❌ 上游节流/不可用 —— 改用 HTML 模板(share_card.py / aime_scan_card.py)")

    out = OUT_DIR / f"AInvest_ai_{spec['slug']}_{datetime.now().strftime('%Y%m%d')}.png"
    composite_logo(raw_png, out, spec.get("size", "1536x1024"))
    print(f"✅ {out}")
    print(f"⚠ 质检关:Claude 逐位核对 {n_texts} 条字符串 —— 全对才可发,错字即重生成/降级模板。")


if __name__ == "__main__":
    main()
