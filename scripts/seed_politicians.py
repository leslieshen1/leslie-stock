"""Seed 政客交易（议员 + 特朗普）—— 聪明钱扩展。

美股特有信号:连有立法信息优势的议员都要披露交易(STOCK Act)。
A 股完全没有对应物。这是 contract game 的极致体现。

数据(真实):
- Nancy Pelosi / David Taylor: Capitol Trades 2026 真实披露
- Trump: 公开披露/媒体(Trump Media DJT 最大股东 + 家族 crypto)

议员是「逐笔交易」不是「持仓占比」,所以:
- amount_range: 披露金额区间("$1M–5M")
- trade_date: 交易日
- pct_of_portfolio: null(议员不披露组合占比)
- change_type: add=买 / trim=卖

用法: uv run python -m scripts.seed_politicians
"""
from __future__ import annotations

import sqlite3
from datetime import datetime

from db import connect

NOW = datetime.now().isoformat()


def _col_exists(conn, table, col):
    return any(c["name"] == col for c in conn.execute(f"PRAGMA table_info({table})"))


def migrate(conn):
    for col in ["amount_range", "trade_date"]:
        if not _col_exists(conn, "holdings", col):
            conn.execute(f"ALTER TABLE holdings ADD COLUMN {col} TEXT")
            print(f"  ✓ holdings.{col}")


def upsert_investor(conn, **kw) -> int:
    existing = conn.execute("SELECT id FROM investors WHERE slug=?", (kw["slug"],)).fetchone()
    cols = ["slug", "name", "name_en", "entity", "type", "archetype", "country",
            "aum_usd", "holdings_count", "notable_for", "latest_period", "updated_at"]
    vals = [kw.get(c) for c in cols]
    if existing:
        conn.execute(f"UPDATE investors SET {', '.join(c+'=?' for c in cols)} WHERE id=?", (*vals, existing["id"]))
        conn.execute("DELETE FROM holdings WHERE investor_id=?", (existing["id"],))
        return existing["id"]
    return conn.execute(f"INSERT INTO investors ({','.join(cols)}) VALUES ({','.join('?'*len(cols))})", vals).lastrowid


def insert_trade(conn, inv_id, ticker, name, ctype, amount_range, trade_date, source="capitol_trades"):
    conn.execute("""
        INSERT INTO holdings (investor_id, ticker, market, stock_name, period,
            pct_of_portfolio, change_type, amount_range, trade_date, source, disclosed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
    """, (inv_id, ticker, "us", name, trade_date, None, ctype, amount_range, trade_date, source, trade_date))


# ============================================================
# 真实数据（Capitol Trades / 公开披露）
# ============================================================

# Nancy Pelosi 2026Q1 大科技股 repositioning（buy=add, sell=trim）
PELOSI = [
    ("AB",    "AllianceBernstein", "add",  "$1M–5M",   "2026-01-16"),
    ("GOOGL", "Alphabet",          "add",  "$500K–1M", "2026-01-16"),
    ("AMZN",  "Amazon",            "add",  "$500K–1M", "2026-01-16"),
    ("AAPL",  "苹果",              "trim", "$5M–25M",  "2025-12-24"),
    ("GOOGL", "Alphabet",          "trim", "$1M–5M",   "2025-12-30"),
    ("AMZN",  "Amazon",            "trim", "$1M–5M",   "2025-12-24"),
    ("NVDA",  "英伟达",            "add",  "(9 笔调仓)", "2026-01"),
]

# David Taylor (R-OH) 2026-05 卖科技买防御
TAYLOR = [
    ("GOOGL", "Alphabet",       "trim", "$15K–50K", "2026-05-15"),
    ("AAPL",  "苹果",           "trim", "$1K–15K",  "2026-05-15"),
    ("T",     "AT&T",           "add",  "$1K–15K",  "2026-05-15"),
    ("HD",    "家得宝",         "add",  "$1K–15K",  "2026-05-15"),
    ("MEDP",  "Medpace",        "add",  "$1K–15K",  "2026-05-15"),
    ("PH",    "Parker-Hannifin","add",  "$1K–15K",  "2026-05-15"),
]

# Trump（公开披露/媒体）— 关联持仓非逐笔交易
TRUMP = [
    ("DJT", "Trump Media",          "hold", "~53% · 1.15 亿股", "2026"),
    ("WLF", "World Liberty Financial","hold", "家族 crypto/DeFi", "2026"),
]


def main():
    print("🏛️ Seed 政客交易\n")
    with connect(readonly=False) as conn:
        migrate(conn)
        print()

        pelosi = upsert_investor(
            conn, slug="pelosi", name="佩洛西", name_en="Nancy Pelosi",
            entity="美众议院 · 民主党 · 加州", type="politician", archetype="contract",
            country="US", aum_usd=None, holdings_count=len(PELOSI),
            notable_for="散户跟单招牌 — 丈夫 Paul 做期权,大科技股回报惊人;近期 $69M 调仓大科技(NVDA 9 笔/AAPL 7 笔)",
            latest_period="2026Q1", updated_at=NOW)
        for t in PELOSI:
            insert_trade(conn, pelosi, *t)
        print(f"  ✓ 佩洛西: {len(PELOSI)} 笔交易")

        taylor = upsert_investor(
            conn, slug="david-taylor", name="David Taylor", name_en="David Taylor",
            entity="美众议院 · 共和党 · 俄亥俄", type="politician", archetype="contract",
            country="US", aum_usd=None, holdings_count=len(TAYLOR),
            notable_for="2026-05 卖科技(GOOGL/AAPL)买防御(AT&T/家得宝/工业)", latest_period="2026Q2", updated_at=NOW)
        for t in TAYLOR:
            insert_trade(conn, taylor, *t)
        print(f"  ✓ David Taylor: {len(TAYLOR)} 笔交易")

        trump = upsert_investor(
            conn, slug="trump", name="特朗普", name_en="Donald Trump",
            entity="美国总统 · 政商名人", type="politician", archetype="contract",
            country="US", aum_usd=None, holdings_count=len(TRUMP),
            notable_for="Trump Media(DJT)最大股东 ~53%;家族 crypto:World Liberty Financial + $TRUMP memecoin",
            latest_period="2026", updated_at=NOW)
        for t in TRUMP:
            insert_trade(conn, trump, *t, source="public_disclosure")
        print(f"  ✓ 特朗普: {len(TRUMP)} 关联持仓（公开披露）")

        conn.commit()
        n_pol = conn.execute("SELECT COUNT(*) c FROM investors WHERE type='politician'").fetchone()["c"]
        print(f"\n✅ {n_pol} 政客 · 数据来源:Capitol Trades + 公开披露")


if __name__ == "__main__":
    main()
