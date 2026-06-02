"""concepts.json → stocks.concepts 标准概念标签 + concepts_meta.json(前端热度排序)。

替换自创 sector,给 5510 票打东财标准概念标签(CPO/华为海思/人形机器人…)。

用法: uv run python -m scripts.import_concepts
"""
from __future__ import annotations

import json
from pathlib import Path

from db import connect

ROOT = Path(__file__).parent.parent
CONCEPTS = ROOT / "data" / "concepts.json"


def main():
    if not CONCEPTS.exists():
        print("❌ data/concepts.json 不存在(fetcher 还没跑完)")
        return
    data = json.loads(CONCEPTS.read_text(encoding="utf-8"))
    tc: dict[str, list[str]] = data["ticker_concepts"]
    meta: dict[str, int] = data["concept_meta"]
    print(f"📥 {len(tc)} 票有概念 · {len(meta)} 个概念\n")

    with connect(readonly=False) as conn:
        cols = [c["name"] for c in conn.execute("PRAGMA table_info(stocks)")]
        if "concepts" not in cols:
            conn.execute("ALTER TABLE stocks ADD COLUMN concepts TEXT")
            print("  ✓ stocks.concepts 字段已加")

        n = 0
        for code, concepts in tc.items():
            # 按概念热度(成分股少=更精准/小众)排序,热门概念在前
            ordered = sorted(concepts, key=lambda c: meta.get(c, 9999))
            r = conn.execute(
                "UPDATE stocks SET concepts=? WHERE code=? AND market='a'",
                (json.dumps(ordered, ensure_ascii=False), code),
            )
            n += r.rowcount
        conn.commit()
        print(f"  ✓ {n} 票打上概念标签")

    # 概念元数据(按成分股数降序,前端热度排序 + 搜索)
    meta_sorted = sorted(meta.items(), key=lambda x: -x[1])
    for out in [ROOT / "web" / "data" / "concepts_meta.json", ROOT / "data" / "concepts_meta.json"]:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(
            [{"name": k, "count": v} for k, v in meta_sorted],
            ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  ✓ {len(meta)} 概念元数据 → web/data/concepts_meta.json")

    # 抽样验证
    print("\n抽样:")
    with connect(readonly=True) as conn:
        for code in ["002428", "688122", "600519", "300750", "002594"]:
            r = conn.execute("SELECT name, concepts FROM stocks WHERE code=? AND market='a'", (code,)).fetchone()
            if r and r["concepts"]:
                cs = json.loads(r["concepts"])
                print(f"  {code} {r['name']}: {', '.join(cs[:6])}{'…' if len(cs) > 6 else ''}")
            elif r:
                print(f"  {code} {r['name']}: (无概念)")


if __name__ == "__main__":
    main()
