"""导出待四方判读的 A 股(市值≥50亿 RMB)→ /tmp/a_panel_todo.json。
保留现有 Serenity(manifest 里的 score/verdict_label/thesis 作上下文 + 后续合并),
workflow 只生成 巴菲特/段永平/德鲁肯米勒/情绪 四方。
用法: uv run python scripts/export_a_panel_todo.py [--min 50]
"""
from __future__ import annotations
import argparse, json
from pathlib import Path

ROOT = Path(__file__).parent.parent
MAN = ROOT / "web" / "public" / "data" / "aleabit_manifest.json"
OUT = Path("/tmp/a_panel_todo.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min", type=float, default=50.0, help="市值下限(亿 RMB)")
    args = ap.parse_args()

    man = json.loads(MAN.read_text(encoding="utf-8"))
    rows = []
    for x in man:
        cap = x.get("market_cap_yi") or 0
        if cap < args.min:
            continue
        rows.append({
            "code": x["code"], "name": x["name"], "cap": round(cap, 1),
            "sector": x.get("sector", ""), "layer": x.get("layer"),
            "concepts": (x.get("concepts") or [])[:8],
            "ser_score": x.get("score"),
            "ser_verdict": x.get("verdict_label", ""),
            "ser_thesis": (x.get("thesis") or "")[:300],
        })
    rows.sort(key=lambda r: -r["cap"])          # 大市值优先
    OUT.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print(f"✅ {OUT} — {len(rows)} 只 A 股(≥{args.min}亿)")
    print("   样本:", ", ".join(f"{r['name']}({r['cap']:.0f}亿)" for r in rows[:6]))


if __name__ == "__main__":
    main()
