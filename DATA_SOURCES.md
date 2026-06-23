# 数据源架构 · DATA SOURCES (canonical)

> 「我不是股神 / stockgod.xyz」全站数据源的**权威架构**。目标:**最稳 · 最能兜底 · 最不挑(免 key、IP 无关)· 数据最全 · 能深度分析**。
> 加新源、排查行情、做决策时以本文件为准。端点全是标准 **HTTPS / 443**,无自定义端口。

---

## 0. 设计原则(对应五个要求)

| 要求 | 怎么落地 |
|---|---|
| **最不挑** | 运行时主干只用**免 key + IP 无关**的源(**腾讯**=A/HK、**Yahoo**=美/全球、**Google News**=新闻)。这些从 Vercel(美国 IP)、GitHub Actions、本地都能直连,已实测。 |
| **最稳** | 主源选"不封 IP、不挑参数"的。腾讯 `qt.gtimg.cn` 实测最稳(A/HK 跨源一致、不封);Yahoo `chart` 全球通吃。 |
| **最能兜底** | **每类实时数据三级链**:主源 → 备源(必须 IP 无关)→ `last-good` 内存缓存。任一环挂都不返回空白、不崩。 |
| **数据最全** | 实时主干(行情)+ **深度层**(基本面/历史/资金面/聪明钱/研报/新闻),覆盖估值、题材、筹码、13F、龙虎榜、北向等。 |
| **能深度分析** | 深度层走**批处理**(Python/scripts),用 **akshare**(A股最全)+ Nasdaq(美股)+ dataroma/国会(聪明钱);key/IP 敏感的源**只在批处理用、绝不进运行时热路径**。 |

**一句话**:**运行时 = 腾讯(A/HK)+ Yahoo(美/全球)+ Google News,全免 key、全 IP 无关、全带兜底;深度分析 = akshare/Nasdaq/dataroma 批处理。**

---

## 1. 实时行情层(运行时 · Next.js API · 每次请求拉)

> 铁律:**主源富数据,备源保 IP 无关,缓存保不崩。** 三级都过不了才返回空。

| 市场 | ① 主源 | ② 兜底(IP 无关) | ③ 缓存 | 实现位置 |
|---|---|---|---|---|
| **A 股**(单只/详情) | 腾讯 `qt.gtimg.cn/q=sh\|sz\|bj{code}` | Yahoo `chart/{code}.SS\|.SZ` | 12s 合并 + last-good | `api/quote/route.ts`(`tencentQuote`→`yahooQuote`) |
| **港股**(单只) | 腾讯 `qt.gtimg.cn/q=r_hk{5位code}` | Yahoo `chart/{4位}.HK` | 同上 | `api/quote`(`qqFromYahoo` 4/5 位都兼容) |
| **美股**(单只,含盘前/盘后) | Nasdaq `api.nasdaq.com/api/quote/{sym}/info` | **Yahoo** `chart/{sym}`(Nasdaq 间歇拒 Vercel IP 时接管) | 12s + last-good | `api/quote`(`usQuote`→`yahooQuote`) |
| **台股 / 韩股** | Yahoo `chart/{code}.TW\|.KS` | —(Yahoo 即唯一稳源) | last-good | `api/quote` |
| **指数 / 宏观** | Yahoo `chart/{^GSPC…}` | — | 边缘缓存 | `api/macro/route.ts` |
| **板块(11 大行业)** | **行业 ETF**(XLK/XLF/XLI/XLY/XLV/XLP/XLE/XLB/XLC/XLU/XLRE)走上面美股链 | Yahoo | Upstash 定格 | `api/sector-sessions`(`sectorsViaETF`,2026-06-23 改;原 screener 聚合失真) |
| **美股全盘**(bulk·热力图/列表) | Nasdaq screener `api/screener/stocks?download=true` + **/info 覆盖市值 top-100 龙头** | last-good | 边缘 55s | `api/market/route.ts`(screener 长尾可滞后、龙头实时) |
| **A 股全盘**(bulk) | 腾讯批量 `qt.gtimg.cn`(80/批,5500 只分波) | last-good(≥半数才更新,防稀疏污染) | 边缘 55s | `api/a-market/route.ts` |

**为什么这么选**
- **腾讯 = A/HK 的事实标准**:免 key、不封 IP、从 Vercel 美国 IP 实测正常、与列表同源(详情↔列表锁步)。比 Yahoo 中国股(盘中常滞后 ~15min)准。
- **美股主源 Nasdaq /info**:富(真盘前/盘后 + session + 昨收),但**间歇性拒绝 Vercel 数据中心 IP**(源头正常、Vercel 调就空)→ 必挂 **Yahoo 兜底**(Yahoo 不封 IP)。
- **板块用行业 ETF**:ETF 就是板块基准、/info 实时;别用"全市场 screener 市值加权"(滞后 + 随机时刻定格 → 实测把工业算成 -3%、真实 XLI +0.5%)。
- **screener 只配长尾**:Nasdaq 全市场快照常停在上一交易日,只能给小盘兜底;龙头一律 /info 覆盖。

---

## 2. 深度数据层(批处理 · scripts/ + fetchers/ · 不进运行时热路径)

> IP/key 敏感、重、慢的源都在这里跑,产出**静态数据集**(提交进仓库,前端 fs 读)。runtime 永不直连这些。

### 2.1 基本面 / 历史 / 估值
| 数据 | 源 | 端点 / 库 | 出处 |
|---|---|---|---|
| 美股基本面/估值 | Nasdaq | `/api/quote/{sym}/{info,summary,historical,company-profile}` | `fetchers/{us_stocks,history}`、`build_etf_analysis` |
| 美股 ETF | Nasdaq | `/api/screener/etf` + summary/historical | `fetchers/us_etfs`、`build_etf_analysis` |
| A 股基本面 | 腾讯 | `qt.gtimg.cn`(PE/PB/市值/换手) | `lib/a-fundamentals.ts`(runtime)、`fetchers/snapshot` |
| A 股财报三表 / F10 | **akshare** + 新浪 | `ak.*` / `vip.stock.finance.sina.com.cn` | `fetchers/snapshot`、`build_a_industry` |
| 增发/稀释 flag | SEC | `sec.gov/files/company_tickers.json` · `data.sec.gov/submissions` · EDGAR | `fetchers/dilution_flags` |
| 期权 / gamma | Polygon(**需 key**) | `api.polygon.io/v3/snapshot/options` | `fetchers/polygon_options` |

### 2.2 资金面 / 聪明钱(深度分析核心)
| 数据 | 源 | 端点 / 库 | 出处 |
|---|---|---|---|
| 美股 13F 价投大佬 | dataroma | `dataroma.com` 爬取 | `fetchers/dataroma.py` → whales.json |
| 国会议员交易(PTR) | US House Clerk | `disclosures-clerk.house.gov/public_disc` | `build_congress.py` → congress.json |
| A 股基金重仓 | **akshare** | `ak.fund_portfolio_hold_em` | `seed_investors.py`(聪明钱「A股顶流」) |
| A 股私募(十大流通股东) | **akshare** | `ak.stock_gdfx_free_holding_analyse_em` | `build_private_funds.py`(「私募大佬」) |
| A 股龙虎榜游资 | **akshare** | `ak.stock_lhb_{hyyyb,detail}_em` | `build_lhb_hotmoney.py`(「游资席位」) |
| A 股概念/板块归属 | akshare / 东财 | `ak.*` / `push2.eastmoney.com/api/qt/stock/get` | `concepts.py`、`fetchers/east_money` |
| A 股行业分类 | 新浪 | `vip.stock.finance.sina.com.cn/.../newSinaHy.php` | `build_a_industry.py` |
| A 股公告 | 巨潮 cninfo | `static.cninfo.com.cn/finalpage/...PDF` | `fetchers/announcements` |
| **(路线图)北向资金 / 资金流向** | 同花顺 / 东财 | `data.hexin.cn/market/hsgt` · `push2.eastmoney.com/.../fflow` | 见 §5,未建 |

### 2.3 新闻 / 事件
| 数据 | 源 | 端点 | Key | 出处 |
|---|---|---|---|---|
| 实时新闻(大盘+个股) | **Google News RSS** | `news.google.com/rss/search?q=…` | 免 | `premarket/close_report`、`fetchers/news_google` |
| 财报/宏观/IPO 日历 | Finnhub | `finnhub.io/api/v1/{news,calendar/*}` | **FINNHUB_KEY** | `today-events.ts`、`market_calendar`、报告/卡片 |

### 2.4 LLM(AI 判读 / 报告 / 卡片标题)
| 用途 | 源 | 端点 | Key |
|---|---|---|---|
| 报告/卡片/arena/判读 | **NDT 中继** | `api.nadoutong.org/v1/messages`(Opus 4.8)· `/v1/responses`(gpt-5.5 兜底) | **NDT_CLAUDE_KEY + NDT_API_KEY** |

---

## 3. IP / Key 矩阵(决定"放运行时还是批处理")

| 源 | 免 key | IP 无关 | 从 Vercel 美国 IP | 定位 |
|---|:--:|:--:|---|---|
| 腾讯 `qt.gtimg.cn` | ✅ | ✅ | ✅ 实测稳 | **运行时主干(A/HK)** |
| Yahoo `query1.finance.yahoo.com` | ✅ | ✅ | ✅ | **运行时兜底 + 台/韩/指数** |
| Google News RSS | ✅ | ✅ | ✅ | **运行时/批处理 新闻** |
| Nasdaq `api.nasdaq.com` | ✅ | ⚠ **间歇拒 Vercel IP** | ⚠ 需 Yahoo 兜底 | 运行时(美股,带兜底)+ 批处理 |
| akshare(库) | ✅ | ⚠ 内部走东财/新浪 | ⚠ 慢/可能风控 | **只批处理** |
| 东财 `push2.eastmoney` | ✅ | ⚠ 对非大陆 IP 敏感、需限流 | ⚠ 实测从日本 IP 没干净返回 | **只批处理 + 限流** |
| 同花顺 `data.hexin.cn` | ✅ | ⚠ 同上 | ⚠ | **只批处理** |
| dataroma / 国会 / SEC / 新浪 / 巨潮 | ✅ | 大体 ✅ | ✅ | 批处理 |
| Finnhub | ❌ key | ✅ | ✅ | 运行时(日历)+ 批处理 |
| Polygon | ❌ key | ✅ | ✅ | 批处理(期权) |

**规则**:**IP 敏感 / 需限流 / 需 key 的源,绝不放进每次请求的运行时热路径**——要么进批处理(产出静态数据集),要么带 IP-无关兜底(如 Nasdaq→Yahoo)。

---

## 4. 兜底 / 韧性铁律

1. **三级 fallback**:主源 → IP-无关备源 → `last-good` 缓存。三级全过不了才返回空对象(`{quotes:{}}`),**永不崩、永不整页空白**。
2. **缓存优先削上游**:轮询型 API 设 `Vercel-CDN-Cache-Control: max-age=N, stale-while-revalidate=M`(边缘缓存,多用户共享、上游抖动时 serve 旧份);**禁用 `force-dynamic`**(它会让边缘完全不缓存,每请求都打函数)。
3. **失败不缓存空**:上游集体失败返回空时,响应头设 `no-store`,别把"空"缓存给所有人。
4. **last-good 完整性闸**:bulk 快照(A股 5500 只)只在 ≥半数成功时才更新 last-good,防部分失败污染成稀疏集。
5. **批处理 push 必带重试**:任何 bot/CI 的 git push 都 `for i in 1 2 3; do push && break || { pull --rebase; }; done`。
6. **静态数据集兜底**:CI 没配 key(如 FINNHUB)或抓取失败 → 读仓库里随刷新提交的 JSON(market-news/earnings-calendar 等),报告/页面不空字段。

---

## 5. 当前实现状态 + 缺口 / 路线图

**✅ 已实现(2026-06 本轮加固)**
- A/HK 详情 → 腾讯(与列表同源,消除"列表点进详情不同步");Yahoo 兜底。
- 美股 → Nasdaq /info + **Yahoo 兜底**(解决 Nasdaq 间歇拒 Vercel IP → 价格卡旧种子)。
- 港股 5 位代码符号修复(Yahoo `00700.HK`→`0700.HK`;腾讯路径 4/5 位都兼容)。
- 板块 → 行业 ETF(替换失真的 screener 聚合)。
- 4 个轮询 API 边缘缓存(market/quote/sector-sessions/a-market)。
- 盘报联网核实新闻(Google News RSS)。

**⚠ 已知缺口**
- **美股盘后收盘后丢失**:20:00 ET 后完全休市时,Nasdaq/Yahoo 头条都退回常规收盘,盘后最后价(还埋在 Yahoo 分时 bar)未抠出 → 详情页看不到盘后涨跌。
- **A 股北向 / 龙虎榜(资金维度)未进聪明钱**:schema 留了 `northbound`,数据未建。
- **静态快照部分冻结**:本地 refresh 2026-06-17 停后,us-fundamentals/heat 等慢变量冻结(实时价照刷,所以短期 OK);要刷需重启本地任务或云端重建 build_json。

**🗺 路线图(用现有架构补全)**
1. 盘后价:美股完全休市时,详情页(单只、非 bulk)去 Yahoo `chart?includePrePost=true` 抠最后一根盘后 bar,显示「盘后 $X ±%」。
2. 北向/龙虎榜:批处理用 **akshare**(`stock_hsgt_*` / `stock_lhb_*`,IP 无关、库封装好)产出 → 聪明钱新镜头。**别用东财/同花顺裸 HTTP 进运行时**(IP 敏感)。
3. 深度 A 股(财务/F10/逐笔):需要时在批处理装 `mootdx`(通达信 TCP,不封 IP),**不进 serverless**。

---

## 6. 静态数据集索引(§2 批处理产出 · 前端 fs 读)

- **美股**:`us-stocks` `us-fundamentals` `us-analyses` `us-heat` `us-history` `us-panel-summary` `us-class` `us-etfs` `us-blurbs` `us-news`
- **A 股**:`a-analyses` `a-panel-summary` `a-industry` `a-blurbs` `a-price-history-30d` `aleabit_manifest`
- **港 / 韩股**:`hk-analyses` `kr-analyses`
- **聪明钱**:`whales.json`(13F+基金+私募+游资+政客)`congress.json`
- **盘报 / 事件**:`reports` `market-calendar` `ahead` `earnings-calendar` `events` `market-news` `macro` `trends` `yclose`
- **热力 / 产业链**:`pulse-scores` `pulse-snapshot` `pulse-supplement` `industry-map` `coverage` `stock-type-map` `dilution-flags` `arena`

---

_维护:加新源先填 §3 矩阵判定(运行时还是批处理),再按 §1/§2 接;改任一行情源后立刻沿「美股↔A股↔港股」反查同类 bug(parity 铁律)。_
