"""从 us-analyses.json 生成 scan 用的轻量五方摘要 us-panel-summary.json。

每只票:{sc: [按 masters 顺序的分数,缺的为 null], div: 分歧度(max-min)}。
scan 列表用它画"五方小圆点 + 分歧"列,不必加载 5MB 全量。

用法: python scripts/build_panel_summary.py
"""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
DB = ROOT / "web" / "public" / "data" / "us-analyses.json"
MASTERS = ROOT / "data" / "masters.json"
OUT = ROOT / "web" / "public" / "data" / "us-panel-summary.json"
BLURBS = ROOT / "web" / "public" / "data" / "us-blurbs.json"   # sym → 分歧线一句话(观察列表当描述)


def main():
    order = [m["key"] for m in sorted(json.load(open(MASTERS, encoding="utf-8"))["masters"], key=lambda x: x["order"])]
    stocks = json.load(open(DB, encoding="utf-8"))["stocks"]
    out = {}
    for sym, v in stocks.items():
        panel = v.get("panel") or {}
        sc = [panel[k]["score"] if k in panel and panel[k] else None for k in order]
        present = [x for x in sc if isinstance(x, (int, float))]
        div = (max(present) - min(present)) if len(present) >= 2 else 0
        out[sym] = {"sc": sc, "div": div}
    OUT.write_text(json.dumps({"order": order, "stocks": out}, ensure_ascii=False), encoding="utf-8")
    print(f"✓ {len(out)} 只五方摘要 → us-panel-summary.json (masters 顺序: {order})")

    # 美股一句话描述:五方分歧线截断(观察列表里 A股有 thesis、美股之前是空白 —— 2026-06-12 补齐)
    blurbs = {}
    for sym, v in stocks.items():
        d = str(v.get("divergence") or "").strip()
        if d:
            blurbs[sym] = d[:120]
    BLURBS.write_text(json.dumps(blurbs, ensure_ascii=False), encoding="utf-8")
    kb = BLURBS.stat().st_size // 1024
    print(f"✓ {len(blurbs)} 条分歧线 → us-blurbs.json({kb} KB)")


if __name__ == "__main__":
    main()
