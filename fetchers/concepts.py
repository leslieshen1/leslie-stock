"""拉东财概念板块 + 成分股 → ticker→concepts 标准概念标签。

替换自创 sector("Layer4_关键金属"这种)为同花顺/东财标准概念
(CPO概念/华为海思/人形机器人/固态电池…用户熟悉的题材单位)。

东财接口间歇反爬(RemoteDisconnected),加重试 + sleep + 缓存(可续传)。
372+ 概念逐个拉,~30-60 分钟一次性。中断后重跑会跳过已缓存的。

输出 data/concepts.json:
  ticker_concepts: {code: [concept...]}   每只票的概念标签
  concept_meta:    {concept: count}        每个概念的成分股数(用于热度排序)

用法: uv run python -m fetchers.concepts
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import akshare as ak

ROOT = Path(__file__).parent.parent
CACHE = ROOT / "data" / "_cache" / "concepts"
CACHE.mkdir(parents=True, exist_ok=True)
OUT = ROOT / "data" / "concepts.json"


def _safe_name(name: str) -> str:
    return "".join(c if c.isalnum() or c in "()（）+-" else "_" for c in name)[:60]


def fetch_retry(fn, *a, retries=8, sleep=3, **kw):
    last = None
    for i in range(retries):
        try:
            return fn(*a, **kw)
        except Exception as e:
            last = e
            time.sleep(sleep)
    print(f"    ⚠ 放弃: {str(last)[:50]}")
    return None


def fetch_concept_cons(name: str) -> list[str] | None:
    """拉单个概念成分股代码（缓存）。"""
    cache_f = CACHE / f"{_safe_name(name)}.json"
    if cache_f.exists():
        try:
            return json.loads(cache_f.read_text(encoding="utf-8"))
        except Exception:
            pass
    cons = fetch_retry(ak.stock_board_concept_cons_em, symbol=name)
    if cons is None or cons.empty or "代码" not in cons.columns:
        return None
    codes = [str(c).zfill(6) for c in cons["代码"].tolist()]
    cache_f.write_text(json.dumps(codes, ensure_ascii=False), encoding="utf-8")
    return codes


def main():
    print("🏷️  东财概念板块 → 概念标签\n")
    names_df = fetch_retry(ak.stock_board_concept_name_em)
    if names_df is None:
        print("❌ 概念列表拉取失败")
        return
    names = names_df["板块名称"].tolist()
    print(f"概念总数: {len(names)}\n")

    ticker_concepts: dict[str, list[str]] = {}
    concept_meta: dict[str, int] = {}
    done = skipped = 0

    for i, name in enumerate(names):
        codes = fetch_concept_cons(name)
        if not codes:
            skipped += 1
            continue
        concept_meta[name] = len(codes)
        for code in codes:
            ticker_concepts.setdefault(code, []).append(name)
        done += 1
        if (i + 1) % 25 == 0:
            print(f"  [{i+1}/{len(names)}] {name}: {len(codes)} 只 · 累计 {len(ticker_concepts)} 票打标")
            # 中途存盘（防中断丢失）
            OUT.write_text(json.dumps(
                {"ticker_concepts": ticker_concepts, "concept_meta": concept_meta},
                ensure_ascii=False, indent=1), encoding="utf-8")
        time.sleep(0.25)

    OUT.write_text(json.dumps(
        {"ticker_concepts": ticker_concepts, "concept_meta": concept_meta},
        ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n✅ {done} 概念成功 · {skipped} 跳过 · {len(ticker_concepts)} 票打标")
    print(f"   → {OUT}")
    # 抽样
    for code in ["002428", "688122", "600519", "300750"]:
        cs = ticker_concepts.get(code, [])
        print(f"   {code}: {', '.join(cs[:6])}{'...' if len(cs) > 6 else ''}" if cs else f"   {code}: (无概念)")


if __name__ == "__main__":
    main()
