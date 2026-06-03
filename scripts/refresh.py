"""一站式更新。真相源 = leslie.db,前端 JSON 全部由库派生。

  python scripts/refresh.py             # 抓最新美股行情入库 → 派生全部前端 JSON
  python scripts/refresh.py --no-fetch  # 跳过抓取,只从现有库重新派生
  python scripts/refresh.py --deploy    # 上面 + 提交(只传变了的 JSON,跳过 13M 库)+ Vercel 部署

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

    print("\n✅ 数据已最新(leslie.db = 真相源)。")

    if "--deploy" in sys.argv:
        env = {**os.environ, "PYTHONPATH": str(ROOT)}
        print("\n=== 3) 上线(只提交变了的前端 JSON,跳过 13M 的库) ===")
        subprocess.run(["git", "add", "web/public/data"], cwd=str(ROOT), env=env)
        # 没变化也不报错
        subprocess.run(["git", "commit", "-q", "-m", "refresh: 最新行情/热度(库→JSON)"],
                       cwd=str(ROOT), env=env)
        subprocess.run(["git", "push", "origin", "main"], cwd=str(ROOT), env=env)
        print("   Vercel 部署中…")
        subprocess.run(["vercel", "--prod", "--yes", "--archive=tgz"], cwd=str(ROOT / "web"), env=env)
        print("\n✅ 已上线。db 本身没进 git(可从 JSON 重建);五方分析有变动时再单独备份库。")
    else:
        print("   要上线: python scripts/refresh.py --deploy")


if __name__ == "__main__":
    main()
