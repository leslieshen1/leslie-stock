"""统一数据刷新入口 — 一个命令更新所有可自动化数据。

为什么存在:
  原来 launchd 用系统 python 跑 fetch_pulse,缺 yfinance 依赖 → 跑挂 → 数据馊。
  这里统一用 uv 环境,一个命令搞定,既本地可跑也是 GitHub Actions 的调用目标。

数据分层（按能不能自动 + 地域）:
  ✅ 行情(热力图)   yfinance     海外 runner 友好(A股用 .SS/.SZ 后缀)  → 日更
  ✅ 评分/whale/分析  本地 SQLite  只读,无网络                          → 每次 export
  ⚠️ A股基金重仓     akshare      东财接口,地域敏感(海外 runner 可能挂)  → 季度,--funds
  ⚠️ 议员/13F        手录/WebFetch 反爬                                  → 季度手动,不在此

用法:
  uv run python -m scripts.refresh_all              # 行情 + export（日常）
  uv run python -m scripts.refresh_all --export     # 只 export（最快,只读 SQLite）
  uv run python -m scripts.refresh_all --funds      # 额外刷 A股基金（季度）
  uv run python -m scripts.refresh_all --no-quotes  # 跳过行情
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent.parent


def step(title: str):
    print(f"\n{'='*55}\n▶ {title}\n{'='*55}")


def run_quotes() -> bool:
    """yfinance 行情 → pulse-snapshot.json（热力图）。"""
    step("行情更新（yfinance）")
    t = time.time()
    r = subprocess.run(
        [sys.executable, str(ROOT / "web" / "data" / "fetch_pulse.py")],
        cwd=str(ROOT),
    )
    ok = r.returncode == 0
    print(f"  {'✓' if ok else '❌'} fetch_pulse ({time.time()-t:.0f}s)")
    return ok


def run_us_stocks() -> bool:
    """Nasdaq screener 全美股 → us-stocks.json（scan 美股视图,日更)。"""
    step("美股全市场（Nasdaq screener）")
    t = time.time()
    r = subprocess.run(
        [sys.executable, "-m", "fetchers.us_stocks"],
        cwd=str(ROOT),
    )
    ok = r.returncode == 0
    print(f"  {'✓' if ok else '⚠️'} us_stocks ({time.time()-t:.0f}s)")
    return ok


def run_funds() -> bool:
    """akshare A股基金重仓 → DB（季度更，地域敏感）。"""
    step("A股基金重仓（akshare · 季度）")
    t = time.time()
    r = subprocess.run(
        [sys.executable, "-m", "scripts.seed_investors"],
        cwd=str(ROOT),
    )
    ok = r.returncode == 0
    print(f"  {'✓' if ok else '⚠️'} seed_investors ({time.time()-t:.0f}s)")
    return ok


def run_export() -> bool:
    """SQLite → 所有前端 JSON（manifest / analyses / whales / top_serenity）。"""
    step("导出 manifests（SQLite → JSON）")
    t = time.time()
    r = subprocess.run(
        [sys.executable, "-m", "scripts.export_manifests"],
        cwd=str(ROOT),
    )
    ok = r.returncode == 0
    print(f"  {'✓' if ok else '❌'} export_manifests ({time.time()-t:.0f}s)")
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", action="store_true", help="只 export（最快）")
    ap.add_argument("--funds", action="store_true", help="额外刷 A股基金（季度）")
    ap.add_argument("--no-quotes", action="store_true", help="跳过行情")
    args = ap.parse_args()

    print("🔄 数据刷新\n")
    results = {}

    if args.export:
        # 只 export 模式
        results["export"] = run_export()
    else:
        if not args.no_quotes:
            results["quotes"] = run_quotes()
            results["us_stocks"] = run_us_stocks()
        if args.funds:
            results["funds"] = run_funds()
        results["export"] = run_export()

    # 汇总
    print(f"\n{'='*55}")
    print("📊 刷新汇总:")
    for k, v in results.items():
        print(f"   {k:<10} {'✓ 成功' if v else '❌ 失败'}")
    # 关键步骤(export)失败才算整体失败
    critical_ok = results.get("export", True)
    print(f"\n{'✅ 完成' if critical_ok else '❌ export 失败'}")
    sys.exit(0 if critical_ok else 1)


if __name__ == "__main__":
    main()
