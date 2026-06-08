"""统一 deriver:leslie.db(单一真相源)→ 前端需要的全部 JSON。

顺序:
  1. 美股原始 JSON 从库派生:us-stocks / us-analyses / dilution-flags
  2. A股 manifest + 详情 从库派生:export_manifests.py(SoT=SQLite 那套)
  3. 计算型 JSON:us-heat / panel-summary / pulse-scores / industry-map / pulse-supplement

跑完前端就是最新的。配 refresh.py 用(先抓数据入库,再跑这个)。
用法: python scripts/build_json.py
"""
from __future__ import annotations
import json, os, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
from db import connect, init_schema  # 根目录 db 包(单一真相源)

PUB = ROOT / "web" / "public" / "data"
SCRIPTS = ROOT / "scripts"
US_COLS = "sym,name,price,pct,mcapB,sector,industry,vol,country"


def meta(c, key: str) -> str:
    r = c.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return (r[0] if r else "") or ""


def sync_inputs_into_db(c):
    """对账:把 us-analyses / dilution 的 JSON(可能刚被 ingest 更新过)同步进库,
    再从库派生 —— 避免 ingest 写了 JSON 而 build_json 用旧库覆盖丢数据。库 = 持久层。"""
    ua_path = PUB / "us-analyses.json"
    if ua_path.exists():
        ua = json.loads(ua_path.read_text(encoding="utf-8"))
        stocks = ua.get("stocks", {})
        c.executemany("INSERT INTO us_analyses(sym,data) VALUES(?,?) ON CONFLICT(sym) DO UPDATE SET data=excluded.data",
                      [(sym, json.dumps(e, ensure_ascii=False)) for sym, e in stocks.items()])
        c.execute("INSERT INTO meta(key,value) VALUES('us_analyses_generated_at',?) "
                  "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (ua.get("generated_at", ""),))
    dl_path = PUB / "dilution-flags.json"
    if dl_path.exists():
        flags = json.loads(dl_path.read_text(encoding="utf-8")).get("flags", {})
        c.executemany("INSERT INTO dilution(sym,data) VALUES(?,?) ON CONFLICT(sym) DO UPDATE SET data=excluded.data",
                      [(sym, json.dumps(f, ensure_ascii=False)) for sym, f in flags.items()])
    c.commit()


def derive_us_raw(c):
    rows = [dict(r) for r in c.execute(f"SELECT {US_COLS} FROM us_market ORDER BY mcapB DESC")]
    (PUB / "us-stocks.json").write_text(
        json.dumps({"generated_at": meta(c, "us_market_generated_at"), "count": len(rows), "stocks": rows},
                   ensure_ascii=False), encoding="utf-8")
    print(f"  us-stocks.json: {len(rows)}")

    stocks = {sym: json.loads(data) for sym, data in c.execute("SELECT sym,data FROM us_analyses")}
    (PUB / "us-analyses.json").write_text(
        json.dumps({"generated_at": meta(c, "us_analyses_generated_at"), "stocks": stocks}, ensure_ascii=False),
        encoding="utf-8")
    # 切成单股文件(详情页 loadUsPanel 读 us-panels/{sym}.json),纯派生、可重建
    panels_dir = PUB / "us-panels"
    panels_dir.mkdir(parents=True, exist_ok=True)
    for sym, entry in stocks.items():
        (panels_dir / f"{sym}.json").write_text(json.dumps(entry, ensure_ascii=False), encoding="utf-8")
    print(f"  us-analyses.json + us-panels/: {len(stocks)}")

    flags = {sym: json.loads(data) for sym, data in c.execute("SELECT sym,data FROM dilution")}
    (PUB / "dilution-flags.json").write_text(json.dumps({"flags": flags}, ensure_ascii=False), encoding="utf-8")
    print(f"  dilution-flags.json: {len(flags)}")


def derive_extras(c):
    """ru7 免费源派生：基本面 / 新闻 / 宏观 / 财报日历 / 期权 / crypto(库→JSON）。
    核心三项(基本面/新闻/宏观)总是写；key-gated 三项有数据才写(不覆盖)。"""
    # 基本面
    fund = {sym: json.loads(d) for sym, d in c.execute("SELECT sym,data FROM us_fundamentals")}
    (PUB / "us-fundamentals.json").write_text(
        json.dumps({"generated_at": meta(c, "us_fundamentals_generated_at"),
                    "count": len(fund), "stocks": fund}, ensure_ascii=False), encoding="utf-8")
    print(f"  us-fundamentals.json: {len(fund)}")

    # 个股新闻:按股切片(详情页只读 us-news/{sym}.json,避免读 3.6MB 大文件)
    news = {sym: json.loads(d) for sym, d in c.execute("SELECT sym,data FROM us_news")}
    news_dir = PUB / "us-news"
    news_dir.mkdir(parents=True, exist_ok=True)
    for sym, items in news.items():
        (news_dir / f"{sym}.json").write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    # 只留一个轻量索引（不含正文）
    (PUB / "us-news.json").write_text(
        json.dumps({"generated_at": meta(c, "us_news_generated_at"),
                    "count": len(news), "syms": sorted(news.keys())}, ensure_ascii=False),
        encoding="utf-8")
    print(f"  us-news/ 切片: {len(news)}")

    # 宏观/大盘
    mac = [dict(r) for r in c.execute(
        "SELECT sym,name,price,pct,kind FROM macro ORDER BY rowid")]
    (PUB / "macro.json").write_text(
        json.dumps({"generated_at": meta(c, "macro_generated_at"), "series": mac},
                   ensure_ascii=False), encoding="utf-8")
    print(f"  macro.json: {len(mac)}")

    # key-gated:有数据才写
    earn = {sym: json.loads(d) for sym, d in c.execute("SELECT sym,data FROM us_earnings")}
    if earn:
        (PUB / "earnings-calendar.json").write_text(
            json.dumps({"generated_at": meta(c, "earnings_generated_at"), "stocks": earn},
                       ensure_ascii=False), encoding="utf-8")
        print(f"  earnings-calendar.json: {len(earn)}")
    opt = {sym: json.loads(d) for sym, d in c.execute("SELECT sym,data FROM us_options")}
    if opt:
        (PUB / "us-options.json").write_text(
            json.dumps({"generated_at": "", "stocks": opt}, ensure_ascii=False), encoding="utf-8")
        print(f"  us-options.json: {len(opt)}")
    cry = {k: json.loads(d) for k, d in c.execute("SELECT id,data FROM crypto_etf")}
    if cry:
        (PUB / "crypto-etf.json").write_text(
            json.dumps({"generated_at": "", "flows": cry}, ensure_ascii=False), encoding="utf-8")
        print(f"  crypto-etf.json: {len(cry)}")


def run(name: str):
    env = {**os.environ, "PYTHONPATH": str(ROOT)}  # 让子进程能 from db import
    r = subprocess.run([sys.executable, str(SCRIPTS / name)], capture_output=True, text=True, cwd=str(ROOT), env=env)
    tag = "✓" if r.returncode == 0 else "✗"
    last = (r.stdout.strip().splitlines() or [""])[-1]
    print(f"  {tag} {name}: {last}")
    if r.returncode != 0:
        print((r.stderr or "").strip()[-500:])


def main():
    init_schema()
    c = connect()

    print("0) 对账:JSON → 库(收编 ingest 的增量)")
    sync_inputs_into_db(c)

    print("1) 美股原始(库→JSON)")
    derive_us_raw(c)

    print("1b) ru7 免费源:基本面/新闻/宏观/财报/期权/crypto(库→JSON)")
    derive_extras(c)

    print("2) A股 manifest + 详情(库→JSON)")
    run("export_manifests.py")

    print("3) 计算型 JSON")
    for s in ("build_us_heat.py", "build_panel_summary.py", "build_pulse_scores.py",
              "build_industry_map.py", "build_pulse_supplement.py", "build_stock_types.py"):
        run(s)

    print("✓ 全部 JSON 已从 leslie.db 派生")


if __name__ == "__main__":
    main()
