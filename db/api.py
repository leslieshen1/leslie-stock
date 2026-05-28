"""SQLite 查询 helpers。

约定：所有读操作走 readonly connection，所有写走 read-write。
"""
from __future__ import annotations

import json
from typing import Any
from datetime import datetime, timedelta

from db import connect


# ============================================================
# 选股 filters
# ============================================================

def filter_stocks(
    framework: str = "serenity",
    score_min: int | None = None,
    score_max: int | None = None,
    stale_days: int | None = None,
    industries: list[str] | None = None,
    market: str | None = None,
    pre_labeled: bool | None = None,
    market_cap_yi_min: float | None = None,
    market_cap_yi_max: float | None = None,
    verdict_in: list[str] | None = None,
    verdict_not_in: list[str] | None = None,
    code_in: list[str] | None = None,
    limit: int | None = None,
) -> list[dict]:
    """返回符合 filter 的 stocks（含最新该 framework 评分元数据）。

    Args:
        framework: 主要看哪个 framework 的最新评分（默认 serenity）
        score_min/max: 评分范围
        stale_days: 该 framework 评分 >= N 天没更新
        pre_labeled: 是否包含批量预标（None = 都包含）
        其他: 过滤条件
    """
    where = ["1=1"]
    params: list[Any] = []
    joins = [
        "FROM stocks s",
        f"LEFT JOIN v_latest_analysis a ON s.id = a.stock_id AND a.framework = ?",
    ]
    params.append(framework)

    if score_min is not None:
        where.append("a.score >= ?")
        params.append(score_min)
    if score_max is not None:
        where.append("a.score <= ?")
        params.append(score_max)
    if stale_days is not None:
        cutoff = (datetime.now() - timedelta(days=stale_days)).isoformat()
        where.append("(a.created_at IS NULL OR a.created_at < ?)")
        params.append(cutoff)
    if market is not None:
        where.append("s.market = ?")
        params.append(market)
    if pre_labeled is not None:
        where.append("a.pre_labeled = ?")
        params.append(1 if pre_labeled else 0)
    if market_cap_yi_min is not None:
        where.append("s.market_cap >= ?")
        params.append(market_cap_yi_min * 1e8)
    if market_cap_yi_max is not None:
        where.append("s.market_cap <= ?")
        params.append(market_cap_yi_max * 1e8)
    if verdict_in:
        placeholders = ",".join(["?"] * len(verdict_in))
        where.append(f"a.verdict IN ({placeholders})")
        params.extend(verdict_in)
    if verdict_not_in:
        placeholders = ",".join(["?"] * len(verdict_not_in))
        where.append(f"(a.verdict IS NULL OR a.verdict NOT IN ({placeholders}))")
        params.extend(verdict_not_in)
    if industries:
        # JSON contains 任一 industry
        conds = []
        for ind in industries:
            conds.append("s.industries LIKE ?")
            params.append(f"%\"{ind}\"%")
        where.append("(" + " OR ".join(conds) + ")")
    if code_in:
        placeholders = ",".join(["?"] * len(code_in))
        where.append(f"s.code IN ({placeholders})")
        params.extend(code_in)

    sql = f"""
        SELECT s.id, s.code, s.market, s.name, s.market_cap, s.sector,
               s.pe_ttm, s.pb, s.industries,
               a.score, a.verdict, a.verdict_label, a.layer,
               a.created_at as last_scored, a.pre_labeled
        {" ".join(joins)}
        WHERE {" AND ".join(where)}
        ORDER BY COALESCE(a.score, 0) DESC, s.market_cap DESC
    """
    if limit:
        sql += f" LIMIT {int(limit)}"

    with connect(readonly=True) as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


# ============================================================
# Run management
# ============================================================

def create_run(framework: str, scope: str, filter_json: dict, model: str,
               prompt_version: str, total_targets: int) -> int:
    with connect() as conn:
        cur = conn.execute(
            """INSERT INTO runs (framework, scope, filter_json, status,
               total_targets, started_at, model, prompt_version)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (framework, scope, json.dumps(filter_json, ensure_ascii=False),
             "pending", total_targets, datetime.now().isoformat(),
             model, prompt_version)
        )
        return cur.lastrowid


def update_run_status(run_id: int, status: str,
                      completed: int | None = None,
                      failed: int | None = None,
                      cost_usd: float | None = None,
                      input_tokens: int | None = None,
                      output_tokens: int | None = None,
                      notes: str | None = None):
    parts = ["status = ?"]
    params = [status]
    if completed is not None:
        parts.append("completed = ?")
        params.append(completed)
    if failed is not None:
        parts.append("failed = ?")
        params.append(failed)
    if cost_usd is not None:
        parts.append("cost_usd = ?")
        params.append(cost_usd)
    if input_tokens is not None:
        parts.append("input_tokens = ?")
        params.append(input_tokens)
    if output_tokens is not None:
        parts.append("output_tokens = ?")
        params.append(output_tokens)
    if notes is not None:
        parts.append("notes = ?")
        params.append(notes)
    if status in ("completed", "failed", "partial"):
        parts.append("completed_at = ?")
        params.append(datetime.now().isoformat())
    params.append(run_id)
    with connect() as conn:
        conn.execute(f"UPDATE runs SET {', '.join(parts)} WHERE id = ?", params)


# ============================================================
# 成本估算
# ============================================================

# 主流 model pricing（$/M tokens, 2026 mid 数据）
MODEL_PRICING = {
    "claude-sonnet-4.5":  {"input": 3.00, "output": 15.00},
    "claude-haiku-4":     {"input": 0.25, "output": 1.25},
    "claude-opus-4":      {"input": 15.00, "output": 75.00},
    "gpt-4o":             {"input": 2.50, "output": 10.00},
    "gpt-4o-mini":        {"input": 0.15, "output": 0.60},
    "deepseek-chat":      {"input": 0.14, "output": 0.28},
    "deepseek-reasoner":  {"input": 0.55, "output": 2.19},
    "glm-5.1":            {"input": 0.10, "output": 0.40},
}


def estimate_cost(
    n_targets: int,
    model: str = "claude-sonnet-4.5",
    input_tokens_per_target: int = 800,
    output_tokens_per_target: int = 700,
) -> dict:
    """估算评分 N 个 target 的成本。

    每 target 默认假设：
    - 输入：~800 tokens（prompt + 公司数据）
    - 输出：~700 tokens（完整 7 信号 + thesis + signals）
    """
    pricing = MODEL_PRICING.get(model, MODEL_PRICING["claude-sonnet-4.5"])
    in_tok = n_targets * input_tokens_per_target
    out_tok = n_targets * output_tokens_per_target
    cost = (in_tok / 1_000_000) * pricing["input"] + (out_tok / 1_000_000) * pricing["output"]
    return {
        "n_targets": n_targets,
        "model": model,
        "input_tokens": in_tok,
        "output_tokens": out_tok,
        "total_tokens": in_tok + out_tok,
        "cost_usd": round(cost, 2),
        "cost_per_target_usd": round(cost / n_targets, 4) if n_targets else 0,
    }
