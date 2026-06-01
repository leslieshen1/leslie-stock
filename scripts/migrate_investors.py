"""Migration: 建 investors + holdings 两张表（聪明钱 / 名人持仓功能）。

设计原则:
- holdings 用 ticker + market 软关联（不强制外键到 stocks），
  这样段永平的 AAPL 持仓即使 AAPL 不在我们 DB 也能显示在 /whales tab。
- pct_of_portfolio 是一等公民 —— 区分"段重仓 36%"和"段试探仓 0.1%"，
  避免"大佬买了就跟"的误读（CRCL 这个 case 趟过的雷）。

用法: uv run python -m scripts.migrate_investors
"""
from __future__ import annotations

from db import connect

INVESTORS_SQL = """
CREATE TABLE IF NOT EXISTS investors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,            -- duan-yongping / buffett / zhang-kun
    name TEXT NOT NULL,                   -- 段永平
    name_en TEXT,                         -- Duan Yongping
    entity TEXT,                          -- H&H International Investment
    type TEXT NOT NULL,                   -- superinvestor / fund / hot_money / northbound
    archetype TEXT,                       -- contract(美股13F) / meme(A股)
    country TEXT,                         -- US / CN
    aum_usd REAL,                         -- 组合总市值（美元）
    holdings_count INTEGER,               -- 持仓数量
    notable_for TEXT,                     -- "苹果重仓 / 步步高 OPPO vivo 创始人"
    avatar TEXT,
    profile_url TEXT,
    latest_period TEXT,                   -- 2026Q1
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_investors_type ON investors(type);
CREATE INDEX IF NOT EXISTS idx_investors_archetype ON investors(archetype);
"""

HOLDINGS_SQL = """
CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investor_id INTEGER NOT NULL,
    ticker TEXT NOT NULL,                 -- AAPL / 002428 / CRCL
    market TEXT,                          -- us / a / hk
    stock_name TEXT,                      -- 苹果 / 云南锗业
    period TEXT NOT NULL,                 -- 2026Q1
    shares REAL,
    market_value REAL,                   -- 美元
    pct_of_portfolio REAL,               -- 占组合比例（关键！）
    rank_in_portfolio INTEGER,           -- 第几大重仓
    change_type TEXT,                    -- new / add / trim / exit / hold
    change_pct REAL,                     -- 较上期持股变动 %
    source TEXT,                         -- 13F / fund_report / longhubang / northbound
    disclosed_at TEXT,
    FOREIGN KEY (investor_id) REFERENCES investors(id)
);
CREATE INDEX IF NOT EXISTS idx_holdings_investor ON holdings(investor_id);
CREATE INDEX IF NOT EXISTS idx_holdings_ticker ON holdings(ticker, market);
CREATE INDEX IF NOT EXISTS idx_holdings_period ON holdings(period DESC);
CREATE INDEX IF NOT EXISTS idx_holdings_change ON holdings(change_type);
"""


def main():
    print("🔧 投资者 / 持仓表 migration\n")
    with connect(readonly=False) as conn:
        conn.executescript(INVESTORS_SQL)
        print("  ✓ investors 表")
        conn.executescript(HOLDINGS_SQL)
        print("  ✓ holdings 表")
        conn.commit()

        # 验证
        for t in ["investors", "holdings"]:
            cols = conn.execute(f"PRAGMA table_info({t})").fetchall()
            print(f"     {t}: {len(cols)} 列")
    print("\n✅ 完成")


if __name__ == "__main__":
    main()
