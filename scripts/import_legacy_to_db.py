"""把 data/analyses_v1/*.json 全部导入 SQLite。

import 策略：
- 每只股票一条 stocks 记录
- 每个 aleabit 字段一条 analyses 记录（framework='serenity', version='v1'）
- 如果 overall_score > 0，再加一条 analyses 记录（framework='bg', version='v1'）
- 一次性 run 记录追溯：runs(framework='legacy_import', ...)

幂等：重复运行会跳过已存在的（按 stock+framework+version 唯一）
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from db import connect, DB_PATH

ROOT = Path(__file__).parent.parent
LEGACY_DIR = ROOT / "data" / "analyses_v1"
NOW = datetime.now().isoformat()


def upsert_stock(conn, code: str, market: str, name: str, raw_quote: dict | None,
                 sector: str | None, industries: list | None) -> int:
    """插入或更新 stock，返回 stock_id。"""
    mcap = (raw_quote or {}).get("market_cap")
    pe = (raw_quote or {}).get("pe_ttm")
    pb = (raw_quote or {}).get("pb")
    mcap_usd = (mcap / 7.2) if (market == "a" or market == "hk") and mcap else mcap

    # 检查是否已存在
    row = conn.execute(
        "SELECT id FROM stocks WHERE code=? AND market=?", (code, market)
    ).fetchone()
    if row:
        # 更新
        conn.execute(
            """UPDATE stocks SET name=?, sector=?, market_cap=?, market_cap_usd=?,
               pe_ttm=?, pb=?, industries=?, updated_at=?
               WHERE id=?""",
            (name, sector, mcap, mcap_usd, pe, pb,
             json.dumps(industries) if industries else None, NOW, row["id"])
        )
        return row["id"]
    # 插入
    cur = conn.execute(
        """INSERT INTO stocks (code, market, name, sector, market_cap, market_cap_usd,
           pe_ttm, pb, industries, first_seen_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (code, market, name, sector, mcap, mcap_usd, pe, pb,
         json.dumps(industries) if industries else None, NOW, NOW)
    )
    return cur.lastrowid


def insert_analysis(conn, stock_id: int, framework: str, version: str,
                    data: dict, run_id: int | None = None) -> int | None:
    """插入一条 analyses 记录。"""
    # 检查是否已存在（同 stock + framework + version + pre_labeled）
    pre_labeled = 1 if data.get("pre_labeled") else 0
    row = conn.execute(
        """SELECT id FROM analyses
           WHERE stock_id=? AND framework=? AND version=? AND pre_labeled=?""",
        (stock_id, framework, version, pre_labeled)
    ).fetchone()
    if row:
        return None  # 已存在，跳过

    cur = conn.execute(
        """INSERT INTO analyses (
            stock_id, framework, version, score, verdict, verdict_label,
            layer, layer_label, thesis, signals, signals_hit, red_flags,
            ai_relevance, bg_dimensions, bg_sell_triggers,
            model, pre_labeled, run_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            stock_id, framework, version,
            data.get("score"),
            data.get("verdict"),
            data.get("verdict_label"),
            data.get("layer"),
            data.get("layer_label"),
            data.get("thesis"),
            json.dumps(data.get("signals"), ensure_ascii=False) if data.get("signals") else None,
            data.get("signals_hit"),
            json.dumps(data.get("red_flags"), ensure_ascii=False) if data.get("red_flags") else None,
            data.get("ai_relevance"),
            json.dumps(data.get("bg_dimensions"), ensure_ascii=False) if data.get("bg_dimensions") else None,
            json.dumps(data.get("bg_sell_triggers"), ensure_ascii=False) if data.get("bg_sell_triggers") else None,
            data.get("model"),
            pre_labeled,
            run_id,
            data.get("created_at") or NOW,
        )
    )
    return cur.lastrowid


def main():
    if not LEGACY_DIR.exists():
        print(f"❌ {LEGACY_DIR} 不存在")
        return
    if not DB_PATH.exists():
        print(f"❌ {DB_PATH} 不存在，先运行 python -m scripts.init_db")
        return

    files = sorted(LEGACY_DIR.glob("*.json"))
    print(f"📂 待导入 {len(files)} 个 JSON 文件")

    stats = {
        "stocks_inserted": 0,
        "stocks_updated": 0,
        "serenity_inserted": 0,
        "serenity_skipped": 0,
        "bg_inserted": 0,
        "errors": 0,
    }

    with connect() as conn:
        # 创建 legacy import run 记录
        cur = conn.execute(
            """INSERT INTO runs (framework, scope, status, total_targets,
               started_at, notes)
               VALUES (?, ?, ?, ?, ?, ?)""",
            ("legacy_import", "data/analyses_v1", "running", len(files), NOW,
             "把 5,513 个旧 JSON 导入 SQLite，作为 v1 baseline")
        )
        run_id = cur.lastrowid

        for i, fp in enumerate(files):
            if i % 500 == 0 and i > 0:
                print(f"  进度 {i}/{len(files)}...")
                conn.commit()
            try:
                with open(fp, encoding="utf-8") as f:
                    d = json.load(f)
                code = d["code"]
                market = d.get("market", "a")
                name = d.get("name", "")
                sector = d.get("sector", "")

                # upsert stock
                stock_id = upsert_stock(
                    conn, code, market, name,
                    d.get("raw_quote"), sector, None
                )

                # serenity analysis
                aleabit = d.get("aleabit")
                if aleabit:
                    sa = {
                        "score": aleabit.get("bottleneck_score"),
                        "verdict": aleabit.get("verdict"),
                        "verdict_label": aleabit.get("verdict_label"),
                        "layer": aleabit.get("supply_chain_layer"),
                        "layer_label": aleabit.get("layer_label"),
                        "thesis": aleabit.get("thesis"),
                        "signals": aleabit.get("signals"),
                        "signals_hit": aleabit.get("signals_hit"),
                        "red_flags": aleabit.get("red_flags"),
                        "ai_relevance": aleabit.get("ai_relevance"),
                        "model": (
                            "pre-label" if aleabit.get("pre_labeled")
                            else d.get("llm_model") or "unknown"
                        ),
                        "pre_labeled": aleabit.get("pre_labeled"),
                        "created_at": aleabit.get("updated_at"),
                    }
                    aid = insert_analysis(conn, stock_id, "serenity", "v1", sa, run_id)
                    if aid:
                        stats["serenity_inserted"] += 1
                    else:
                        stats["serenity_skipped"] += 1

                # bg analysis (only if overall_score > 0)
                if (d.get("overall_score") or 0) > 0:
                    bg = {
                        "score": d.get("overall_score"),
                        "verdict": d.get("verdict"),
                        "verdict_label": d.get("overall_grade"),
                        "thesis": d.get("verdict"),
                        "bg_dimensions": d.get("dimensions"),
                        "bg_sell_triggers": d.get("sell_triggers"),
                        "model": d.get("llm_model") or "claude-conversation",
                        "pre_labeled": False,
                        "created_at": d.get("updated_at"),
                    }
                    bid = insert_analysis(conn, stock_id, "bg", "v1", bg, run_id)
                    if bid:
                        stats["bg_inserted"] += 1

                stats["stocks_inserted" if not row_existed(conn, code, market) else "stocks_updated"] += 1

            except Exception as e:
                stats["errors"] += 1
                if stats["errors"] <= 5:
                    print(f"  ⚠ {fp.name}: {e}")

        # 完成 run 记录
        conn.execute(
            """UPDATE runs SET status='completed', completed=?, completed_at=?
               WHERE id=?""",
            (stats["serenity_inserted"] + stats["bg_inserted"], NOW, run_id)
        )

    print()
    print(f"✅ 导入完成")
    for k, v in stats.items():
        print(f"   {k}: {v}")


def row_existed(conn, code, market):
    """简化的存在性检查（不严格，用于统计）"""
    # 简化：upsert_stock 内部已经处理，这里就返回 False
    return False


if __name__ == "__main__":
    main()
