"""把今日全市场收盘追加进 leslie.db.price_history —— 自攒历史的日常增量。

每次 refresh 跑一次。date = 最近一个美东交易日(周末/休市映射到上一交易日,
ON CONFLICT(sym,date) 去重,所以一天多刷只会更新不会重复)。
读 web/public/data/us-stocks.json(最新 Nasdaq 全市场快照)。

用法: python scripts/append_daily_prices.py
"""
from __future__ import annotations
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    _ET = ZoneInfo("America/New_York")
except Exception:
    _ET = None

ROOT = Path(__file__).parent.parent
US = ROOT / "web" / "public" / "data" / "us-stocks.json"
sys.path.insert(0, str(ROOT))
from db import connect, init_schema


def asof_date() -> str:
    d = datetime.now(_ET) if _ET else datetime.now()
    while d.weekday() >= 5:  # Sat=5 / Sun=6 → 回到周五
        d -= timedelta(days=1)
    return d.strftime("%Y-%m-%d")


def main():
    if not US.exists():
        print("⚠ 无 us-stocks.json,跳过"); return
    stocks = json.loads(US.read_text(encoding="utf-8")).get("stocks", [])
    asof = asof_date()
    rows = [(s["sym"], asof, s.get("price"), s.get("vol"))
            for s in stocks if s.get("sym") and s.get("price") is not None]
    init_schema()
    c = connect()
    c.executemany(
        "INSERT INTO price_history(sym,date,close,volume) VALUES(?,?,?,?) "
        "ON CONFLICT(sym,date) DO UPDATE SET close=excluded.close,volume=excluded.volume", rows)
    c.commit()
    total = c.execute("SELECT COUNT(*) FROM price_history").fetchone()[0]
    days = c.execute("SELECT COUNT(DISTINCT date) FROM price_history").fetchone()[0]
    print(f"✓ 追加 {len(rows)} 只今日({asof})收盘 → price_history 共 {total} 行 · {days} 个交易日")


if __name__ == "__main__":
    main()
