"""增量 Scan 引擎 v2 (基于 SQLite SoT)。

特点：
- 不直接执行 LLM 调用，默认 dry-run
- filter 选 targets，估算 cost
- 切 batch 写到 /tmp/scan_runs/{run_id}/
- 用户决定怎么真跑（spawn agent / API / manual）

用法：
    # 找出 30 天没动的 Serenity 评分（dry-run，看成本）
    uv run python -m screener.scan_v2 \
        --framework serenity \
        --stale-days 30

    # 跑分数 55-65 边缘的（小盘 sweet spot）
    uv run python -m screener.scan_v2 \
        --framework serenity \
        --score-min 55 --score-max 65 \
        --market-cap-yi-min 30 --market-cap-yi-max 500

    # 为 60+ 的 698 只跑 BG 评分
    uv run python -m screener.scan_v2 \
        --framework bg \
        --baseline-framework serenity \
        --baseline-score-min 60 \
        --baseline-pre-labeled false

    # 只跑某些 code（指定列表）
    uv run python -m screener.scan_v2 \
        --framework serenity \
        --codes 601899,600301,002389

    # --execute 才真切 batch + 写 run 表
    uv run python -m screener.scan_v2 ... --execute --batch-size 25

输出（execute 模式）：
- runs 表新增 pending 记录
- /tmp/scan_runs/{run_id}/batch_001.json ... — 给 worker 用
- /tmp/scan_runs/{run_id}/plan.json — run 计划元数据
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from db import connect
from db.api import filter_stocks, estimate_cost, create_run


def parse_args():
    ap = argparse.ArgumentParser(description="Leslie-stock Scan v2 (SQLite-based)")
    ap.add_argument("--framework", required=True,
                    choices=["serenity", "bg", "news"],
                    help="要跑的评分框架")

    # Target filter（看自己 framework 的最新评分）
    ap.add_argument("--score-min", type=int, help="该 framework 最低分")
    ap.add_argument("--score-max", type=int, help="该 framework 最高分")
    ap.add_argument("--stale-days", type=int, help="该 framework 评分 >= N 天没更新")
    ap.add_argument("--pre-labeled", choices=["true", "false"],
                    help="是否含批量预标（默认都含）")
    ap.add_argument("--market", choices=["a", "hk", "us"], help="市场过滤")
    ap.add_argument("--market-cap-yi-min", type=float, help="市值最低（亿）")
    ap.add_argument("--market-cap-yi-max", type=float, help="市值最高（亿）")
    ap.add_argument("--industries", help="逗号分隔的 industry tags")
    ap.add_argument("--codes", help="逗号分隔的 code list（仅跑这些）")
    ap.add_argument("--limit", type=int, help="最多 N 只")

    # Baseline filter（用另一个 framework 的评分筛 targets）
    ap.add_argument("--baseline-framework", help="参考另一个 framework 选 targets")
    ap.add_argument("--baseline-score-min", type=int)
    ap.add_argument("--baseline-score-max", type=int)
    ap.add_argument("--baseline-pre-labeled", choices=["true", "false"])
    ap.add_argument("--baseline-verdict-not-in", help="排除某些 verdict")

    # Execution
    ap.add_argument("--model", default="claude-sonnet-4.5",
                    help="估算用的 model 定价")
    ap.add_argument("--batch-size", type=int, default=25,
                    help="每 batch 多少只（默认 25）")
    ap.add_argument("--max-budget-usd", type=float,
                    help="预算上限（超出报错，不创建 run）")
    ap.add_argument("--execute", action="store_true",
                    help="真切 batches + 写 runs 表（默认 dry-run）")
    ap.add_argument("--scope", default="",
                    help="给 run 起的名字（如 'edge_55_65_2025_W22'）")

    return ap.parse_args()


def main():
    args = parse_args()

    # Build filter
    code_in = None
    if args.codes:
        code_in = [c.strip() for c in args.codes.split(",") if c.strip()]

    industries = None
    if args.industries:
        industries = [i.strip() for i in args.industries.split(",") if i.strip()]

    pre_labeled = None
    if args.pre_labeled == "true": pre_labeled = True
    if args.pre_labeled == "false": pre_labeled = False

    # 如果用 baseline framework，先用 baseline 筛
    if args.baseline_framework:
        baseline_pre = None
        if args.baseline_pre_labeled == "true": baseline_pre = True
        if args.baseline_pre_labeled == "false": baseline_pre = False
        baseline_not_in = None
        if args.baseline_verdict_not_in:
            baseline_not_in = [v.strip() for v in args.baseline_verdict_not_in.split(",")]

        baseline_targets = filter_stocks(
            framework=args.baseline_framework,
            score_min=args.baseline_score_min,
            score_max=args.baseline_score_max,
            pre_labeled=baseline_pre,
            verdict_not_in=baseline_not_in,
        )
        code_in = [t["code"] for t in baseline_targets]
        print(f"📌 baseline ({args.baseline_framework}): {len(code_in)} 只匹配 → 作为 target")

    targets = filter_stocks(
        framework=args.framework,
        score_min=args.score_min,
        score_max=args.score_max,
        stale_days=args.stale_days,
        industries=industries,
        market=args.market,
        pre_labeled=pre_labeled,
        market_cap_yi_min=args.market_cap_yi_min,
        market_cap_yi_max=args.market_cap_yi_max,
        code_in=code_in,
        limit=args.limit,
    )

    print()
    print("=" * 60)
    print(f"📊 Scan 计划：framework={args.framework}")
    print("=" * 60)
    print(f"  filter:")
    if args.score_min is not None: print(f"    score >= {args.score_min}")
    if args.score_max is not None: print(f"    score <= {args.score_max}")
    if args.stale_days: print(f"    stale >= {args.stale_days} 天")
    if args.market: print(f"    market = {args.market}")
    if args.market_cap_yi_min: print(f"    mcap >= {args.market_cap_yi_min} 亿")
    if args.market_cap_yi_max: print(f"    mcap <= {args.market_cap_yi_max} 亿")
    if pre_labeled is not None: print(f"    pre_labeled = {pre_labeled}")
    if code_in: print(f"    code_in = {len(code_in)} 只")
    print()
    print(f"  匹配 targets: {len(targets)}")

    if not targets:
        print("\n❌ 没有匹配的 targets，结束")
        return

    # 显示样本
    print("\n  样本（前 5）:")
    for t in targets[:5]:
        score = t.get("score") if t.get("score") is not None else "—"
        print(f"    {t['code']} {t['name']:<14}  score={score}  {t.get('verdict', '')}")
    if len(targets) > 5:
        print(f"    ... 还有 {len(targets) - 5} 只")

    # Cost estimate
    cost = estimate_cost(len(targets), model=args.model)
    print()
    print(f"💰 成本预估 ({args.model}):")
    print(f"  Input tokens:  {cost['input_tokens']:,}")
    print(f"  Output tokens: {cost['output_tokens']:,}")
    print(f"  Cost:          ${cost['cost_usd']}")
    print(f"  Per target:    ${cost['cost_per_target_usd']}")

    if args.max_budget_usd and cost["cost_usd"] > args.max_budget_usd:
        print(f"\n❌ 超出预算 ${args.max_budget_usd}，aborting")
        sys.exit(1)

    if not args.execute:
        print()
        print("🔍 Dry-run 模式，未真执行")
        print("   加 --execute 创建 runs 记录 + 切 batches")
        return

    # 真切 batches + 写 run
    scope = args.scope or f"{args.framework}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    filter_json = {k: v for k, v in vars(args).items() if v is not None and k != "execute"}

    run_id = create_run(
        framework=args.framework,
        scope=scope,
        filter_json=filter_json,
        model=args.model,
        prompt_version="v1",
        total_targets=len(targets),
    )

    print(f"\n✅ 创建 run #{run_id}（scope={scope}）")

    # 切 batches
    out_dir = Path(f"/tmp/scan_runs/{run_id}")
    out_dir.mkdir(parents=True, exist_ok=True)

    batches = [
        targets[i : i + args.batch_size]
        for i in range(0, len(targets), args.batch_size)
    ]
    for i, batch in enumerate(batches, 1):
        # 只导出 LLM 需要的字段
        batch_data = [{
            "code": t["code"],
            "name": t["name"],
            "market": t["market"],
            "market_cap_yi": round(t["market_cap"] / 1e8, 1) if t["market_cap"] else None,
            "pe_ttm": t["pe_ttm"],
            "pb": t["pb"],
            "sector": t["sector"],
            "industries": json.loads(t["industries"]) if t["industries"] else [],
        } for t in batch]
        (out_dir / f"batch_{i:03d}.json").write_text(
            json.dumps(batch_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # 写 plan.json
    plan = {
        "run_id": run_id,
        "framework": args.framework,
        "scope": scope,
        "model": args.model,
        "total_targets": len(targets),
        "batches": len(batches),
        "batch_size": args.batch_size,
        "estimated_cost_usd": cost["cost_usd"],
        "created_at": datetime.now().isoformat(),
        "filter": filter_json,
    }
    (out_dir / "plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"   {len(batches)} batches × {args.batch_size} 只 → {out_dir}")
    print()
    print(f"📋 next：")
    print(f"   1. 检查 plan: cat {out_dir}/plan.json")
    print(f"   2. spawn agent / call API 跑 batches/*")
    print(f"   3. 用 screener/import_results.py 写回 SQLite")


if __name__ == "__main__":
    main()
