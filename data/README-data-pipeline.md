# Data Pipeline · Leslie-stock

## 架构（Medallion 三层）

```
Bronze · 原始抓取             pulse_snapshots (legacy)
                              fetch_runs       (每次抓取元信息)
   ↓ ETL
Silver · 标准化业务表         prices_daily      (5y OHLCV, 137K+ rows)
                              fundamentals_ttm  (估值 + 盈利 + 增长 + 杠杆)
   ↓ Transform
Gold · 派生指标               (待建：metrics_daily / triple_scores_daily)
   ↓ Serve
Frontend                      public/data/pulse-snapshot.json (前端缓存)
```

## 数据库

- 文件：`data/pulse.db`（SQLite，WAL 模式）
- 备份：`~/Backups/leslie-stock/pulse-YYYYMMDD.db`（每天一份，保留 30 天）

## 表结构速查

```sql
-- 每日 OHLCV
prices_daily(ticker, date, open, high, low, close, volume, source, fetched_at)
  PRIMARY KEY (ticker, date)

-- TTM 基本面（每个 snapshot_date 一行）
fundamentals_ttm(ticker, snapshot_date,
  trailing_pe, forward_pe, pb, ps,
  roe, roa, profit_margin, operating_margin, gross_margin, fcf_margin,
  revenue_growth, earnings_growth,
  debt_to_equity, current_ratio,
  dividend_yield, beta, trailing_eps, forward_eps,
  market_cap, total_revenue, free_cashflow,
  source, fetched_at)
  PRIMARY KEY (ticker, snapshot_date)

-- 历史快照 (legacy, 含 metrics + fundamentals JSON)
pulse_snapshots(ticker, snapshot_date, price, valuation_pct, momentum_20d, rsi, sentiment, ...)
  PRIMARY KEY (ticker, snapshot_date) (UNIQUE)

-- 每次抓取记录
fetch_runs(run_date, started_at, finished_at, total, ok_count, partial_count, missing_count, duration_sec)
```

## 日常运行

### 手动跑一次
```bash
cd /Users/leslie/Workspace/ainvest/Leslie-stock
bash data/daily_pulse.sh
# 或仅 fetch 不备份：
python3 data/fetch_pulse.py
```

### 安装 launchd 日程（macOS）
```bash
cp data/com.leslie.pulse.daily.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.leslie.pulse.daily.plist

# 查看状态
launchctl list | grep com.leslie.pulse
# 立即触发一次测试
launchctl start com.leslie.pulse.daily
```

### 卸载
```bash
launchctl unload -w ~/Library/LaunchAgents/com.leslie.pulse.daily.plist
rm ~/Library/LaunchAgents/com.leslie.pulse.daily.plist
```

### 看日志
```bash
tail -f data/logs/pulse-*.log
tail -f data/logs/launchd-out.log
```

## 常用查询

```sql
-- 今天 fundamentals 全场：ROE > 30%、PE < 30、营收增速 > 30%
SELECT ticker, trailing_pe, roe, revenue_growth
FROM fundamentals_ttm
WHERE snapshot_date = DATE('now')
  AND roe > 0.30
  AND trailing_pe BETWEEN 0 AND 30
  AND revenue_growth > 0.30
ORDER BY roe DESC;

-- 某只票过去 30 天 close 走势
SELECT date, close
FROM prices_daily
WHERE ticker = 'NVDA'
ORDER BY date DESC LIMIT 30;

-- 今天哪些 ticker 缺关键 fundamentals
SELECT ticker
FROM fundamentals_ttm
WHERE snapshot_date = DATE('now')
  AND (trailing_pe IS NULL OR roe IS NULL);

-- 最近 7 次抓取统计
SELECT run_date, ok_count, missing_count, duration_sec
FROM fetch_runs ORDER BY id DESC LIMIT 7;
```

## 数据源

| Source | Coverage | Notes |
|---|---|---|
| yfinance | 美/港/A/台/韩/日/欧 | 主源；scrape Yahoo；偶发 401 / 限流 |
| akshare  | 待接入       | A 股 / 港股补漏（earningsGrowth, 北向资金） |
| Polygon  | 未接入       | $29/月，未来美股 fallback |

## 未来扩展

按 Phase 2-5 演化（见对话规划）：
- 历史季度财报（`income_stmt` / `cashflow` / `balance_sheet`）
- 事件表（财报日 / 分红 / 拆股 / 并购）
- Postgres + dbt + Great Expectations
- Supabase 部署（多用户 + Auth + Realtime）
