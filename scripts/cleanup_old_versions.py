"""删除深度分析过的票的早期版本，只保留最新 deep-dive 版本。

002428 删 v1/v2/v3 留 v4
688122 删 v1 留 v2
"""
from __future__ import annotations

from db import connect


def main():
    targets = [
        # (code, market, versions_to_keep)
        ("002428", "a", ["v4"]),
        ("688122", "a", ["v2"]),
    ]

    with connect(readonly=False) as conn:
        for code, market, keep in targets:
            stock = conn.execute(
                "SELECT id, name FROM stocks WHERE code=? AND market=?", (code, market)
            ).fetchone()
            if not stock:
                print(f"⚠ {code}/{market} 不在 DB")
                continue

            stock_id = stock["id"]
            print(f"\n━━━ {code} {stock['name']} ━━━")

            # 当前版本
            rows = conn.execute("""
                SELECT id, version, score, verdict_label, created_at
                FROM analyses
                WHERE stock_id=? AND framework='serenity'
                ORDER BY created_at
            """, (stock_id,)).fetchall()

            print(f"  现有版本：")
            for r in rows:
                d = dict(r)
                action = "  保留" if d["version"] in keep else "❌ 删除"
                print(f"    {action} {d['version']}  {d['score']}  {(d['verdict_label'] or '')[:50]}")

            # 执行删除
            to_delete = [r["id"] for r in rows if r["version"] not in keep]
            if to_delete:
                conn.executemany("DELETE FROM analyses WHERE id=?", [(i,) for i in to_delete])
                print(f"  ✓ 删了 {len(to_delete)} 个版本")
            conn.commit()

        # 最终状态
        print("\n━━━ 清理后 ━━━")
        for code, market, _ in targets:
            rows = conn.execute("""
                SELECT s.code, s.name, a.version, a.score, a.verdict_label
                FROM stocks s JOIN analyses a ON a.stock_id = s.id
                WHERE s.code=? AND s.market=? AND a.framework='serenity'
            """, (code, market)).fetchall()
            for r in rows:
                d = dict(r)
                print(f"  {d['code']} {d['name']:<10}  {d['version']:<4}  {d['score']}  {d['verdict_label'][:55]}")


if __name__ == "__main__":
    main()
