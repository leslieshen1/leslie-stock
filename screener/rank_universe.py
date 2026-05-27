"""批量评估排名：对 universe 中 Leslie 能力圈内的股票做 BG 评分。

输出：data/rankings.parquet
列：code, name, market, industry, circles, market_cap, price,
    change_pct, pe_ttm, pb, score_overall, score_financials,
    score_valuation, score_circle, grade, top_flags, updated_at

CLI:
    uv run python -m screener.rank_universe              # 默认 limit=50，只跑量化
    uv run python -m screener.rank_universe --limit 200  # 跑前 200 只
    uv run python -m screener.rank_universe --all        # 全部能力圈内股票
    uv run python -m screener.rank_universe --with-llm   # 同时调 GLM-5.1 对每只做深度分析
"""
from __future__ import annotations

import argparse
import concurrent.futures
import sys
import time
from datetime import datetime
from pathlib import Path

import pandas as pd

from fetchers.snapshot import snapshot
from fetchers.universe import load_universe
from screener.bg_evaluate import CIRCLE_OF_COMPETENCE, evaluate

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
RANKINGS_PATH = DATA_DIR / "rankings.parquet"


def tag_circles(industry: str | None) -> list[str]:
    """根据行业关键词，给股票打能力圈标签（可能属于多个圈）。"""
    if not industry or industry == "nan":
        return []
    tags = []
    for circle, keywords in CIRCLE_OF_COMPETENCE.items():
        for kw in keywords:
            if kw in str(industry):
                tags.append(circle)
                break
    return tags


def filter_candidates(universe: pd.DataFrame) -> pd.DataFrame:
    """从 universe 筛出市值前 N 的候选（能力圈过滤在评估时做）.

    PE 用 pe_dynamic 或 pe_static（bulk API 不返回 pe_ttm），任一 > 0 < 100 即可。
    """
    df = universe.copy()
    # 把所有 PE 字段统一成 "有任一有效 PE 即通过"
    for col in ("pe_dynamic", "pe_static", "pe_ttm"):
        if col not in df.columns:
            df[col] = pd.NA
    pe = df["pe_dynamic"].fillna(df["pe_static"]).fillna(df["pe_ttm"])
    df = df[pe.notna() & (pe > 0) & (pe < 100)]
    df = df[df["market_cap"].notna() & (df["market_cap"] > 0)]
    df = df.sort_values("market_cap", ascending=False).reset_index(drop=True)
    return df


# 全局：phase 1 拉到的 snapshot 缓存（key=(code,market)）→ 给 phase 2 复用
_PHASE1_SNAPSHOTS: dict[tuple[str, str], dict] = {}


def get_phase1_snap(code: str, market: str) -> dict | None:
    return _PHASE1_SNAPSHOTS.get((code, market))


def rank_universe(limit: int = 50, verbose: bool = True, oversample: int = 4) -> pd.DataFrame:
    """评估市值 TOP 候选 → snapshot 时按 industry 过滤能力圈外的 → 输出 ranked DataFrame.

    oversample: 实际遍历的候选数 = limit * oversample（因为有些会被能力圈过滤掉）
    """
    universe = load_universe()
    candidates = filter_candidates(universe)
    target = candidates.head(limit * oversample)
    if verbose:
        print(f"市值有效股票 {len(candidates)} 只，将遍历前 {len(target)} 只查找能力圈内目标", flush=True)
        print(f"目标：找够 {limit} 只能力圈内股票", flush=True)
        print()

    results: list[dict] = []
    skipped_out_of_circle = 0
    t0 = time.time()
    _PHASE1_SNAPSHOTS.clear()

    for i, row in target.iterrows():
        if len(results) >= limit:
            break
        code = row["code"]
        market = str(row["market"]).lower()
        name = row["name"]
        try:
            snap = snapshot(code, market)
            quote = snap["quote"]
            industry = quote.get("industry")
            circles = tag_circles(industry)
            if not circles:
                skipped_out_of_circle += 1
                continue   # 能力圈外，跳过

            # 缓存 snap 给 phase 2 复用，避免 double fetch
            _PHASE1_SNAPSHOTS[(code, market)] = snap
            report = evaluate(snap)
            all_flags = [f for d in report.dimensions.values() for f in d.flags]
            red = [f for f in all_flags if "🔴" in f]
            yellow = [f for f in all_flags if "🟡" in f]
            green = [f for f in all_flags if "🟢" in f]

            results.append({
                "code": code,
                "name": name,
                "market": market,
                "industry": industry,
                "circles": " / ".join(circles),
                "market_cap": quote.get("market_cap") or row.get("market_cap"),
                "price": quote.get("price"),
                "change_pct": quote.get("change_pct"),
                "pe_ttm": _safe_float(quote.get("pe_ttm")),
                "pb": _safe_float(quote.get("pb")),
                "score_overall": report.overall_score,
                "score_financials": report.dimensions["financials"].score,
                "score_valuation": report.dimensions["valuation"].score,
                "score_circle": report.dimensions["circle"].score,
                "grade": report.overall_grade,
                "n_red": len(red),
                "n_yellow": len(yellow),
                "n_green": len(green),
                "top_flags": " · ".join((red + yellow + green)[:3]),
                "updated_at": datetime.now().isoformat(timespec="seconds"),
            })
            if verbose:
                idx = len(results)
                elapsed = time.time() - t0
                avg = elapsed / max(idx, 1)
                eta = avg * (limit - idx)
                print(
                    f"[{idx:>3}/{limit}] {name:<10} ({code}/{market.upper()})  "
                    f"得分 {report.overall_score:>5.1f}  "
                    f"{report.overall_grade:<22}  "
                    f"圈: {' / '.join(circles)[:20]}  "
                    f"ETA {eta:.0f}s",
                    flush=True,
                )
        except Exception as e:
            if verbose:
                print(f"[FAIL] {name} ({code}): {str(e)[:80]}", flush=True)

        if len(results) > 0 and len(results) % 10 == 0:
            _save_partial(results)

    if verbose:
        print()
        print(f"跳过能力圈外: {skipped_out_of_circle} 只")

    df = pd.DataFrame(results)
    if len(df) > 0 and "score_overall" in df.columns:
        df = df.sort_values("score_overall", ascending=False).reset_index(drop=True)
    DATA_DIR.mkdir(exist_ok=True)
    df.to_parquet(RANKINGS_PATH, index=False)
    # 同时写 JSON 给 Next.js dashboard 用
    json_path = DATA_DIR / "rankings.json"
    df.to_json(json_path, orient="records", force_ascii=False, indent=2)
    if verbose:
        print()
        print(f"✅ 完成评估 {len(df)} 只，已写入 {RANKINGS_PATH}")
        print(f"   JSON 副本: {json_path}")
        print(f"   耗时 {time.time() - t0:.0f} 秒")
    return df


def _save_partial(results: list[dict]) -> None:
    """增量保存当前进度。"""
    pd.DataFrame(results).to_parquet(RANKINGS_PATH, index=False)


def _safe_float(v) -> float | None:
    try:
        if v is None or v == "-":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def load_rankings() -> pd.DataFrame | None:
    if not RANKINGS_PATH.exists():
        return None
    return pd.read_parquet(RANKINGS_PATH)


def run_llm_for_top(df: pd.DataFrame, top_n: int = 30, parallelism: int = 2,
                    verbose: bool = True) -> None:
    """对排名前 top_n 个股票自动跑 GLM-5.1 深度分析，缓存到 data/analyses/.

    优先用 phase 1 已经拉到的 snapshot，避免 double fetch 触发反爬。
    """
    from screener.analyze_one import analyze, load_cached, is_fresh

    targets = df.head(top_n)
    if verbose:
        print(f"\n>>> 对 TOP {len(targets)} 跑 GLM-5.1 深度分析（{parallelism} 并发，复用 phase 1 snapshot）", flush=True)

    def _one(row):
        code = row["code"]
        market = row["market"]
        cached = load_cached(code, market)
        if cached and is_fresh(cached, max_age_hours=6):
            return code, "cached", None
        try:
            t0 = time.time()
            # 复用 phase 1 拉的 snap（避免 double fetch east_money）
            snap = get_phase1_snap(code, market)
            analyze(code, market, force=False, verbose=False, snap=snap)
            return code, "ok", round(time.time() - t0, 1)
        except Exception as e:
            return code, "fail", str(e)[:120]

    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=parallelism) as pool:
        futures = {pool.submit(_one, row): row for _, row in targets.iterrows()}
        for fut in concurrent.futures.as_completed(futures):
            row = futures[fut]
            code, status, info = fut.result()
            done += 1
            if verbose:
                marker = "✅" if status == "ok" else ("📋" if status == "cached" else "❌")
                tag = f"{info}s" if status == "ok" else (info or "—")
                print(f"  [{done}/{len(targets)}] {marker} {row['name']} ({code}) — {status} {tag}", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=50, help="评估候选数")
    ap.add_argument("--all", action="store_true", help="评估所有能力圈内股票")
    ap.add_argument("--with-llm", action="store_true", help="排名后对 TOP N 跑 GLM-5.1 深度分析")
    ap.add_argument("--llm-top", type=int, default=30, help="对前 N 名跑 LLM（默认 30）")
    ap.add_argument("--parallel", type=int, default=3, help="GLM 并发数（默认 3）")
    args = ap.parse_args()

    if args.all:
        limit = 100000
    else:
        limit = args.limit

    df = rank_universe(limit=limit)
    print()
    print("=== TOP 15 by BG 综合得分 ===")
    cols = ["code", "name", "market", "industry", "score_overall", "pe_ttm", "grade"]
    print(df[cols].head(15).to_string(index=False))

    if args.with_llm and len(df) > 0:
        run_llm_for_top(df, top_n=min(args.llm_top, len(df)), parallelism=args.parallel)
