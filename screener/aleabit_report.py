"""扫描完成后生成汇总报告。

从 data/analyses/*.json 提取所有有 aleabit 字段的标的，按 bottleneck_score 排序，
按 verdict 分组输出 markdown 报告。

用法：
  uv run python -m screener.aleabit_report                 # 全部
  uv run python -m screener.aleabit_report --min-score 70  # 只看 >= 70 的
  uv run python -m screener.aleabit_report --top 30        # 只看 top 30
  uv run python -m screener.aleabit_report --md report.md  # 写到文件
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
ANALYSES_DIR = ROOT / "data" / "analyses"


VERDICT_ORDER = [
    ("high_conviction", "🎯 High Conviction"),
    ("aleabit_analogue", "🪞 Aleabit Analogue"),
    ("worth_watching", "💎 Worth Watching"),
    ("macro_tailwind", "🌊 Macro Tailwind"),
    ("crowded_but_valid", "🚦 Crowded but Valid"),
    ("not_aleabit_territory", "❌ Not Aleabit Territory"),
]


def collect():
    items = []
    for p in ANALYSES_DIR.glob("*_a.json"):
        try:
            with open(p, encoding="utf-8") as f:
                data = json.load(f)
            a = data.get("aleabit")
            if not a:
                continue
            items.append({
                "code": data["code"],
                "name": data.get("name", "—"),
                "mcap_yi": (data.get("raw_quote", {}).get("market_cap") or 0) / 1e8,
                "sector": data.get("sector", ""),
                "score": a.get("bottleneck_score", 0),
                "verdict": a.get("verdict", "unknown"),
                "verdict_label": a.get("verdict_label", ""),
                "layer": a.get("supply_chain_layer"),
                "layer_label": a.get("layer_label", ""),
                "signals_hit": a.get("signals_hit", 0),
                "thesis": a.get("thesis", ""),
                "red_flags": a.get("red_flags", []),
                "ai_relevance": a.get("ai_relevance", ""),
            })
        except Exception:
            continue
    return items


def render(items, min_score=0, top=0):
    items = [x for x in items if x["score"] >= min_score]
    items.sort(key=lambda x: -x["score"])
    if top > 0:
        items = items[:top]

    lines = []
    lines.append(f"# Serenity 瓶颈狙击 · A 股扫描报告")
    lines.append("")
    lines.append(f"扫描候选：{len(items)} 只（score >= {min_score}）")
    lines.append("")

    # 按 verdict 分组
    groups: dict[str, list] = {}
    for x in items:
        groups.setdefault(x["verdict"], []).append(x)

    for verdict, label in VERDICT_ORDER:
        lst = groups.get(verdict)
        if not lst:
            continue
        lines.append(f"## {label}（{len(lst)} 只）")
        lines.append("")
        lines.append("| 代码 | 名称 | 市值 | Layer | Score | 信号 | Thesis |")
        lines.append("|---|---|---|---|---|---|---|")
        for x in lst:
            thesis_short = (x["thesis"][:80] + "…") if len(x["thesis"]) > 80 else x["thesis"]
            thesis_short = thesis_short.replace("\n", " ").replace("|", "\\|")
            layer_disp = f"L{x['layer']}" if x["layer"] else "—"
            lines.append(
                f"| {x['code']} | {x['name']} | {x['mcap_yi']:.0f}亿 | {layer_disp} | "
                f"**{x['score']}** | {x['signals_hit']}/7 | {thesis_short} |"
            )
        lines.append("")

    # 高分股详情（top 10）
    if items:
        lines.append("---")
        lines.append("")
        lines.append("## 🏆 Top 10 详情")
        lines.append("")
        for x in items[:10]:
            lines.append(f"### {x['name']} ({x['code']}) · {x['score']}/100")
            lines.append("")
            lines.append(f"- **Verdict**：{x['verdict_label']}")
            lines.append(f"- **Layer**：{x['layer_label']}")
            lines.append(f"- **市值**：{x['mcap_yi']:.0f} 亿 RMB")
            lines.append(f"- **板块**：{x['sector']}")
            lines.append(f"- **信号命中**：{x['signals_hit']}/7")
            lines.append("")
            lines.append(f"**Thesis**：{x['thesis']}")
            lines.append("")
            if x["red_flags"]:
                lines.append("**Red Flags**：")
                for f in x["red_flags"]:
                    lines.append(f"- {f}")
                lines.append("")
            if x["ai_relevance"]:
                lines.append(f"**AI 关联**：{x['ai_relevance']}")
                lines.append("")
            lines.append("---")
            lines.append("")

    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-score", type=int, default=0, help="最低分数过滤")
    ap.add_argument("--top", type=int, default=0, help="只输出 top N")
    ap.add_argument("--md", default="", help="写入 markdown 文件路径")
    args = ap.parse_args()

    items = collect()
    print(f"已分析 {len(items)} 只股票（含 aleabit 字段）")
    print()

    if not items:
        print("没有任何 aleabit 数据。先运行：uv run python -m screener.aleabit_scan")
        return

    md = render(items, min_score=args.min_score, top=args.top)

    if args.md:
        Path(args.md).write_text(md, encoding="utf-8")
        print(f"✅ 报告写入 {args.md}")
    else:
        print(md)


if __name__ == "__main__":
    main()
