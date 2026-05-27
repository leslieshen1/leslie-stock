"""把所有 data/analyses/*_a.json 的 aleabit 字段聚合到单个 manifest 文件。
/scan 页面只读 manifest，避免读 5,000+ 个小 JSON。
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
ANALYSES_DIR = ROOT / "data" / "analyses"
MANIFEST_PATH = ROOT / "data" / "aleabit_manifest.json"


def main():
    records = []
    for p in ANALYSES_DIR.glob("*.json"):
        try:
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
        except Exception:
            continue

        a = d.get("aleabit")
        if not a:
            continue

        mcap = d.get("raw_quote", {}).get("market_cap")
        mcap_yi = (mcap / 1e8) if mcap else None

        thesis = a.get("thesis", "")
        if len(thesis) > 120:
            thesis = thesis[:120] + "…"

        records.append({
            "code": d["code"],
            "name": d.get("name", ""),
            "market": d.get("market", "a"),
            "market_cap_yi": round(mcap_yi, 1) if mcap_yi else None,
            "sector": d.get("sector", ""),
            "layer": a.get("supply_chain_layer"),
            "score": a.get("bottleneck_score", 0),
            "verdict": a.get("verdict", "unknown"),
            "verdict_label": a.get("verdict_label", ""),
            "signals_hit": a.get("signals_hit", 0),
            "thesis": thesis,
            "pre_labeled": bool(a.get("pre_labeled", False)),
            "has_full_analysis": d.get("overall_score", 0) > 0,
        })

    # 排序：先按 score 降序
    records.sort(key=lambda x: (-x["score"], -(x.get("market_cap_yi") or 0)))

    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=1)

    # 统计
    from collections import Counter
    verdicts = Counter(r["verdict"] for r in records)
    score_buckets = Counter()
    for r in records:
        s = r["score"]
        if s >= 70:
            score_buckets["70+"] += 1
        elif s >= 60:
            score_buckets["60-69"] += 1
        elif s >= 50:
            score_buckets["50-59"] += 1
        elif s >= 40:
            score_buckets["40-49"] += 1
        elif s >= 20:
            score_buckets["20-39"] += 1
        else:
            score_buckets["<20"] += 1

    print(f"✅ Manifest 写入 {MANIFEST_PATH}")
    print(f"   总记录：{len(records)} 只")
    print()
    print(f"分数分布：")
    for b in ["70+", "60-69", "50-59", "40-49", "20-39", "<20"]:
        print(f"  {b:<8}: {score_buckets[b]} 只")
    print()
    print(f"Verdict 分布：")
    for v, n in verdicts.most_common():
        print(f"  {n:>5}  {v}")


if __name__ == "__main__":
    main()
