"""把 excluded + unknown 的 ~5,263 只 A 股批量预标 not_aleabit_territory。

写入 data/analyses/{code}_a.json，只填 aleabit 字段（最小结构）。
0 LLM 成本，纯本地脚本。
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
ANALYSES_DIR = ROOT / "data" / "analyses"
EXCLUDED_PATH = ROOT / "data" / "aleabit_excluded.json"
UNKNOWN_PATH = ROOT / "data" / "aleabit_unknown.json"

NOW = datetime.now().isoformat()


def make_minimal_aleabit(reason: str) -> dict:
    """生成 not_aleabit_territory 的最小 aleabit 字段。"""
    return {
        "supply_chain_layer": None,
        "layer_label": "N/A — 不在 AI capex 供应链",
        "bottleneck_score": 5,
        "verdict": "not_aleabit_territory",
        "verdict_label": "❌ 不在射程",
        "thesis": "Not in Serenity's AI capex supply chain universe. Pass.",
        "signals": [
            {"name": "供应链汇聚", "hit": "no", "note": "不在 AI / 半导体供应链"},
            {"name": "材料价格 ATH", "hit": "no", "note": "无关"},
            {"name": "分析师覆盖率 < 3", "hit": "no", "note": "未评估"},
            {"name": "技术深度门槛", "hit": "no", "note": "未评估"},
            {"name": "政府/国防关联", "hit": "no", "note": "无"},
            {"name": "CEO 二级市场买入", "hit": "no", "note": "未评估"},
            {"name": "小盘 + 关键产能", "hit": "no", "note": "未评估"},
        ],
        "signals_hit": 0,
        "red_flags": [reason],
        "ai_relevance": "—",
        "updated_at": NOW,
        "pre_labeled": True,  # 标记为批量预标，区别于 LLM 真实评估
    }


def make_minimal_record(item: dict, aleabit_field: dict) -> dict:
    """生成最小的 data/analyses/{code}_a.json 结构。"""
    return {
        "code": item["code"],
        "name": item["name"],
        "market": "a",
        "industry": None,
        "sector": "",
        "concepts": [],
        "overall_score": 0,
        "overall_grade": "—",
        "verdict": "（批量预标，未做段巴 BG 评估）",
        "llm_used": False,
        "llm_model": "pre-label",
        "dimensions": {
            k: {"score": 0, "grade": "—", "details": [], "flags": []}
            for k in ["business_model", "moat", "management", "financials", "valuation", "circle"]
        },
        "raw_quote": {
            "code": item["code"],
            "name": item["name"],
            "market_cap": (item.get("market_cap_yi") or 0) * 1e8 if item.get("market_cap_yi") else None,
            "pe_ttm": item.get("pe_ttm"),
            "pb": item.get("pb"),
        },
        "sell_triggers": [],
        "aleabit": aleabit_field,
        "updated_at": NOW,
    }


def main():
    with open(EXCLUDED_PATH, encoding="utf-8") as f:
        excluded = json.load(f)
    with open(UNKNOWN_PATH, encoding="utf-8") as f:
        unknown = json.load(f)

    print(f"📊 待处理：excluded={len(excluded)}, unknown={len(unknown)}")
    print(f"   合计：{len(excluded) + len(unknown)} 只")
    print()

    written = 0
    skipped = 0

    # excluded
    for item in excluded:
        code = item["code"]
        p = ANALYSES_DIR / f"{code}_a.json"
        # 如果已有真实 aleabit 评估（非 pre_labeled），跳过
        if p.exists():
            try:
                with open(p, encoding="utf-8") as f:
                    existing = json.load(f)
                if existing.get("aleabit") and not existing["aleabit"].get("pre_labeled"):
                    skipped += 1
                    continue
            except Exception:
                pass

        aleabit = make_minimal_aleabit(item.get("reason", "明显不在 AI 供应链射程"))
        record = make_minimal_record(item, aleabit)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)
        written += 1

    # unknown
    for item in unknown:
        code = item["code"]
        p = ANALYSES_DIR / f"{code}_a.json"
        if p.exists():
            try:
                with open(p, encoding="utf-8") as f:
                    existing = json.load(f)
                if existing.get("aleabit") and not existing["aleabit"].get("pre_labeled"):
                    skipped += 1
                    continue
            except Exception:
                pass

        aleabit = make_minimal_aleabit("名称无 AI / 半导体 / 制造关键词")
        record = make_minimal_record(item, aleabit)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)
        written += 1

    print(f"✅ 完成：写入 {written}，跳过 {skipped}（已有真实 LLM 评估）")


if __name__ == "__main__":
    main()
