"""一站式更新。真相源 = leslie.db,前端 JSON 全部由库派生。

  python scripts/refresh.py             # 抓最新美股行情入库 → 派生全部前端 JSON
  python scripts/refresh.py --no-fetch  # 跳过抓取,只从现有库重新派生

流程:
  1. fetchers.us_stocks  → leslie.db.us_market(最新行情)
  2. scripts/build_json  → leslie.db → 全部前端 JSON(行情/五方/热度/产业链/真分…)

注:美股五方分析的更新走另一条线(Workflow 生成 → ingest_us_panel 入库),
   跑完那条后同样跑 build_json/refresh 即可让前端拿到。
部署:cd web && vercel --prod --yes --archive=tgz
"""
from __future__ import annotations
import os, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent


def run(cmd: list[str]) -> int:
    print(f"\n$ {' '.join(cmd)}")
    env = {**os.environ, "PYTHONPATH": str(ROOT)}
    return subprocess.run(cmd, cwd=str(ROOT), env=env).returncode


def main():
    fetch = "--no-fetch" not in sys.argv

    if fetch:
        print("=== 1) 抓最新美股行情 → leslie.db.us_market ===")
        if run([sys.executable, "-m", "fetchers.us_stocks"]) != 0:
            print("⚠ 行情抓取失败,继续用库里已有数据派生")

    print("\n=== 2) 从 leslie.db 派生全部前端 JSON ===")
    run([sys.executable, "scripts/build_json.py"])

    print("\n✅ 一站式更新完成。leslie.db = 真相源,前端 JSON 已最新。")
    print("   部署: cd web && vercel --prod --yes --archive=tgz")


if __name__ == "__main__":
    main()
