"""日报模板 #3「AI 合成版」—— Claude 写提示词+约束,提供组件,gpt-image-2 负责画。

分工(和 #1/#2 的全手画模板互补):
  Claude     艺术指导:把 spec 编译成提示词 + 硬约束(版式/品牌色/文字清单/留白)
  组件        Aime 姿态 PNG(参考图,锁定吉祥物)+ 真 logo(生成后像素级覆盖,绝不让 AI 画 logo)
  gpt-image-2 光影/材质/构图/插画氛围(它擅长的)
  质检        生成后由 Claude(多模态)逐位核对图内数字 vs spec —— 错了重生成或降级 HTML 模板

调用通道(NDT relay 三铁律,实测):stream=true 必须 / 不支持透明底 / 有节流(失败 45s 退避)。

用法:
  uv run python scripts/ai_card.py --spec data/cards/<topic>.ai.json
  uv run python scripts/ai_card.py            # 用 DEMO 生成收盘海报
输出 ~/Downloads/AInvest_ai_{slug}.png + 提醒人工(Claude)质检数字。
"""
from __future__ import annotations
import argparse
import base64
import json
import mimetypes
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

import os
try:
    from dotenv import load_dotenv; load_dotenv()
except Exception:
    pass

ROOT = Path(__file__).parent.parent
ASSETS = ROOT / "assets" / "brand-ainvest"
OUT_DIR = Path.home() / "Downloads"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
KEY = os.environ.get("NDT_API_KEY", "")
BASE = (os.environ.get("NDT_BASE_URL") or "https://api.nadoutong.org").rstrip("/")

DEMO = {
    "slug": "close-jun9-poster",
    "mood": "bearish",          # 选 Aime 姿态 + 色温
    "size": "1536x1024",
    "texts": [                   # 必须出现在图里、且必须逐字正确的文字(少而大 = 高准确率)
        "Close · Jun 9",
        "Nasdaq 100  -1.15%",
        "S&P 500  -0.29%",
        "Dow  +0.10%",
        "Russell 2000  +0.32%",
        "Tomorrow 8:30 ET · CPI",
    ],
    "scene": ("An elegant editorial financial poster, soft paper-white background with very subtle "
              "blue-grey gradients and a faint circuit-board pattern in one corner. Large bold dark "
              "headline text at top-left. Four clean rounded white stat tiles arranged in a row, each "
              "with soft shadow; negative percentages in red (#DC2626), positive in green (#16A34A). "
              "A thin royal-blue (#165DFF) accent underline below the headline. Premium fintech "
              "aesthetic, generous whitespace, crisp sans-serif typography."),
}


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


def compile_prompt(spec: dict) -> str:
    """Claude 的'艺术指导'编译:场景 + 逐字文字清单 + 硬约束。"""
    texts = "\n".join(f'  {i+1}. "{t}"' for i, t in enumerate(spec["texts"]))
    return f"""{spec["scene"]}

The cute white robot from the reference image is the brand mascot — place it on the right side
of the composition at large size, matching its exact design (glossy white body, dark navy visor,
curved arrow antenna). Its mood already matches the scene.

HARD CONSTRAINTS (must all be satisfied):
- Render EXACTLY these text strings, character-for-character, no additions, no other words anywhere:
{texts}
- Numbers must be large and crisply legible. Do not invent any other numbers, tickers, charts or labels.
- Leave the top-left corner (about 22% width, 10% height) completely empty — a logo will be placed there later.
- No watermark, no signature, no fake UI chrome, no extra paragraphs of text.
- Palette: ink #16181D on paper white, royal blue #165DFF accents only, red #DC2626 for negatives, green #16A34A for positives."""


def composite_logo(raw: Path, out: Path) -> None:
    """真 logo 像素级覆盖到左上保留区(绝不让 AI 画 logo)。"""
    logo_svg = (ASSETS / "logo-ainvest.svg").read_text(encoding="utf-8")
    html = f"""<!doctype html><html><head><style>
      * {{margin:0;padding:0}} html,body {{width:1536px;height:1024px}}
      img.bg {{position:absolute;inset:0;width:100%;height:100%}}
      .logo {{position:absolute;top:44px;left:56px;width:210px}}
      .logo svg {{width:100%;height:auto}}
    </style></head><body>
      <img class="bg" src="file://{raw.resolve()}"/>
      <div class="logo">{logo_svg}</div>
    </body></html>"""
    tmp = Path("/tmp/ai_card_composite.html")
    tmp.write_text(html, encoding="utf-8")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--window-size=1536,1024", "--force-device-scale-factor=1.5",
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
    print(f"🎬 艺术指导编译完成({len(spec['texts'])} 条逐字文字 · 参考图 {refs[0].name})")

    raw_png = Path(f"/tmp/ai_card_{spec['slug']}_raw.png")
    ok = False
    for i in range(1, args.tries + 1):
        print(f"🖼  gpt-image-2 第 {i} 发…")
        if gen_image(prompt, refs, spec.get("size", "1536x1024"), raw_png):
            ok = True
            break
        time.sleep(45 * i)  # 节流退避
    if not ok:
        sys.exit("❌ 上游节流/不可用 —— 改用 HTML 模板(share_card.py / aime_scan_card.py)")

    out = OUT_DIR / f"AInvest_ai_{spec['slug']}_{datetime.now().strftime('%Y%m%d')}.png"
    composite_logo(raw_png, out)
    print(f"✅ {out}")
    print("⚠ 质检关:让 Claude 逐位核对图内数字 vs spec.texts —— 通过才可发,错字即重生成/降级模板。")


if __name__ == "__main__":
    main()
