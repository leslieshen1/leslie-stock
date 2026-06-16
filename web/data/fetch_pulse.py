"""
fetch_pulse.py — AI 产业链脉冲 · 真实数据抓取
依赖：yfinance, pandas, numpy

输出: ../web/public/data/pulse-snapshot.json

每只标的计算 4 项指标（0-100）：
  valuationPct  : 5y 价格分位（代理估值热度；价位越高 = 越贵）
  momentum20d   : 20D 收益率在过去 1y 同窗口分布的百分位
  rsi           : 14D RSI
  sentiment     : 5D 收益率 + 成交量比 综合
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import pandas as pd
import yfinance as yf

try:
    import akshare as ak
    AK_AVAILABLE = True
except ImportError:
    ak = None
    AK_AVAILABLE = False

warnings.filterwarnings("ignore", category=FutureWarning)

# ---------- ticker 映射: 我们的内部 ticker -> yfinance symbol ----------
# (region, symbol) ；region 是给前端 region 字段交叉验证用，可忽略
TICKER_MAP: dict[str, str] = {
    # ===== L0 能源底座 =====
    "GEV":    "GEV",
    "ENR":    "ENR.DE",       # Siemens Energy Frankfurt
    "MHI":    "7011.T",       # 三菱重工 东京
    "VST":    "VST",
    "CEG":    "CEG",
    "TLN":    "TLN",
    "OKLO":   "OKLO",
    "601985": "601985.SS",    # 中国核电
    "003816": "003816.SZ",    # 中国广核
    "VRT":    "VRT",
    "ETN":    "ETN",
    "002335": "002335.SZ",    # 科华数据
    "002518": "002518.SZ",    # 科士达

    # ===== L1 EDA · 设备 · 材料 =====
    "SNPS":   "SNPS",
    "CDNS":   "CDNS",
    "ARM":    "ARM",
    "301269": "301269.SZ",    # 华大九天
    "688521": "688521.SS",    # 芯原股份
    "ASML":   "ASML",
    "AMAT":   "AMAT",
    "LRCX":   "LRCX",
    "KLAC":   "KLAC",
    "8035":   "8035.T",       # Tokyo Electron
    "002371": "002371.SZ",    # 北方华创
    "688012": "688012.SS",    # 中微公司
    "688072": "688072.SS",    # 拓荆科技
    "688120": "688120.SS",    # 华海清科
    "4063":   "4063.T",       # 信越化学
    "688126": "688126.SS",    # 沪硅产业
    "688019": "688019.SS",    # 安集科技
    "300346": "300346.SZ",    # 南大光电
    "688268": "688268.SS",    # 华特气体
    # Serenity chokepoint · 关键金属 / 上游材料
    "002428": "002428.SZ",    # 云南锗业
    "000831": "000831.SZ",    # 中国稀土
    "600301": "600301.SS",    # 华锡有色
    "002409": "002409.SZ",    # 雅克科技
    "300666": "300666.SZ",    # 江丰电子
    "000962": "000962.SZ",    # 东方钽业
    "000960": "000960.SZ",    # 锡业股份

    # ===== L2 晶圆 · 封装 · HBM =====
    "TSM":    "TSM",
    "005930": "005930.KS",    # Samsung 韩国
    "INTC":   "INTC",
    "981":    "0981.HK",      # 中芯国际 港
    "1347":   "1347.HK",      # 华虹半导体 港
    "3711":   "3711.TW",      # 日月光 台
    "AMKR":   "AMKR",
    "600584": "600584.SS",    # 长电科技
    "002156": "002156.SZ",    # 通富微电
    "002185": "002185.SZ",    # 华天科技
    "000660": "000660.KS",    # SK Hynix 韩
    "MU":     "MU",

    # ===== L3 AI 芯片 =====
    "NVDA":   "NVDA",
    "AMD":    "AMD",
    "AVGO":   "AVGO",
    "MRVL":   "MRVL",
    "3661":   "3661.TW",      # 世芯
    "688256": "688256.SS",    # 寒武纪
    "688041": "688041.SS",    # 海光信息
    "QCOM":   "QCOM",
    "2454":   "2454.TW",      # 联发科

    # ===== L4 数据中心基建 =====
    "SMCI":   "SMCI",
    "DELL":   "DELL",
    "601138": "601138.SS",    # 工业富联
    "2317":   "2317.TW",      # 鸿海
    "2382":   "2382.TW",      # 广达
    "000977": "000977.SZ",    # 浪潮信息
    "603019": "603019.SS",    # 中科曙光
    "300308": "300308.SZ",    # 中际旭创
    "300502": "300502.SZ",    # 新易盛
    "300394": "300394.SZ",    # 天孚通信
    "688498": "688498.SS",    # 源杰科技
    "002222": "002222.SZ",    # 福晶科技
    "ANET":   "ANET",
    "COHR":   "COHR",
    "CSCO":   "CSCO",
    "002837": "002837.SZ",    # 英维克
    "301018": "301018.SZ",    # 申菱环境
    "300499": "300499.SZ",    # 高澜股份
    "872808": "872808.BJ",    # 曙光数创（北交所）— yfinance 可能拿不到
    "EQIX":   "EQIX",
    "DLR":    "DLR",
    "9698":   "9698.HK",      # 万国数据 港
    "600845": "600845.SS",    # 宝信软件
    "300442": "300442.SZ",    # 润泽科技
    "CRWV":   "CRWV",
    "NBIS":   "NBIS",
    "APLD":   "APLD",

    # ===== L5 云 · 模型 · 数据 =====
    "MSFT":   "MSFT",
    "GOOGL":  "GOOGL",
    "AMZN":   "AMZN",
    "META":   "META",
    "ORCL":   "ORCL",
    "9988":   "9988.HK",      # 阿里 港
    "700":    "0700.HK",      # 腾讯 港
    "9888":   "9888.HK",      # 百度 港
    "PLTR":   "PLTR",
    "SNOW":   "SNOW",
    "DDOG":   "DDOG",
    "MDB":    "MDB",

    # ===== L6 AI 应用 =====
    "CRM":    "CRM",
    "ADBE":   "ADBE",
    "NOW":    "NOW",
    "TEM":    "TEM",
    "RXRX":   "RXRX",
    "VEEV":   "VEEV",
    "DUOL":   "DUOL",
    "TSLA":   "TSLA",
    "PONY":   "PONY",
    "WRD":    "WRD",
    "002050": "002050.SZ",    # 三花智控
    "688017": "688017.SS",    # 绿的谐波
    "601689": "601689.SS",    # 拓普集团

    # ===== L7 端侧 =====
    "AAPL":   "AAPL",
    "005930-S": "005930.KS",  # Samsung （同上）
    "1810":   "1810.HK",      # 小米
    "META-S": "META",         # Meta Ray-Ban 用 META 代理
    "002475": "002475.SZ",    # 立讯精密
    "002241": "002241.SZ",    # 歌尔股份
    "2018":   "2018.HK",      # 瑞声
}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # = .../web(本文件在 web/data/)
# BUG 修复:之前是 ROOT/"web"/"public"/"data" → 多一层 web → 写到 web/web/public/data 死路。
# 站点读的是 web/public/data,于是 pulse-snapshot 静默冻结 20 天(refresh_all 和 GitHub Actions 都白跑)。
# ROOT 已经是 web,这里及下方 out_dir 都不能再加一层 "web"。DB_PATH 用 ROOT/"data" 本就对。
OUTPUT_PATH = os.path.join(ROOT, "public", "data", "pulse-snapshot.json")
DB_PATH = os.path.join(ROOT, "data", "pulse.db")


# ---------- SQLite schema + 写入 ----------
# Layer 1 (Bronze): pulse_snapshots (legacy, JSON blob, 暂时保留兼容前端)
# Layer 2 (Silver): fundamentals_ttm + prices_daily (新，独立列 schema)
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS pulse_snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker          TEXT    NOT NULL,
  symbol          TEXT,
  snapshot_date   TEXT    NOT NULL,
  price           REAL,
  valuation_pct   REAL,
  valuation_method TEXT,
  momentum_20d    REAL,
  rsi             REAL,
  sentiment       REAL,
  last_bar        TEXT,
  bars            INTEGER,
  fundamentals_json TEXT,
  data_sources    TEXT,
  ok              INTEGER NOT NULL,
  error           TEXT,
  fetched_at      TEXT    NOT NULL,
  UNIQUE(ticker, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_ticker_date
  ON pulse_snapshots(ticker, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_snapshots_date
  ON pulse_snapshots(snapshot_date DESC);

CREATE TABLE IF NOT EXISTS fetch_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_date     TEXT    NOT NULL,
  started_at   TEXT    NOT NULL,
  finished_at  TEXT,
  total        INTEGER,
  ok_count     INTEGER,
  partial_count INTEGER,
  missing_count INTEGER,
  duration_sec REAL,
  notes        TEXT
);

-- ============ Silver Layer ============

-- 每日 OHLCV (5y backfill on first run, daily increment after)
CREATE TABLE IF NOT EXISTS prices_daily (
  ticker  TEXT NOT NULL,
  date    TEXT NOT NULL,           -- YYYY-MM-DD
  open    REAL,
  high    REAL,
  low     REAL,
  close   REAL,
  volume  INTEGER,
  source  TEXT,                    -- yfinance / akshare
  fetched_at TEXT,
  PRIMARY KEY (ticker, date)
);
CREATE INDEX IF NOT EXISTS idx_prices_date     ON prices_daily(date DESC);
CREATE INDEX IF NOT EXISTS idx_prices_ticker   ON prices_daily(ticker);

-- 基本面 TTM 快照（每天一行）
CREATE TABLE IF NOT EXISTS fundamentals_ttm (
  ticker            TEXT NOT NULL,
  snapshot_date     TEXT NOT NULL,
  -- 估值
  trailing_pe       REAL,
  forward_pe        REAL,
  pb                REAL,
  ps                REAL,
  -- 盈利质量
  roe               REAL,
  roa               REAL,
  profit_margin     REAL,
  operating_margin  REAL,
  gross_margin      REAL,
  fcf_margin        REAL,
  -- 增长
  revenue_growth    REAL,
  earnings_growth   REAL,
  -- 杠杆 / 流动性
  debt_to_equity    REAL,
  current_ratio     REAL,
  -- 其他
  dividend_yield    REAL,
  beta              REAL,
  trailing_eps      REAL,
  forward_eps       REAL,
  -- 规模（用于 cross-validate / sanity check）
  market_cap        REAL,
  total_revenue     REAL,
  free_cashflow     REAL,
  -- meta
  source            TEXT,
  fetched_at        TEXT,
  PRIMARY KEY (ticker, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_fund_date  ON fundamentals_ttm(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_fund_roe   ON fundamentals_ttm(roe);
CREATE INDEX IF NOT EXISTS idx_fund_pe    ON fundamentals_ttm(trailing_pe);

-- ============ Gold Layer (派生指标时间序列) ============
CREATE TABLE IF NOT EXISTS metrics_daily (
  ticker         TEXT NOT NULL,
  snapshot_date  TEXT NOT NULL,
  valuation_pct  REAL,
  momentum_20d   REAL,
  rsi            REAL,
  sentiment      REAL,
  heat           REAL,    -- = val*0.4 + mom*0.3 + rsi*0.2 + sent*0.1
  source         TEXT,
  fetched_at     TEXT,
  PRIMARY KEY (ticker, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_metrics_date ON metrics_daily(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_heat ON metrics_daily(heat DESC);

-- ============ Silver · Quarterly Financials ============
CREATE TABLE IF NOT EXISTS financials_quarterly (
  ticker             TEXT NOT NULL,
  period_end         TEXT NOT NULL,        -- 季度末 YYYY-MM-DD
  total_revenue      REAL,
  gross_profit       REAL,
  operating_income   REAL,
  net_income         REAL,
  diluted_eps        REAL,
  basic_eps          REAL,
  operating_cashflow REAL,
  free_cashflow      REAL,
  total_assets       REAL,
  total_debt         REAL,
  total_equity       REAL,
  source             TEXT,
  fetched_at         TEXT,
  PRIMARY KEY (ticker, period_end)
);
CREATE INDEX IF NOT EXISTS idx_fin_q_date ON financials_quarterly(period_end DESC);

-- ============ Silver · Events ============
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker       TEXT NOT NULL,
  event_date   TEXT NOT NULL,    -- YYYY-MM-DD
  event_type   TEXT NOT NULL,    -- earnings / dividend / split / news
  payload_json TEXT,
  source       TEXT,
  fetched_at   TEXT,
  UNIQUE(ticker, event_date, event_type)
);
CREATE INDEX IF NOT EXISTS idx_events_ticker_date ON events(ticker, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_date   ON events(event_type, event_date DESC);

-- ============ Silver · Northbound Flow (A 股) ============
CREATE TABLE IF NOT EXISTS northbound_flow (
  ticker         TEXT NOT NULL,
  date           TEXT NOT NULL,
  holding_shares REAL,            -- 北向持股
  holding_pct    REAL,            -- 占流通股比例
  net_buy_amt    REAL,            -- 当日净买入额
  source         TEXT,
  fetched_at     TEXT,
  PRIMARY KEY (ticker, date)
);
CREATE INDEX IF NOT EXISTS idx_nb_date ON northbound_flow(date DESC);
"""


def db_connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA_SQL)
    return conn


def _safe_get(stmt: pd.DataFrame, key_candidates: list[str], col) -> Optional[float]:
    """从 yfinance 财报 DataFrame（行=指标，列=日期）取指定字段"""
    if stmt is None or stmt.empty:
        return None
    for k in key_candidates:
        if k in stmt.index:
            try:
                v = stmt.loc[k, col]
                if pd.notna(v):
                    return float(v)
            except (KeyError, TypeError, ValueError):
                continue
    return None


def db_write_financials(conn: sqlite3.Connection, ticker: str,
                         inc: pd.DataFrame, cf: pd.DataFrame, bs: pd.DataFrame,
                         source: str) -> int:
    """写季度财报。yfinance 三张表 rows=指标 cols=季度末日期"""
    if inc is None or inc.empty:
        return 0
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows = []
    for col in inc.columns:
        try:
            period_end = col.strftime("%Y-%m-%d") if hasattr(col, "strftime") else str(col)[:10]
        except Exception:
            continue
        rev   = _safe_get(inc, ["Total Revenue", "TotalRevenue"], col)
        gp    = _safe_get(inc, ["Gross Profit", "GrossProfit"], col)
        oi    = _safe_get(inc, ["Operating Income", "OperatingIncome"], col)
        ni    = _safe_get(inc, ["Net Income", "NetIncome", "Net Income Common Stockholders"], col)
        deps  = _safe_get(inc, ["Diluted EPS", "DilutedEPS"], col)
        beps  = _safe_get(inc, ["Basic EPS", "BasicEPS"], col)
        ocf   = _safe_get(cf,  ["Operating Cash Flow", "OperatingCashFlow", "Cash Flow From Continuing Operating Activities"], col)
        fcf   = _safe_get(cf,  ["Free Cash Flow", "FreeCashFlow"], col)
        ta    = _safe_get(bs,  ["Total Assets", "TotalAssets"], col)
        td    = _safe_get(bs,  ["Total Debt", "TotalDebt"], col)
        te    = _safe_get(bs,  ["Stockholders Equity", "StockholdersEquity", "Total Equity Gross Minority Interest"], col)
        rows.append((
            ticker, period_end, rev, gp, oi, ni, deps, beps, ocf, fcf, ta, td, te,
            source, fetched_at,
        ))
    if not rows:
        return 0
    conn.executemany(
        """INSERT OR REPLACE INTO financials_quarterly
           (ticker, period_end,
            total_revenue, gross_profit, operating_income, net_income,
            diluted_eps, basic_eps, operating_cashflow, free_cashflow,
            total_assets, total_debt, total_equity,
            source, fetched_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        rows,
    )
    return len(rows)


def db_write_events(conn: sqlite3.Connection, ticker: str,
                     earnings_dates: Optional[pd.DataFrame],
                     dividends: Optional[pd.Series],
                     splits: Optional[pd.Series],
                     source: str) -> int:
    """写 events 表（财报日 / 分红 / 拆股）"""
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows: list[tuple] = []

    # 财报日
    if earnings_dates is not None and not earnings_dates.empty:
        for idx, row in earnings_dates.iterrows():
            try:
                d = idx.strftime("%Y-%m-%d")
            except Exception:
                continue
            payload = {}
            for k in ["EPS Estimate", "Reported EPS", "Surprise(%)"]:
                if k in row.index and pd.notna(row[k]):
                    payload[k] = float(row[k])
            rows.append((ticker, d, "earnings", json.dumps(payload, ensure_ascii=False), source, fetched_at))

    # 分红
    if dividends is not None and len(dividends) > 0:
        for idx, v in dividends.items():
            try:
                d = idx.strftime("%Y-%m-%d")
            except Exception:
                continue
            rows.append((ticker, d, "dividend", json.dumps({"amount": float(v)}), source, fetched_at))

    # 拆股
    if splits is not None and len(splits) > 0:
        for idx, v in splits.items():
            try:
                d = idx.strftime("%Y-%m-%d")
            except Exception:
                continue
            rows.append((ticker, d, "split", json.dumps({"ratio": float(v)}), source, fetched_at))

    if not rows:
        return 0
    conn.executemany(
        """INSERT OR IGNORE INTO events
           (ticker, event_date, event_type, payload_json, source, fetched_at)
           VALUES (?,?,?,?,?,?)""",
        rows,
    )
    return len(rows)


def db_write_northbound(conn: sqlite3.Connection, ticker: str, df: pd.DataFrame, source: str) -> int:
    """写北向资金时序"""
    if df is None or df.empty:
        return 0
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    # akshare 返回的列：持股日期 / 当日收盘价 / 当日涨跌幅 / 持股数量 /
    #                  持股市值 / 持股数量占A股百分比 / 今日增持股数 / 今日增持资金 / 今日持股市值变化
    rows = []
    for _, row in df.iterrows():
        try:
            d = pd.to_datetime(row["持股日期"]).strftime("%Y-%m-%d")
        except Exception:
            continue
        shares = float(row["持股数量"]) if pd.notna(row.get("持股数量")) else None
        pct = float(row["持股数量占A股百分比"]) if pd.notna(row.get("持股数量占A股百分比")) else None
        net_buy = float(row["今日增持资金"]) if pd.notna(row.get("今日增持资金")) else None
        rows.append((ticker, d, shares, pct, net_buy, source, fetched_at))
    if not rows:
        return 0
    conn.executemany(
        """INSERT OR REPLACE INTO northbound_flow
           (ticker, date, holding_shares, holding_pct, net_buy_amt, source, fetched_at)
           VALUES (?,?,?,?,?,?,?)""",
        rows,
    )
    return len(rows)


# 抓 A 股北向：仅对 .SS / .SZ 标的有效，BJ 北交所 akshare 也不全
def fetch_northbound(internal_ticker: str, yf_symbol: str) -> Optional[pd.DataFrame]:
    if not AK_AVAILABLE:
        return None
    # 提取 6 位数字 ticker（去掉 .SS / .SZ）
    if not (yf_symbol.endswith(".SS") or yf_symbol.endswith(".SZ")):
        return None
    code = yf_symbol.split(".")[0]
    try:
        df = ak.stock_hsgt_individual_em(symbol=code)
        if df is None or df.empty:
            return None
        return df
    except Exception:
        return None


def db_write_metrics(conn: sqlite3.Connection, ticker: str, snapshot_date: str,
                      metrics: dict, source: str) -> None:
    """写 Gold 层 metrics_daily（heat 时间序列）"""
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    val = metrics.get("valuationPct")
    mom = metrics.get("momentum20d")
    rsi = metrics.get("rsi")
    sent = metrics.get("sentiment")
    # heat = val*0.4 + mom*0.3 + rsi*0.2 + sent*0.1 (同 TS computeHeat)
    parts = [(val, 0.4), (mom, 0.3), (rsi, 0.2), (sent, 0.1)]
    if any(v is None for v, _ in parts):
        heat = None
    else:
        heat = round(sum(v * w for v, w in parts), 1)
    conn.execute(
        """INSERT OR REPLACE INTO metrics_daily
           (ticker, snapshot_date, valuation_pct, momentum_20d, rsi, sentiment, heat, source, fetched_at)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (ticker, snapshot_date, val, mom, rsi, sent, heat, source, fetched_at),
    )


def db_write_prices(conn: sqlite3.Connection, ticker: str, df: pd.DataFrame, source: str) -> int:
    """把 OHLCV DataFrame 批量写入 prices_daily（INSERT OR REPLACE）"""
    if df is None or df.empty:
        return 0
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows = []
    for idx, row in df.iterrows():
        try:
            date_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
            rows.append((
                ticker, date_str,
                float(row["Open"])   if "Open"   in df.columns and pd.notna(row["Open"])   else None,
                float(row["High"])   if "High"   in df.columns and pd.notna(row["High"])   else None,
                float(row["Low"])    if "Low"    in df.columns and pd.notna(row["Low"])    else None,
                float(row["Close"])  if "Close"  in df.columns and pd.notna(row["Close"])  else None,
                int(row["Volume"])   if "Volume" in df.columns and pd.notna(row["Volume"]) else None,
                source, fetched_at,
            ))
        except (TypeError, ValueError):
            continue
    if not rows:
        return 0
    conn.executemany(
        """INSERT OR REPLACE INTO prices_daily
           (ticker, date, open, high, low, close, volume, source, fetched_at)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        rows,
    )
    return len(rows)


def db_write_fundamentals(conn: sqlite3.Connection, ticker: str, snapshot_date: str,
                           f: dict, source: str) -> None:
    """把 fundamentals dict 拍平写到独立列"""
    if not f:
        return
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    g = lambda k: f.get(k) if f.get(k) is not None else None
    conn.execute(
        """INSERT OR REPLACE INTO fundamentals_ttm
           (ticker, snapshot_date,
            trailing_pe, forward_pe, pb, ps,
            roe, roa, profit_margin, operating_margin, gross_margin, fcf_margin,
            revenue_growth, earnings_growth,
            debt_to_equity, current_ratio,
            dividend_yield, beta, trailing_eps, forward_eps,
            market_cap, total_revenue, free_cashflow,
            source, fetched_at)
           VALUES (?,?, ?,?,?,?, ?,?,?,?,?,?, ?,?, ?,?, ?,?,?,?, ?,?,?, ?,?)""",
        (
            ticker, snapshot_date,
            g("trailingPE"), g("forwardPE"), g("priceToBook"), g("priceToSales"),
            g("roe"), g("roa"), g("profitMargin"), g("operatingMargin"), g("grossMargin"), g("fcfMargin"),
            g("revenueGrowth"), g("earningsGrowth"),
            g("debtToEquity"), g("currentRatio"),
            g("dividendYield"), g("beta"), g("trailingEps"), g("forwardEps"),
            g("marketCap"), g("totalRevenue"), g("fcf"),
            source, fetched_at,
        ),
    )


def db_write_snapshot(conn: sqlite3.Connection, ticker: str, snapshot_date: str,
                       metrics: Optional[dict], error: Optional[str],
                       data_sources: list[str]) -> None:
    """写入一条 snapshot 记录（UPSERT 覆盖当日）"""
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if metrics:
        fund_json = json.dumps(metrics.get("fundamentals"), ensure_ascii=False) if metrics.get("fundamentals") else None
        # ok=1 完全成功；如果有 fundamentals 缺关键字段则 ok=2 (partial)，记录字段缺失数
        ok_flag = 1
        if not metrics.get("fundamentals"):
            ok_flag = 2
        else:
            req = ("trailingPE", "forwardPE", "roe", "profitMargin")
            missing = sum(1 for k in req if k not in metrics["fundamentals"])
            if missing >= 2:
                ok_flag = 2
        conn.execute(
            """
            INSERT INTO pulse_snapshots
              (ticker, symbol, snapshot_date, price, valuation_pct, valuation_method,
               momentum_20d, rsi, sentiment, last_bar, bars,
               fundamentals_json, data_sources, ok, error, fetched_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(ticker, snapshot_date) DO UPDATE SET
              symbol=excluded.symbol,
              price=excluded.price,
              valuation_pct=excluded.valuation_pct,
              valuation_method=excluded.valuation_method,
              momentum_20d=excluded.momentum_20d,
              rsi=excluded.rsi,
              sentiment=excluded.sentiment,
              last_bar=excluded.last_bar,
              bars=excluded.bars,
              fundamentals_json=excluded.fundamentals_json,
              data_sources=excluded.data_sources,
              ok=excluded.ok,
              error=excluded.error,
              fetched_at=excluded.fetched_at
            """,
            (
                ticker, metrics.get("symbol"), snapshot_date,
                metrics.get("price"), metrics.get("valuationPct"), metrics.get("valuationMethod"),
                metrics.get("momentum20d"), metrics.get("rsi"), metrics.get("sentiment"),
                metrics.get("lastBar"), metrics.get("bars"),
                fund_json, ",".join(data_sources), ok_flag, None, fetched_at,
            ),
        )
    else:
        conn.execute(
            """
            INSERT INTO pulse_snapshots
              (ticker, symbol, snapshot_date, ok, error, fetched_at, data_sources)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(ticker, snapshot_date) DO UPDATE SET
              ok=excluded.ok, error=excluded.error, fetched_at=excluded.fetched_at,
              data_sources=excluded.data_sources
            """,
            (ticker, None, snapshot_date, 0, error or "unknown", fetched_at, ",".join(data_sources)),
        )


# ---------- 指标计算 ----------
def rsi14(close: pd.Series) -> float:
    """标准 14D RSI（最近一根 bar）"""
    if len(close) < 20:
        return float("nan")
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / 14, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / 14, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return float(rsi.iloc[-1]) if not pd.isna(rsi.iloc[-1]) else float("nan")


def percentile_of(value: float, distribution: pd.Series) -> float:
    """value 在分布中的百分位 0-100"""
    d = distribution.dropna()
    if len(d) == 0:
        return float("nan")
    return float((d <= value).mean() * 100)


def compute_pe_history_pct(close: pd.Series, eps_ttm: Optional[float]) -> Optional[float]:
    """用当前 EPS_TTM × 历史价拼出 5y PE 序列，返回当前 PE 在历史的百分位。
    简化假设：EPS 在 5y 内做了温和增长，使用当前 EPS 兜底当作近似。
    严格做法需要拼接历史 EPS（财报数据），这里先用更可获取的代理。"""
    if not eps_ttm or eps_ttm <= 0:
        return None
    pe_series = close / eps_ttm  # 如果只用当前 EPS，相当于把价格 normalize
    cur_pe = float(close.iloc[-1] / eps_ttm)
    return percentile_of(cur_pe, pe_series)


def compute_metrics(df: pd.DataFrame, info: Optional[dict] = None) -> Optional[dict]:
    """对一个 ticker 的 OHLC DataFrame 算 4 项 heat 指标 + fundamentals"""
    if df is None or df.empty or "Close" not in df.columns:
        return None
    close = df["Close"].dropna()
    if len(close) < 30:
        return None
    vol = df.get("Volume", pd.Series(dtype=float)).dropna()

    last = float(close.iloc[-1])

    # 1) valuationPct — 优先用 PE 历史分位，fallback 价格分位
    eps_ttm = (info or {}).get("trailingEps")
    val_pct_pe = compute_pe_history_pct(close, eps_ttm) if eps_ttm else None
    val_pct_price = percentile_of(last, close)
    val_pct = val_pct_pe if val_pct_pe is not None else val_pct_price
    val_method = "pe_history" if val_pct_pe is not None else "price_history"

    # 2) momentum20d
    if len(close) >= 21:
        rets_20 = close.pct_change(20).dropna()
        cur_ret = float(rets_20.iloc[-1]) if len(rets_20) else float("nan")
        window = rets_20.tail(252)
        mom_pct = percentile_of(cur_ret, window) if not pd.isna(cur_ret) else float("nan")
    else:
        mom_pct = float("nan")

    # 3) RSI14
    rsi_v = rsi14(close)

    # 4) sentiment
    if len(close) >= 6:
        ret_5 = float(close.iloc[-1] / close.iloc[-6] - 1)
        rets_5 = close.pct_change(5).dropna().tail(252)
        ret_5_pct = percentile_of(ret_5, rets_5)
    else:
        ret_5_pct = float("nan")
    if len(vol) >= 65:
        recent_vol = float(vol.tail(5).mean())
        base_vol = float(vol.tail(63).mean())
        vol_ratio = recent_vol / base_vol if base_vol > 0 else 1.0
        vol_score = float(np.clip((vol_ratio - 0.5) / 1.5 * 100, 0, 100))
    else:
        vol_score = 50.0
    if pd.isna(ret_5_pct):
        sentiment = vol_score
    else:
        sentiment = ret_5_pct * 0.6 + vol_score * 0.4

    out = {
        "price": round(last, 4),
        "valuationPct": round(val_pct, 1) if not pd.isna(val_pct) else None,
        "valuationMethod": val_method,
        "momentum20d": round(mom_pct, 1) if not pd.isna(mom_pct) else None,
        "rsi": round(rsi_v, 1) if not pd.isna(rsi_v) else None,
        "sentiment": round(sentiment, 1) if not pd.isna(sentiment) else None,
        "lastBar": str(close.index[-1].date()),
        "bars": int(len(close)),
    }

    # ---- fundamentals 切片（三方评分用）----
    if info:
        f = {
            "trailingPE": info.get("trailingPE"),
            "forwardPE": info.get("forwardPE"),
            "priceToBook": info.get("priceToBook"),
            "priceToSales": info.get("priceToSalesTrailing12Months"),
            "roe": info.get("returnOnEquity"),
            "roa": info.get("returnOnAssets"),
            "profitMargin": info.get("profitMargins"),
            "operatingMargin": info.get("operatingMargins"),
            "grossMargin": info.get("grossMargins"),
            "fcf": info.get("freeCashflow"),
            "totalRevenue": info.get("totalRevenue"),
            "marketCap": info.get("marketCap"),
            "debtToEquity": info.get("debtToEquity"),
            "currentRatio": info.get("currentRatio"),
            "revenueGrowth": info.get("revenueGrowth"),
            "earningsGrowth": info.get("earningsGrowth"),
            "beta": info.get("beta"),
            "trailingEps": info.get("trailingEps"),
            "forwardEps": info.get("forwardEps"),
            "dividendYield": info.get("dividendYield"),
        }
        # FCF / Revenue 比率（FCF margin）
        if f["fcf"] and f["totalRevenue"]:
            try:
                f["fcfMargin"] = float(f["fcf"]) / float(f["totalRevenue"])
            except (TypeError, ZeroDivisionError):
                f["fcfMargin"] = None
        # 清掉 None 字段以减少 JSON 体积
        out["fundamentals"] = {k: v for k, v in f.items() if v is not None}

    return out


# ---------- 抓数 ----------
def fetch_one(internal_ticker: str, yf_symbol: str, max_retry: int = 2
              ) -> tuple[str, Optional[dict], Optional[pd.DataFrame], Optional[dict], Optional[str]]:
    """返回 (ticker, metrics, ohlcv_df, extras, error)
    extras 包含: income / cashflow / balance_sheet / earnings_dates / dividends / splits
    """
    last_err: Optional[str] = None
    for attempt in range(max_retry + 1):
        try:
            tk = yf.Ticker(yf_symbol)
            df = tk.history(period="5y", interval="1d", auto_adjust=True)
            if df is None or df.empty:
                last_err = "empty"
                time.sleep(0.8 + attempt * 0.5)
                continue
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            df = df.loc[:, ~df.columns.duplicated()]
            info: Optional[dict] = None
            try:
                info = tk.info or {}
            except Exception:
                info = None
            metrics = compute_metrics(df, info)
            if metrics is None:
                last_err = "insufficient"
                return internal_ticker, None, None, None, last_err
            metrics["symbol"] = yf_symbol

            # 抓取财报 + 事件（best-effort，失败不阻塞主流程）
            extras: dict = {}
            try:
                extras["income"] = tk.quarterly_income_stmt
            except Exception:
                extras["income"] = None
            try:
                extras["cashflow"] = tk.quarterly_cashflow
            except Exception:
                extras["cashflow"] = None
            try:
                extras["balance_sheet"] = tk.quarterly_balance_sheet
            except Exception:
                extras["balance_sheet"] = None
            try:
                extras["earnings_dates"] = tk.earnings_dates
            except Exception:
                extras["earnings_dates"] = None
            try:
                extras["dividends"] = tk.dividends
            except Exception:
                extras["dividends"] = None
            try:
                extras["splits"] = tk.splits
            except Exception:
                extras["splits"] = None

            return internal_ticker, metrics, df, extras, None
        except Exception as e:
            last_err = f"{type(e).__name__}:{str(e)[:80]}"
            time.sleep(0.6 + attempt * 0.6)
    return internal_ticker, None, None, None, last_err or "unknown"


def main() -> int:
    print(f"[fetch] {len(TICKER_MAP)} tickers", flush=True)
    print(f"  json  -> {OUTPUT_PATH}")
    print(f"  sqlite-> {DB_PATH}")
    items: dict[str, dict] = {}
    errors: dict[str, str] = {}
    started = time.time()
    started_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    snapshot_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    conn = db_connect()
    # 记 fetch_runs 一条 in-progress
    cur = conn.execute(
        "INSERT INTO fetch_runs (run_date, started_at, total) VALUES (?, ?, ?)",
        (snapshot_date, started_iso, len(TICKER_MAP)),
    )
    run_id = cur.lastrowid
    conn.commit()

    total_price_rows = 0
    total_fin_rows = 0
    total_event_rows = 0
    # 并发 6 路（拉财报后稍微慢，控小一些）
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(fetch_one, k, v): k for k, v in TICKER_MAP.items()}
        done = 0
        for fut in as_completed(futs):
            internal, metrics, ohlcv, extras, err = fut.result()
            done += 1
            if metrics:
                items[internal] = metrics
                # Bronze (legacy): pulse_snapshots
                db_write_snapshot(conn, internal, snapshot_date, metrics, None, ["yfinance"])
                # Silver: prices_daily
                if ohlcv is not None:
                    total_price_rows += db_write_prices(conn, internal, ohlcv, "yfinance")
                # Silver: fundamentals_ttm
                if metrics.get("fundamentals"):
                    db_write_fundamentals(conn, internal, snapshot_date, metrics["fundamentals"], "yfinance")
                # Silver: financials_quarterly + events
                if extras:
                    total_fin_rows += db_write_financials(
                        conn, internal,
                        extras.get("income"), extras.get("cashflow"), extras.get("balance_sheet"),
                        "yfinance",
                    )
                    total_event_rows += db_write_events(
                        conn, internal,
                        extras.get("earnings_dates"), extras.get("dividends"), extras.get("splits"),
                        "yfinance",
                    )
                # Gold: metrics_daily
                db_write_metrics(conn, internal, snapshot_date, metrics, "yfinance")
            else:
                errors[internal] = err or "unknown"
                db_write_snapshot(conn, internal, snapshot_date, None, err, ["yfinance"])
            if done % 10 == 0 or done == len(TICKER_MAP):
                conn.commit()
                print(f"  {done}/{len(TICKER_MAP)} ok={len(items)} err={len(errors)} "
                      f"prices={total_price_rows} fin_q={total_fin_rows} events={total_event_rows}",
                      flush=True)

    # ===== 导出静态 JSON 给前端读（Vercel 静态化） =====
    def export_static_json():
        out_dir = os.path.join(ROOT, "public", "data")  # 同上:ROOT 已是 web,不再加 "web"(trends/coverage/events 也曾跑偏)
        os.makedirs(out_dir, exist_ok=True)

        # 1. trends.json — 每个 ticker × 30 天 (date, close, heat)
        trends = {}
        rows = conn.execute(
            """SELECT p.ticker, p.date, p.close, m.heat
               FROM prices_daily p
               LEFT JOIN metrics_daily m ON m.ticker = p.ticker AND m.snapshot_date = p.date
               WHERE p.date >= DATE('now','-45 days')
               ORDER BY p.ticker, p.date"""
        ).fetchall()
        for tk, d, close, heat in rows:
            trends.setdefault(tk, []).append({"date": d, "close": close, "heat": heat})
        # 每只取最后 30 个
        trends = {k: v[-30:] for k, v in trends.items() if len(v) >= 5}
        with open(os.path.join(out_dir, "trends.json"), "w", encoding="utf-8") as f:
            json.dump(trends, f, ensure_ascii=False, separators=(",", ":"))
        print(f"[export] trends.json {len(trends)} tickers", flush=True)

        # 2. coverage.json — 每个 ticker 每个字段的覆盖度
        cov_rows = conn.execute(
            """SELECT ticker, snapshot_date, ok, error,
                      valuation_pct, momentum_20d, rsi, sentiment, fundamentals_json
               FROM pulse_snapshots
               WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM pulse_snapshots)"""
        ).fetchall()
        coverage = []
        for r in cov_rows:
            f_obj = json.loads(r[8]) if r[8] else None
            coverage.append({
                "ticker": r[0],
                "snapshot_date": r[1],
                "ok": r[2],
                "error": r[3],
                "metrics": {
                    "valuation_pct": r[4] is not None,
                    "momentum_20d": r[5] is not None,
                    "rsi":          r[6] is not None,
                    "sentiment":    r[7] is not None,
                },
                "fundamentals": {k: f_obj.get(k) is not None for k in
                                 ["trailingPE","forwardPE","priceToBook","priceToSales",
                                  "roe","roa","profitMargin","operatingMargin","grossMargin",
                                  "fcfMargin","revenueGrowth","earningsGrowth","debtToEquity"]} if f_obj else {},
            })
        # fetch_runs 最近 7 次
        run_rows = conn.execute(
            """SELECT id, run_date, started_at, finished_at, total, ok_count,
                      partial_count, missing_count, duration_sec
               FROM fetch_runs ORDER BY id DESC LIMIT 7"""
        ).fetchall()
        runs = [{"id":r[0],"run_date":r[1],"started_at":r[2],"finished_at":r[3],
                 "total":r[4],"ok_count":r[5],"partial_count":r[6],
                 "missing_count":r[7],"duration_sec":r[8]} for r in run_rows]
        cov_payload = {
            "snapshot_date": cov_rows[0][1] if cov_rows else None,
            "rows": coverage,
            "runs": runs,
        }
        with open(os.path.join(out_dir, "coverage.json"), "w", encoding="utf-8") as f:
            json.dump(cov_payload, f, ensure_ascii=False, separators=(",", ":"))
        print(f"[export] coverage.json {len(coverage)} rows / {len(runs)} runs", flush=True)

        # 3. events-recent.json — 每只票最近 5 个事件 + 未来 90 天财报
        events_by_ticker = {}
        ev_rows = conn.execute(
            """SELECT ticker, event_date, event_type, payload_json
               FROM events
               WHERE event_date >= DATE('now','-180 days')
                  OR event_date <= DATE('now','+180 days')
               ORDER BY ticker, event_date DESC"""
        ).fetchall()
        for tk, d, t, pl in ev_rows:
            events_by_ticker.setdefault(tk, [])
            if len(events_by_ticker[tk]) < 8:
                events_by_ticker[tk].append({
                    "date": d, "type": t,
                    "payload": json.loads(pl) if pl else None,
                })
        with open(os.path.join(out_dir, "events.json"), "w", encoding="utf-8") as f:
            json.dump(events_by_ticker, f, ensure_ascii=False, separators=(",", ":"))
        print(f"[export] events.json {len(events_by_ticker)} tickers", flush=True)

    # ===== akshare 北向资金抓取（仅 A 股，串行不并发避免反爬） =====
    nb_rows_total = 0
    a_stocks = [(k, v) for k, v in TICKER_MAP.items() if v.endswith(".SS") or v.endswith(".SZ")]
    if AK_AVAILABLE and a_stocks:
        print(f"\n[北向] {len(a_stocks)} A 股标的", flush=True)
        for idx, (k, v) in enumerate(a_stocks):
            try:
                df = fetch_northbound(k, v)
                if df is not None:
                    nb_rows_total += db_write_northbound(conn, k, df, "akshare")
                if (idx + 1) % 10 == 0:
                    conn.commit()
                    print(f"  北向 {idx+1}/{len(a_stocks)} 累计 {nb_rows_total} 行", flush=True)
                time.sleep(0.4)  # 限速
            except Exception:
                pass
        conn.commit()
        print(f"[北向] 完成 {nb_rows_total} 行", flush=True)
    elif not AK_AVAILABLE:
        print("[北向] akshare 未安装，跳过", flush=True)

    elapsed = time.time() - started
    ok_count = sum(1 for m in items.values() if m.get("fundamentals"))
    partial_count = len(items) - ok_count

    # 更新 run 记录
    conn.execute(
        """UPDATE fetch_runs SET finished_at = ?, ok_count = ?, partial_count = ?,
           missing_count = ?, duration_sec = ? WHERE id = ?""",
        (
            datetime.now(timezone.utc).isoformat(timespec="seconds"),
            ok_count, partial_count, len(errors), round(elapsed, 1), run_id,
        ),
    )
    conn.commit()
    conn.close()

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data_window": "5y daily OHLC (auto-adjusted)",
        "fetched_seconds": round(elapsed, 1),
        "total": len(TICKER_MAP),
        "ok": len(items),
        "missing": list(errors.keys()),
        "errors_sample": dict(list(errors.items())[:6]),
        "items": items,
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    # 导出静态 JSON（Vercel 部署用）
    try:
        export_static_json()
    except Exception as e:
        print(f"[export] failed: {type(e).__name__}: {e}", flush=True)

    print(f"[done] ok={len(items)}(full={ok_count} partial={partial_count}) "
          f"missing={len(errors)} time={elapsed:.1f}s", flush=True)
    if errors:
        print("[missing sample]")
        for k, v in list(errors.items())[:10]:
            print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
