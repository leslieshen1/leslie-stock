"""Migration: 给现有 DB 加 market_archetype + lifecycle_stage 字段，
并回填所有 stocks 的 archetype，给 002428/688122 两只样板票注入完整 archetype 判读。

底层思想（不在前端做文字标签）:
  A 股 = meme game（单边/无对手盘/题材生命周期定价）
  美股 = contract game（双边/对手盘/正和）
  港股 = semi-meme

用法: uv run python -m scripts.migrate_archetype
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime

from db import connect
from research.archetype import (
    archetype_for_market, structural_red_flags, lifecycle_meta,
)


def _column_exists(conn: sqlite3.Connection, table: str, col: str) -> bool:
    cols = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(c["name"] == col for c in cols)


def migrate_schema(conn: sqlite3.Connection):
    """ALTER TABLE 加字段（幂等）。"""
    if not _column_exists(conn, "stocks", "market_archetype"):
        conn.execute("ALTER TABLE stocks ADD COLUMN market_archetype TEXT")
        print("  ✓ stocks.market_archetype 已加")
    else:
        print("  - stocks.market_archetype 已存在")

    for col in ["lifecycle_stage", "archetype_read"]:
        if not _column_exists(conn, "analyses", col):
            conn.execute(f"ALTER TABLE analyses ADD COLUMN {col} TEXT")
            print(f"  ✓ analyses.{col} 已加")
        else:
            print(f"  - analyses.{col} 已存在")


def backfill_archetype(conn: sqlite3.Connection):
    """所有 stocks 按 market 回填 archetype。"""
    rows = conn.execute("SELECT id, market FROM stocks").fetchall()
    n = 0
    for r in rows:
        arch = archetype_for_market(r["market"])
        conn.execute("UPDATE stocks SET market_archetype=? WHERE id=?", (arch, r["id"]))
        n += 1
    print(f"  ✓ 回填 {n} 只 stocks 的 archetype")
    # 统计
    for arch in ["meme", "contract", "semi_meme"]:
        c = conn.execute("SELECT COUNT(*) AS c FROM stocks WHERE market_archetype=?", (arch,)).fetchone()["c"]
        print(f"     {arch}: {c} 只")


# 两只样板票的 archetype 判读（meme game 视角）
SAMPLE_READS = {
    "002428": {
        "lifecycle_stage": "markup",
        "archetype_read": {
            "archetype": "meme",
            "lifecycle_stage": "markup",
            "stage_note": "拉升中后段：InP 题材已讲开（出口管制 2025-02 起点 + 鑫耀扭亏兑现），卖方研报跟进，但扩产 catalyst 2027-10 才达产，故事还能续",
            "main_force": "北向资金 + 游资（待接入龙虎榜 / top_inst 验证）",
            "distribution_risk": "PB 39.8 高位，当前估值靠题材预期支撑而非业绩；无对手盘，一旦 InP 题材熄火或扩产证伪，单边下杀无空头托底",
            "continuity_risk": "涨停板 → 利空时一字跌停，流动性瞬间归零，散户出不掉",
            "stance": "持有但警惕拥挤度；接近派发期前需盯北向 + 换手率分位",
        },
    },
    "688122": {
        "lifecycle_stage": "ignition",
        "archetype_read": {
            "archetype": "meme",
            "lifecycle_stage": "ignition",
            "stage_note": "发车初期：核聚变题材 2025-12 招标点燃，但 2026 拐点未兑现（H2 已失速 + miss 卖方 25%），题材确立度低于 002428",
            "main_force": "机构 + 核聚变主题资金",
            "distribution_risk": "题材（13 亿招标 / ITER 交付）2026 才落地，若兑现不及预期则发车失败回落；控股股东已减持 0.96%（meme 顶部前的主力撤退信号）",
            "continuity_risk": "涨停板 + 军工保密客户，信息不透明，散户无法独立验证需求",
            "stance": "等 2026 Q1/Q2 业绩验证发车是否确立，再决定加仓；现在是观察期",
        },
    },
}


def inject_sample_reads(conn: sqlite3.Connection):
    """给两只样板票的最新版注入 lifecycle_stage + archetype_read + 结构性 red_flags。"""
    for code, payload in SAMPLE_READS.items():
        stock = conn.execute(
            "SELECT id, market FROM stocks WHERE code=? AND market='a'", (code,)
        ).fetchone()
        if not stock:
            print(f"  ⚠ {code} 不在 DB")
            continue
        stock_id = stock["id"]
        # 找最新 serenity 版本
        latest = conn.execute("""
            SELECT id, red_flags FROM analyses
            WHERE stock_id=? AND framework='serenity'
            ORDER BY created_at DESC LIMIT 1
        """, (stock_id,)).fetchone()
        if not latest:
            print(f"  ⚠ {code} 没有 serenity 分析")
            continue

        # 合并结构性 red_flags（meme game 天生风险）到现有 red_flags 前面，去重
        existing = json.loads(latest["red_flags"]) if latest["red_flags"] else []
        struct = structural_red_flags("meme")
        merged = struct + [f for f in existing if f not in struct]

        conn.execute("""
            UPDATE analyses
            SET lifecycle_stage=?, archetype_read=?, red_flags=?
            WHERE id=?
        """, (
            payload["lifecycle_stage"],
            json.dumps(payload["archetype_read"], ensure_ascii=False),
            json.dumps(merged, ensure_ascii=False),
            latest["id"],
        ))
        stage_label = lifecycle_meta(payload["lifecycle_stage"]).get("label", "")
        print(f"  ✓ {code}: lifecycle={payload['lifecycle_stage']}({stage_label}) + {len(struct)} 条结构性 red_flag")


def main():
    print("🔧 Market Archetype migration\n")
    with connect(readonly=False) as conn:
        print("1. Schema:")
        migrate_schema(conn)
        print("\n2. 回填 archetype:")
        backfill_archetype(conn)
        print("\n3. 样板票 archetype 判读:")
        inject_sample_reads(conn)
        conn.commit()
    print("\n✅ 完成")


if __name__ == "__main__":
    main()
