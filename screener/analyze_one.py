"""单股深度分析 + 缓存。

流程：
1. 拉 snapshot
2. 跑 bg_evaluate（含 GLM 5.1 定性分析）
3. 把完整 BGReport 序列化到 data/analyses/{code}_{market}.json
4. 这份 JSON 是 Next.js 个股深度页要消费的

CLI：
    uv run python -m screener.analyze_one 600519 a       # 茅台
    uv run python -m screener.analyze_one 00700 hk       # 腾讯
    uv run python -m screener.analyze_one 600519 a --force  # 强制重新分析
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from fetchers.snapshot import snapshot
from screener.bg_evaluate import BGReport, evaluate, render_markdown

ROOT = Path(__file__).parent.parent
ANALYSES_DIR = ROOT / "data" / "analyses"
ANALYSES_DIR.mkdir(parents=True, exist_ok=True)


def cache_path(code: str, market: str) -> Path:
    return ANALYSES_DIR / f"{code}_{market}.json"


def load_cached(code: str, market: str) -> dict | None:
    """读取已缓存的分析。"""
    p = cache_path(code, market)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def is_fresh(cached: dict, max_age_hours: float = 24) -> bool:
    """缓存是否还新鲜（默认 24 小时内）."""
    ts = cached.get("updated_at")
    if not ts:
        return False
    try:
        cache_time = datetime.fromisoformat(ts)
        age_hours = (datetime.now() - cache_time).total_seconds() / 3600
        return age_hours < max_age_hours
    except Exception:
        return False


def analyze(code: str, market: str = "a", force: bool = False,
            verbose: bool = True, snap: dict | None = None) -> dict:
    """分析一只股票，写到缓存。

    Args:
        snap: 可选，传入已经拉好的 snapshot 避免 double fetch（性能优化）

    Returns:
        包含完整 BG 报告 + verdict 的 dict（同时写到 JSON 文件）
    """
    # 检查缓存
    if not force:
        cached = load_cached(code, market)
        if cached and is_fresh(cached):
            if verbose:
                print(f"📋 使用缓存（{cached.get('updated_at')}）", flush=True)
            return cached

    t0 = time.time()
    if snap is None:
        if verbose:
            print(f">>> 拉 {code} ({market.upper()}) 数据 …", flush=True)
        snap = snapshot(code, market)

    if verbose:
        print(">>> 调用 GLM-5.1 做定性分析（可能 30-90 秒）…", flush=True)
    report = evaluate(snap, use_llm=True)

    payload = report_to_dict(report)
    # 把 5 年财务历史也存进 JSON（供前端绘图）
    fin = snap.get("financials") or {}
    payload["financials_history"] = fin.get("history") or {}
    payload["financials"] = {
        k: v for k, v in fin.items()
        if k != "history" and not k.startswith("_")
    }
    payload["markdown"] = render_markdown(report)
    payload["updated_at"] = datetime.now().isoformat(timespec="seconds")
    payload["llm_model"] = report.llm_used and "glm-5.1" or None
    payload["elapsed_seconds"] = round(time.time() - t0, 1)

    # 保存
    p = cache_path(code, market)
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    if verbose:
        print(f"✅ 分析完成 {payload['elapsed_seconds']}s → {p}", flush=True)
    return payload


def report_to_dict(report: BGReport) -> dict:
    """BGReport → JSON-safe dict。"""
    return {
        "code": report.code,
        "name": report.name,
        "market": report.market,
        "industry": report.industry,
        "overall_score": report.overall_score,
        "overall_grade": report.overall_grade,
        "verdict": report.verdict,
        "llm_used": report.llm_used,
        "dimensions": {
            k: {
                "name": d.name,
                "score": d.score,
                "grade": d.grade,
                "details": d.details,
                "flags": d.flags,
            }
            for k, d in report.dimensions.items()
        },
        "raw_quote": report.raw_quote,
        "sell_triggers": report.sell_triggers,
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("code", help="股票代码（A 股 6 位 / 港股 5 位）")
    ap.add_argument("market", nargs="?", default="a", help="市场 a / hk")
    ap.add_argument("--force", action="store_true", help="强制重新分析（忽略缓存）")
    ap.add_argument("--quiet", action="store_true", help="静默模式")
    args = ap.parse_args()

    result = analyze(args.code, args.market, force=args.force, verbose=not args.quiet)
    if args.quiet:
        # 静默模式只输出 JSON 路径
        print(cache_path(args.code, args.market))
    else:
        print()
        print(f"综合得分：{result['overall_score']:.1f} — {result['overall_grade']}")
        if result.get("verdict"):
            print(f"\nVerdict: {result['verdict']}")
