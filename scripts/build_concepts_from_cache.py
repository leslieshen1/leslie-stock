"""从已缓存的概念成分股构建 concepts.json(不联网抓取)。

东财反爬把 fetcher 掐死在 113/372。本脚本只读 data/_cache/concepts/ 里
已爬好的那些,构建出 concepts.json,让已有成果先用上(可续传:以后 fetcher
补完更多概念,再跑一次即可)。

真实概念名优先用东财概念名列表(单次调用,反爬风险低);失败则用缓存文件名兜底
(中文是 alnum,_safe_name 基本无损)。

用法: uv run python -m scripts.build_concepts_from_cache
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import akshare as ak

ROOT = Path(__file__).parent.parent
CACHE = ROOT / "data" / "_cache" / "concepts"
OUT = ROOT / "data" / "concepts.json"


def safe_name(name: str) -> str:
    return "".join(c if c.isalnum() or c in "()（）+-" else "_" for c in name)[:60]


def main():
    # 真实概念名列表(多试几次,反爬间歇性)
    names: list[str] | None = None
    for attempt in range(6):
        try:
            df = ak.stock_board_concept_name_em()
            names = df["板块名称"].tolist()
            print(f"✓ 概念名列表: {len(names)} 个(第 {attempt+1} 次成功)")
            break
        except Exception as e:
            if attempt == 5:
                print(f"⚠ 概念名列表 6 次都失败({str(e)[:40]}),用缓存文件名兜底(清尾巴 _)")
            time.sleep(4)

    ticker_concepts: dict[str, list[str]] = {}
    concept_meta: dict[str, int] = {}
    used = 0

    if names:
        # 用真实名,只加载已缓存的
        for name in names:
            f = CACHE / f"{safe_name(name)}.json"
            if not f.exists():
                continue
            try:
                codes = json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not codes:
                continue
            concept_meta[name] = len(codes)
            for c in codes:
                ticker_concepts.setdefault(c, []).append(name)
            used += 1
    else:
        # 兜底:文件名当概念名
        for f in sorted(CACHE.glob("*.json")):
            try:
                codes = json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not codes:
                continue
            name = f.stem.rstrip("_").replace("__", "_")  # 清掉兜底产生的尾巴
            concept_meta[name] = len(codes)
            for c in codes:
                ticker_concepts.setdefault(c, []).append(name)
            used += 1

    OUT.write_text(json.dumps(
        {"ticker_concepts": ticker_concepts, "concept_meta": concept_meta},
        ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n✅ {used} 概念(来自缓存)· {len(ticker_concepts)} 票打标 → {OUT}")
    for code in ["002428", "688122", "600519", "300750", "002594"]:
        cs = ticker_concepts.get(code, [])
        print(f"   {code}: {', '.join(cs[:8])}{'...' if len(cs) > 8 else ''}" if cs else f"   {code}: (无概念,可能该票所属概念还没爬到)")


if __name__ == "__main__":
    main()
