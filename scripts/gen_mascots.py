"""Aime 全身姿态库生成 —— gpt-5.5 image_generation(NDT relay)→ assets/brand-ainvest/aime-{mood}.png

经实测的三条铁律(踩坑记录,别改):
  1. 这家中转 /v1/responses **只支持 stream=true**,非流式一律报 MODEL_SERVICE_UNAVAILABLE
  2. 上游**不支持透明底** → 生成纯色底,再用 scripts/cutout.swift(macOS Vision 前景蒙版)抠透明
  3. 上游**有节流**:连发会 503,姿态之间要隔 ~45s,失败退避重试

一致性:以官方 Aime 头(assets/brand-ainvest/aime-head.png,提取自 logo-aime.svg)做
img2img 参考,头部设计逐张锁定。share_card.py 检测到 aime-{mood}.png 即自动用全身、
按行情换姿势(跌=bearish 涨=bullish 平=neutral)。

用法: uv run python scripts/gen_mascots.py [--only bearish] [--force]
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
from pathlib import Path

try:
    from dotenv import load_dotenv; load_dotenv()
except Exception:
    pass

ROOT = Path(__file__).parent.parent
OUT = ROOT / "assets" / "brand-ainvest"
REF = OUT / "aime-head.png"
CUTOUT = ROOT / "scripts" / "cutout.swift"
KEY = os.environ.get("NDT_API_KEY", "")
BASE = (os.environ.get("NDT_BASE_URL") or "https://api.nadoutong.org").rstrip("/")

STYLE = ("Full body of this exact robot mascot character. Keep the head design IDENTICAL to the "
         "reference: glossy white round head, dark navy glass visor with two glowing white oval eyes, "
         "one curved silver antenna with arrow tip. Add a small matching glossy white rounded body "
         "with simple short arms and legs. Cute high-end 3D render, soft studio lighting, full body "
         "fully visible and centered, plain solid light gray background, no text, no other objects, "
         "no shadows on the ground. Pose:")

POSES = {
    "bearish": "sitting on the ground looking sad and worried, one hand touching its cheek, slumped shoulders",
    "bullish": "standing confidently pointing upward with one finger raised high, cheerful happy expression in the eyes",
    "neutral": "standing upright waving hello with one hand, friendly neutral expression",
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


def generate_raw(pose: str, out_path: Path) -> bool:
    """一次流式生成(img2img,官方头做参考)。成功返回 True。"""
    mime = mimetypes.guess_type(str(REF))[0] or "image/png"
    b64 = base64.b64encode(REF.read_bytes()).decode()
    body = {
        "model": "gpt-5.5",
        "input": [{"role": "user", "content": [
            {"type": "input_image", "image_url": f"data:{mime};base64,{b64}"},
            {"type": "input_text", "text": f"{STYLE} {pose}"},
        ]}],
        "stream": True,  # 必须:非流式一律 MODEL_SERVICE_UNAVAILABLE
        "tools": [{"type": "image_generation", "size": "1024x1024", "quality": "high", "output_format": "png"}],
        "tool_choice": "required",
    }
    req = urllib.request.Request(
        f"{BASE}/v1/responses", data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json",
                 "Accept": "text/event-stream"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            for ev in sse_events(resp):
                if ev.get("type") == "response.output_item.done":
                    item = ev.get("item", {})
                    if item.get("type") == "image_generation_call" and item.get("result"):
                        out_path.write_bytes(base64.b64decode(item["result"]))
                        return True
    except Exception as e:
        print(f"   ({type(e).__name__}: {str(e)[:90]})")
    return False


def cutout(src: Path, dst: Path) -> bool:
    r = subprocess.run(["swift", str(CUTOUT), str(src), str(dst)], capture_output=True, text=True, timeout=180)
    return r.returncode == 0 and dst.exists()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=list(POSES))
    ap.add_argument("--force", action="store_true", help="已存在也重新生成")
    args = ap.parse_args()
    if not KEY:
        sys.exit("缺 NDT_API_KEY(.env)")
    if not REF.exists():
        sys.exit(f"缺参考图 {REF}")

    todo = {args.only: POSES[args.only]} if args.only else dict(POSES)
    ok = 0
    first = True
    for mood, pose in todo.items():
        final = OUT / f"aime-{mood}.png"
        if final.exists() and not args.force:
            print(f"⏭  aime-{mood} 已存在,跳过(--force 重做)")
            ok += 1
            continue
        if not first:
            time.sleep(45)  # 节流:连发会 503
        first = False
        raw = Path(f"/tmp/aime-{mood}-raw.png")
        done = False
        for attempt in range(1, 6):
            print(f"🤖 aime-{mood} 第 {attempt} 发…")
            if generate_raw(pose, raw):
                done = True
                break
            time.sleep(45 * attempt)  # 退避
        if not done:
            print(f"   ❌ aime-{mood} 5 发全失败(上游节流/不可用)")
            continue
        if cutout(raw, final):
            print(f"   ✅ {final}  ({final.stat().st_size//1024} KB,透明底)")
            ok += 1
        else:
            print(f"   ⚠ 抠图失败,保留原图 {raw}")
    print(f"\n完成 {ok}/{len(todo)}。share_card.py 将自动按行情使用对应姿态。")
    sys.exit(0 if ok == len(todo) else 1)


if __name__ == "__main__":
    main()
