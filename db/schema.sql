-- Leslie-stock SQLite Schema v1
-- Single source of truth：所有股票 / 分析 / 行情 / 事件
--
-- 设计原则：
-- 1. analyses 表多版本（同一只票多个 framework × 多个 version 共存）
-- 2. runs 表记录每次评分任务（用于成本追踪 + 可回滚）
-- 3. prices 表记录日线行情
-- 4. events 表记录新闻 / 公告 / 事件
-- 5. 写入只追加，不覆盖旧数据

-- ============================================================
-- stocks：股票主表
-- ============================================================
CREATE TABLE IF NOT EXISTS stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    market TEXT NOT NULL,                    -- a / hk / us
    name TEXT NOT NULL,
    industry_category TEXT,                  -- 主业行业（akshare 分类）
    sector TEXT,                             -- 板块标签
    market_cap REAL,                         -- 市值（本币）
    market_cap_usd REAL,                     -- 美元市值
    pe_ttm REAL,
    pb REAL,
    industries TEXT,                         -- JSON array of IndustryId
    expected_layer INTEGER,                  -- 候选时预期 layer 1-4
    market_archetype TEXT,                   -- 底层市场原型：meme(A股) / contract(美股) / semi_meme(港股)
    first_seen_at TEXT NOT NULL,             -- 首次入库
    updated_at TEXT NOT NULL,                -- 最近更新
    UNIQUE(code, market)
);

CREATE INDEX IF NOT EXISTS idx_stocks_code ON stocks(code);
CREATE INDEX IF NOT EXISTS idx_stocks_market ON stocks(market);
CREATE INDEX IF NOT EXISTS idx_stocks_industry ON stocks(industry_category);

-- ============================================================
-- analyses：评分记录（多版本共存）
-- ============================================================
CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL,
    framework TEXT NOT NULL,                 -- "serenity" / "bg" / "news" / "manual"
    version TEXT NOT NULL DEFAULT 'v1',      -- 版本号
    score INTEGER,                           -- 0-100
    verdict TEXT,                            -- high_conviction / aleabit_analogue / ...
    verdict_label TEXT,
    layer INTEGER,                           -- 1-4 (Serenity) / 0-7 (AI heatmap)
    layer_label TEXT,
    thesis TEXT,
    signals TEXT,                            -- JSON array of {name, hit, note}
    signals_hit INTEGER,
    red_flags TEXT,                          -- JSON array
    ai_relevance TEXT,
    -- Market archetype (底层评分准则)
    lifecycle_stage TEXT,                    -- A股 meme game 题材生命周期：incubation/ignition/markup/distribution/decay
    archetype_read TEXT,                     -- JSON: archetype 视角的底层判读（meme: 主力/派发/连续性; contract: 对手盘/正和）
    -- BG specific fields (when framework='bg')
    bg_dimensions TEXT,                      -- JSON: {business_model, moat, ...}
    bg_sell_triggers TEXT,                   -- JSON array
    -- Metadata
    raw_response TEXT,                       -- LLM 原始响应（备份）
    model TEXT,                              -- "claude-sonnet-4.5" / "gpt-4o" / "manual" / "pre-label"
    prompt_hash TEXT,                        -- prompt 内容 hash
    pre_labeled INTEGER DEFAULT 0,           -- 是否为批量预标（无 LLM）
    run_id INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY (stock_id) REFERENCES stocks(id),
    FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE INDEX IF NOT EXISTS idx_analyses_stock ON analyses(stock_id);
CREATE INDEX IF NOT EXISTS idx_analyses_framework ON analyses(framework);
CREATE INDEX IF NOT EXISTS idx_analyses_score ON analyses(score DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_created ON analyses(created_at DESC);
-- 复合索引：拿"某 framework 最新版本评分"
CREATE INDEX IF NOT EXISTS idx_analyses_stock_framework_created
    ON analyses(stock_id, framework, created_at DESC);

-- ============================================================
-- runs：每次评分任务记录（成本追踪）
-- ============================================================
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    framework TEXT NOT NULL,
    scope TEXT,                              -- "candidates_v2" / "all_60_plus" / "watchlist"
    filter_json TEXT,                        -- 完整 filter 参数
    status TEXT NOT NULL,                    -- "running" / "completed" / "failed" / "partial"
    total_targets INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    model TEXT,
    prompt_version TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);

-- ============================================================
-- prices：日线行情
-- ============================================================
CREATE TABLE IF NOT EXISTS prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER NOT NULL,
    date TEXT NOT NULL,                      -- YYYY-MM-DD
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    volume REAL,
    amount REAL,
    pct_change REAL,
    pe REAL,
    pb REAL,
    market_cap REAL,
    FOREIGN KEY (stock_id) REFERENCES stocks(id),
    UNIQUE(stock_id, date)
);

CREATE INDEX IF NOT EXISTS idx_prices_stock_date ON prices(stock_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_prices_date ON prices(date DESC);

-- ============================================================
-- events：新闻 / 公告 / 事件
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_id INTEGER,
    event_date TEXT NOT NULL,
    event_type TEXT NOT NULL,                -- "news" / "announcement" / "report" / "market" / "earnings"
    title TEXT,
    summary TEXT,
    source TEXT,
    url TEXT,
    signal TEXT,                             -- positive / negative / neutral
    bg_tags TEXT,                            -- JSON array
    created_at TEXT NOT NULL,
    FOREIGN KEY (stock_id) REFERENCES stocks(id)
);

CREATE INDEX IF NOT EXISTS idx_events_stock_date ON events(stock_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);

-- ============================================================
-- frameworks：评估框架元数据（用于版本/prompt 管理）
-- ============================================================
CREATE TABLE IF NOT EXISTS frameworks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,               -- "serenity" / "bg" / "news"
    version TEXT NOT NULL,
    prompt_text TEXT,                        -- 完整 prompt 模板
    prompt_hash TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    is_active INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_frameworks_name_active ON frameworks(name, is_active);

-- ============================================================
-- 视图：每只股票每个 framework 的最新评分
-- ============================================================
CREATE VIEW IF NOT EXISTS v_latest_analysis AS
SELECT a.*
FROM analyses a
INNER JOIN (
    SELECT stock_id, framework, MAX(created_at) AS max_created
    FROM analyses
    GROUP BY stock_id, framework
) latest
ON a.stock_id = latest.stock_id
   AND a.framework = latest.framework
   AND a.created_at = latest.max_created;

-- ============================================================
-- 视图：股票 + 最新 Serenity 评分聚合（替代 aleabit_manifest）
-- ============================================================
CREATE VIEW IF NOT EXISTS v_stocks_with_serenity AS
SELECT
    s.id,
    s.code,
    s.market,
    s.name,
    s.industry_category,
    s.sector,
    s.market_cap,
    s.industries,
    a.score AS serenity_score,
    a.verdict AS serenity_verdict,
    a.verdict_label AS serenity_verdict_label,
    a.layer AS serenity_layer,
    a.layer_label AS serenity_layer_label,
    a.thesis AS serenity_thesis,
    a.signals_hit AS serenity_signals_hit,
    a.pre_labeled AS serenity_pre_labeled,
    a.created_at AS serenity_updated_at
FROM stocks s
LEFT JOIN v_latest_analysis a
    ON s.id = a.stock_id AND a.framework = 'serenity';
