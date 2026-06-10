"""Aime 全身姿态库生成 —— gpt-image(NDT relay)→ assets/brand-ainvest/aime-{mood}.png

跑一次生成三个姿态(透明底),share_card.py 检测到就自动用全身、按行情换姿势;
没有则降级官方头部素材。relay 通道自动探测:依次试
  ① /v1/responses + image_generation 工具(OpenAI 新式)
  ② /v1/chat/completions model=gpt-image-2(中转常见挂法,返回 b64 或图 URL)
  ③ /v1/images/generations(经典端点)

用法: uv run python scripts/gen_mascots.py [--only bearish]
"""
from __future__ import annotations
import argparse
import base64
import json
import os
import re
import sys
from pathlib import Path

import requests

try:
    from dotenv import load_dotenv; load_dotenv()
except Exception:
    pass

ROOT = Path(__file__).parent.parent
OUT = ROOT / "assets" / "brand-ainvest"
KEY = os.environ.get("NDT_API_KEY", "")
BASE = os.environ.get("NDT_BASE_URL", "https://api.nadoutong.org")

# 官方 Aime 特征(照 logo-aime.svg 内嵌位图描述,保持一致性)
STYLE = ("Official mascot style: cute glossy white 3D robot, large rounded head, "
         "dark navy glass visor face with two glowing white oval eyes, one curved silver antenna "
         "with arrow tip on top of head, small white rounded body with simple arms and legs, "
         "soft studio lighting, high-end 3D render, isolated on fully transparent background, "
         "no text, no shadows on ground")

POSES = {
    "bearish": "sitting on the floor looking sad and worried, one hand touching its cheek, slumped shoulders",
    "bullish": "standing confidently and pointing upward with one finger, cheerful pose",
    "neutral": "standing upright waving hello with one hand, friendly",
}


def save_png(data: bytes, mood: str) -> None:
    p = OUT / f"aime-{mood}.png"
    p.write_bytes(data)
    print(f"   ✅ {p}  ({len(data)//1024} KB)")


def try_responses_tool(prompt: str) -> bytes | None:
    for model in ("gpt-5.5", "gpt-5.4", "gpt-5.4-mini"):
        try:
            r = requests.post(f"{BASE}/v1/responses", headers={"Authorization": f"Bearer {KEY}"},
                              json={"model": model, "input": f"Generate an image: {prompt}",
                                    "tools": [{"type": "image_generation", "size": "1024x1024",
                                               "background": "transparent"}]}, timeout=300).json()
            if r.get("error"):
                continue
            for o in r.get("output", []):
                if o.get("type") == "image_generation_call" and o.get("result"):
                    return base64.b64decode(o["result"])
        except Exception:
            continue
    return None


def try_chat_image(prompt: str) -> bytes | None:
    for model in ("gpt-image-2", "gpt-image-1", "gpt-4o-image"):
        try:
            r = requests.post(f"{BASE}/v1/chat/completions", headers={"Authorization": f"Bearer {KEY}"},
                              json={"model": model,
                                    "messages": [{"role": "user", "content": prompt}]}, timeout=300).json()
            if r.get("error"):
                continue
            content = r["choices"][0]["message"]["content"] or ""
            m = re.search(r"data:image/\w+;base64,([A-Za-z0-9+/=]+)", content)
            if m:
                return base64.b64decode(m.group(1))
            m = re.search(r"https?://\S+\.(?:png|webp|jpg)\S*", content)
            if m:
                return requests.get(m.group(0).rstrip(")>]"), timeout=120).content
        except Exception:
            continue
    return None


def try_images_endpoint(prompt: str) -> bytes | None:
    for model in ("gpt-image-2", "gpt-image-1"):
        try:
            r = requests.post(f"{BASE}/v1/images/generations", headers={"Authorization": f"Bearer {KEY}"},
                              json={"model": model, "prompt": prompt, "size": "1024x1024",
                                    "background": "transparent"}, timeout=300)
            if r.status_code != 200:
                continue
            d = r.json().get("data", [{}])[0]
            if d.get("b64_json"):
                return base64.b64decode(d["b64_json"])
            if d.get("url"):
                return requests.get(d["url"], timeout=120).content
        except Exception:
            continue
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=list(POSES), help="只生成一个姿态")
    args = ap.parse_args()
    if not KEY:
        sys.exit("缺 NDT_API_KEY(.env)")

    todo = {args.only: POSES[args.only]} if args.only else POSES
    ok = 0
    for mood, pose in todo.items():
        prompt = f"{STYLE}. Pose: {pose}."
        print(f"🤖 生成 aime-{mood} …")
        data = try_responses_tool(prompt) or try_chat_image(prompt) or try_images_endpoint(prompt)
        if data:
            save_png(data, mood)
            ok += 1
        else:
            print("   ❌ 三条通道都不可用(MODEL_NOT_AVAILABLE / SERVICE_UNAVAILABLE)——key 的图像通道还没开通")
    if ok:
        print(f"\n完成 {ok}/{len(todo)}。share_card.py 会自动改用全身姿态。")
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
