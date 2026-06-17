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


# (模块, 说明, 额外参数)。失败不致命,继续。key-gated 的没 key 会自己优雅跳过。
SOURCES = [
    ("fetchers.us_stocks", "美股全量行情(Nasdaq)", []),
    ("fetchers.us_etfs", "美股全量 ETF(Nasdaq)", []),
    ("fetchers.macro", "宏观/大盘(Yahoo)", []),
    ("fetchers.fundamentals", "基本面 PE/PS/EV-EBITDA(Yahoo)", ["--top", "0"]),  # 默认只刷 panels(缓存快);--full 全量
    ("fetchers.history", "回种日线(Nasdaq,跳过已种,补新票)", ["--top", "0"]),
    ("fetchers.news_google", "个股新闻(Google News)", []),
    ("fetchers.dataroma", "超级投资者持仓(Dataroma)", []),
    ("fetchers.finnhub", "财报日历+市场新闻(Finnhub,需 key)", []),
    ("fetchers.market_calendar", "市场日历:宏观+重磅财报(盘报 tab)", []),
    ("fetchers.polygon_options", "期权 gamma(Polygon,需 key)", []),
]


def main():
    fetch = "--no-fetch" not in sys.argv
    full = "--full" in sys.argv  # 基本面全量(6000+,慢)

    if fetch:
        print("=== 1) 一站式抓取所有数据源 → leslie.db ===")
        for mod, desc, extra in SOURCES:
            args = list(extra)
            if mod == "fetchers.fundamentals" and full:
                args = ["--all"]
            print(f"\n--- {desc} ---")
            if run([sys.executable, "-m", mod, *args]) != 0:
                print(f"⚠ {desc} 失败,跳过(继续用库里已有数据)")

        print("\n--- 追加今日价 → price_history(自攒历史) ---")
        run([sys.executable, "scripts/append_daily_prices.py"])

    print("\n--- 五神对决输入导出(引擎已上云 GitHub Actions,本地只供数据 ---")
    run([sys.executable, "scripts/export_arena_inputs.py"])

    print("\n=== 2) 从 leslie.db 派生全部前端 JSON ===")
    run([sys.executable, "scripts/build_json.py"])

    # 市值聚合去重:给重复上市的副类股(双重股权/存托)+ 私有代理打 capDup,
    # 让板块/热力图按 !capDup 求和,一家公司只算一次。必须在 build_json 之后(派生会覆盖标记)。
    print("\n--- 市值聚合去重(capDup) ---")
    run([sys.executable, "scripts/dedup_market_cap.py"])

    # 国会交易(独立外部源:众议院 PTR 申报,PDF 缓存复用;失败不阻断刷新)
    print("\n--- 国会议员交易申报(House PTR → congress.json) ---")
    if run([sys.executable, "scripts/build_congress.py"]) != 0:
        print("⚠ 国会数据刷新失败,沿用已有 congress.json")

    # ETF 段永平/巴菲特镜头(Nasdaq 逐只 AUM/费率,~15min;失败不阻断)
    print("\n--- ETF 镜头(Nasdaq → etf-analyses.json) ---")
    if run([sys.executable, "scripts/build_etf_analysis.py"]) != 0:
        print("⚠ ETF 数据刷新失败,沿用已有 etf-analyses.json")

    print("\n✅ 数据已最新(leslie.db = 真相源)。")

    if "--deploy" in sys.argv:
        env = {**os.environ, "PYTHONPATH": str(ROOT)}
        print("\n=== 3) 上线(只提交变了的前端 JSON + whales,跳过 20M 的库) ===")
        # 这些 JSON 就是库的可重建副本(build_json 的 sync_inputs_into_db 能回灌)
        subprocess.run(["git", "add", "web/public/data", "data/whales.json", "web/data/whales.json"],
                       cwd=str(ROOT), env=env)
        # 没变化也不报错
        subprocess.run(["git", "commit", "-q", "-m", "refresh: 最新行情/基本面/新闻/13F(库→JSON)"],
                       cwd=str(ROOT), env=env)
        subprocess.run(["git", "push", "origin", "main"], cwd=str(ROOT), env=env)
        print("   Vercel 部署中…")
        subprocess.run(["vercel", "--prod", "--yes", "--archive=tgz"], cwd=str(ROOT / "web"), env=env)
        print("\n✅ 已上线。库没进 git —— churning 数据(行情/基本面/新闻/13F)可从已提交 JSON 重建;"
              "\n   A股/基金/政客是静态库内 SoT,基线库已备份一次即可。")
    else:
        print("   要上线: python scripts/refresh.py --deploy")


if __name__ == "__main__":
    main()
