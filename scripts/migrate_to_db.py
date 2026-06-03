"""一次性把现有美股 JSON 灌进 leslie.db(美股行情 + 五方 + 稀释)。A股已在库。
之后 us-stocks/us-analyses/dilution-flags 全部由 build_json.py 从库派生。

用法: python scripts/migrate_to_db.py
"""
from __future__ import annotations
import json, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
from db import connect, init_schema

PUB = ROOT / "web" / "public" / "data"


def set_meta(c, k, v):
    c.execute("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, v))


def main():
    init_schema()
    c = connect()

    us = json.load(open(PUB / "us-stocks.json", encoding="utf-8"))
    rows = us.get("stocks", us)
    c.executemany(
        """INSERT INTO us_market(sym,name,price,pct,mcapB,sector,industry,vol,country)
           VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(sym) DO UPDATE SET
           name=excluded.name,price=excluded.price,pct=excluded.pct,mcapB=excluded.mcapB,
           sector=excluded.sector,industry=excluded.industry,vol=excluded.vol,country=excluded.country""",
        [(r.get("sym"), r.get("name"), r.get("price"), r.get("pct"), r.get("mcapB"),
          r.get("sector"), r.get("industry"), r.get("vol"), r.get("country")) for r in rows])
    set_meta(c, "us_market_generated_at", us.get("generated_at", ""))
    print(f"  us_market: {len(rows)}")

    ua = json.load(open(PUB / "us-analyses.json", encoding="utf-8"))
    stocks = ua.get("stocks", {})
    c.executemany("INSERT INTO us_analyses(sym,data) VALUES(?,?) ON CONFLICT(sym) DO UPDATE SET data=excluded.data",
                  [(sym, json.dumps(e, ensure_ascii=False)) for sym, e in stocks.items()])
    set_meta(c, "us_analyses_generated_at", ua.get("generated_at", ""))
    print(f"  us_analyses: {len(stocks)}")

    try:
        dl = json.load(open(PUB / "dilution-flags.json", encoding="utf-8"))
        flags = dl.get("flags", dl)
        c.executemany("INSERT INTO dilution(sym,data) VALUES(?,?) ON CONFLICT(sym) DO UPDATE SET data=excluded.data",
                      [(sym, json.dumps(f, ensure_ascii=False)) for sym, f in flags.items()])
        print(f"  dilution: {len(flags)}")
    except FileNotFoundError:
        print("  dilution: (无)")

    c.commit()
    print("✓ 导入完成 → leslie.db")


if __name__ == "__main__":
    main()
