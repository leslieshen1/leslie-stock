"""把 worker 跑完的 result_*.json 导入 SQLite analyses 表。

用法：
    # 导入某次 run 的全部结果
    uv run python -m screener.import_results --run-id 12

    # 自定义路径（如果不在 /tmp/scan_runs/）
    uv run python -m screener.import_results --run-id 12 --dir /path/to/results

每个 result_NNN.json 应该是个 dict 数组，每只一条评估结果（兼容现有 Agent 输出格式）。

每条 result dict 需要含：
- code, name
- 评估字段（按 framework 不同）：
  - Serenity: bottleneck_score / verdict / verdict_label / signals / signals_hit /
              red_flags / ai_relevance / supply_chain_layer / layer_label / thesis
  - BG:       overall_score / overall_grade / verdict / dimensions / sell_triggers
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

from db import connect
from db.api import update_run_status


def import_run(run_id: int, results_dir: Path | None = None) -> dict:
    """导入某次 run 的全部 result_*.json 到 analyses 表。

    返回统计 dict: {written, skipped, errors}.
    """
    if results_dir is None:
        results_dir = Path(f"/tmp/scan_runs/{run_id}")

    if not results_dir.exists():
        return {"error": f"目录不存在: {results_dir}"}

    # 取 run 元数据
    with connect(readonly=True) as conn:
        run = conn.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
    if not run:
        return {"error": f"run #{run_id} 不存在"}

    framework = run["framework"]
    model = run["model"] or "unknown"
    version = run["prompt_version"] or "v1"

    print(f"🔄 导入 run #{run_id} (framework={framework}, model={model})")

    # 收集所有 result 文件
    result_files = sorted(results_dir.glob("result_*.json"))
    print(f"   找到 {len(result_files)} 个 result 文件")

    if not result_files:
        return {"error": "没有 result 文件"}

    stats = {"written": 0, "skipped": 0, "errors": 0}
    now = datetime.now().isoformat()

    with connect() as conn:
        for rf in result_files:
            try:
                with open(rf, encoding="utf-8") as f:
                    items = json.load(f)
            except Exception as e:
                print(f"  ⚠ {rf.name}: 无法解析 JSON: {e}")
                stats["errors"] += 1
                continue

            for r in items:
                try:
                    code = r["code"]
                    # 自动检测 market（默认 a，特殊后缀认）
                    market = r.get("market", "a")

                    # 找 stock
                    row = conn.execute(
                        "SELECT id FROM stocks WHERE code=? AND market=?",
                        (code, market)
                    ).fetchone()
                    if not row:
                        print(f"  ⚠ {code}/{market}: stock 不在 DB")
                        stats["errors"] += 1
                        continue
                    stock_id = row["id"]

                    # 按 framework 解析评分
                    a = parse_result(framework, r)

                    # 插入 analyses 记录（新版本，不覆盖旧）
                    conn.execute("""
                        INSERT INTO analyses (
                            stock_id, framework, version, score, verdict, verdict_label,
                            layer, layer_label, thesis, signals, signals_hit,
                            red_flags, ai_relevance, bg_dimensions, bg_sell_triggers,
                            raw_response, model, pre_labeled, run_id, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        stock_id, framework, version,
                        a["score"], a["verdict"], a["verdict_label"],
                        a["layer"], a["layer_label"], a["thesis"],
                        json.dumps(a["signals"], ensure_ascii=False) if a["signals"] else None,
                        a["signals_hit"],
                        json.dumps(a["red_flags"], ensure_ascii=False) if a["red_flags"] else None,
                        a["ai_relevance"],
                        json.dumps(a["bg_dimensions"], ensure_ascii=False) if a["bg_dimensions"] else None,
                        json.dumps(a["bg_sell_triggers"], ensure_ascii=False) if a["bg_sell_triggers"] else None,
                        json.dumps(r, ensure_ascii=False)[:5000],  # raw response (truncate)
                        model,
                        0,  # 不是 pre_labeled
                        run_id,
                        now,
                    ))
                    stats["written"] += 1
                except Exception as e:
                    print(f"  ⚠ {r.get('code', '?')}: {e}")
                    stats["errors"] += 1

    # 更新 run 状态
    status = "completed" if stats["errors"] == 0 else "partial"
    update_run_status(
        run_id, status,
        completed=stats["written"],
        failed=stats["errors"],
        notes=f"imported from {results_dir.name}",
    )

    print(f"\n✅ {framework} run #{run_id} 导入完成")
    print(f"   written: {stats['written']}")
    print(f"   errors:  {stats['errors']}")
    print(f"   status:  {status}")
    return stats


def parse_result(framework: str, r: dict) -> dict:
    """按 framework 把 worker 输出标准化。"""
    out = {
        "score": None, "verdict": None, "verdict_label": None,
        "layer": None, "layer_label": None, "thesis": None,
        "signals": None, "signals_hit": None, "red_flags": None,
        "ai_relevance": None, "bg_dimensions": None, "bg_sell_triggers": None,
    }
    if framework == "serenity":
        out["score"] = r.get("bottleneck_score")
        out["verdict"] = r.get("verdict")
        out["verdict_label"] = r.get("verdict_label")
        out["layer"] = r.get("supply_chain_layer")
        out["layer_label"] = r.get("layer_label")
        out["thesis"] = r.get("thesis")
        out["signals"] = r.get("signals")
        out["signals_hit"] = r.get("signals_hit")
        out["red_flags"] = r.get("red_flags")
        out["ai_relevance"] = r.get("ai_relevance")
    elif framework == "bg":
        out["score"] = r.get("overall_score")
        out["verdict_label"] = r.get("overall_grade")
        out["verdict"] = r.get("verdict_summary") or r.get("verdict")
        out["thesis"] = r.get("verdict") or r.get("thesis")
        out["bg_dimensions"] = r.get("dimensions")
        out["bg_sell_triggers"] = r.get("sell_triggers")
    elif framework == "news":
        out["score"] = r.get("score")
        out["verdict"] = r.get("signal")
        out["thesis"] = r.get("summary")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", type=int, required=True)
    ap.add_argument("--dir", help="result 文件目录（默认 /tmp/scan_runs/{run_id}/）")
    args = ap.parse_args()

    results_dir = Path(args.dir) if args.dir else None
    stats = import_run(args.run_id, results_dir)
    if "error" in stats:
        print(f"❌ {stats['error']}")
        return


if __name__ == "__main__":
    main()
