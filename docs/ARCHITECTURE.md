# 我不是股神 · Not a Stock Guru — 架构拆解

> AI 驱动的全景股票可视化平台 · A 股 + 美股 + 加密
> 演示文档(领导看「价值层」,开发看「系统层」)

---

## 一句话

> **把"看不懂股票"这件事,变成"五位投资大师当面给你吵架"。**
> 6000+ 美股 + 5500+ A 股,每只票都有 5 个独立大师视角 + 产业链位置 + 实时热度,**分歧本身就是信号**。

---

# Part 1 · 给领导:这东西值钱在哪

## 1. 四个核心视图

| 视图 | 是什么 | 差异化 |
|---|---|---|
| **产业链热力图**(首页) | 8 条产业链 × 1400 节点的脉冲粒子场,按"大师镜头"上色 | 别人是表格,我们是**会动的产业链全景** |
| **全市场扫描**(列表) | 6104 美股 + 5510 A 股,可排序/筛选,每只票一个**五方迷你雷达** | 一眼扫出"共识票 / 争议票" |
| **个股详情** | 5 大师独立判读 + 五维雷达 + 产业链上下游 | **不是一个 AI 给结论,是 5 个立场互相打架** |
| **印股票预警** | SEC 实时扫描"货架额度 ≫ 市值"的无限增发票 | 散户踩雷高发区,我们标红 |

## 2. 护城河:别人为什么抄不走

1. **五方独立判读框架** —— 不是"AI 综合打分",是 5 个**绝不折中、可以互相矛盾**的大师立场(巴菲特/段永平/Serenity/德鲁肯米勒/情绪资金面)。**分歧 = 产品**。
2. **数据驱动的可扩展性** —— 加一个股神 / 加一条产业链,都是**改配置 + 跑一次**,不改代码。护城河随时间越挖越深。
3. **一个库,一站式更新** —— 全部数据进一个 SQLite,一条命令(8.5 秒)刷新全站。数据新鲜度、完整性一处管。

## 3. 规模 & 成本(真实数字)

- **覆盖**:美股 6104 只行情 / 1429 只已五方深度分析(持续补)· A 股 5510 只 Serenity 评分
- **刷新一次**:抓全市场行情 + 派生 13 份数据 = **8.5 秒**
- **AI 分析成本**:每 50 只 = 140 万 token / 7 分钟(可按预算"想跑就跑一批")
- **部署**:Vercel,前端零服务器成本(读静态文件)

---

# Part 2 · 给开发:系统怎么搭的

## 数据流(一张图)

```
┌─────────────── 数据源 ───────────────┐
│ Nasdaq screener(美股行情,免费无key)  │
│ SEC EDGAR(印股票/稀释)               │
│ 东财/Tushare(A股)                    │   抓取
│ Claude Workflow(5方AI分析,50并发)    │ ──────┐
└──────────────────────────────────────┘       │
                                                 ▼
                        ┌──────────────────────────────────┐
                        │   leslie.db  (SQLite = 单一真相源) │
                        │  ┌────────────┬──────────────────┐│
                        │  │ 美股侧      │ A股侧             ││
                        │  │ us_market   │ stocks           ││
                        │  │ us_analyses │ analyses         ││
                        │  │ dilution    │ (prices/events…) ││
                        │  └────────────┴──────────────────┘│
                        └──────────────┬───────────────────┘
                                       │  build_json.py(派生)
                                       ▼
                ┌──────────────────────────────────────────┐
                │  13 份前端 JSON(View 层,静态)            │
                │  us-stocks · us-heat · us-analyses ·       │
                │  us-panel-summary · pulse-scores ·         │
                │  industry-map · pulse-supplement ·         │
                │  aleabit_manifest · dilution-flags …       │
                └──────────────┬───────────────────────────┘
                               │  (Vercel 部署,前端运行时只读静态文件)
                               ▼
                ┌──────────────────────────────────────────┐
                │  Next.js 前端 (Vercel)                     │
                │  热力图 · 扫描 · 详情 · 印股票             │
                └──────────────────────────────────────────┘
```

## 核心理念:SoT = SQLite,View = JSON

- **为什么不直接连库?** 前端在 Vercel 上是 serverless,运行时只能读静态文件,不能实时查 SQLite。
- **所以**:库是"真相源"(写),JSON 是"视图"(读)。`build_json.py` 把库派生成前端要的 13 份 JSON。
- **好处**:单一数据源 + Vercel 零成本 + 数据完整性一处管,不会出现"某视图吃旧数据"。

## 数据一致性:每块看板的唯一数据源(铁律)

> 一只票的每个数,**全产品只有一个出处**。看板只负责"读 + 渲染",绝不自己再算一套。

这条是踩坑踩出来的。热力图详情面板曾偷偷留着一套**独立现算的旧逻辑**,于是:

- 过热度被实时轮询用"当天涨跌"公式 `50+pct×3.3` 覆盖 → INTC 跌 11% 显示 **13「深度价值」**,可它 60 日涨了 119%、估值顶满,**明明是过热票**。
- "综合"分走 `tripleScore`(从基本面现算的 3 方启发式)→ 显示 **39**,而镜头/详情页用的 AI 五方均值是 **50**;同一只票热力图按巴菲特 38 上色,点开却是另一套分。

**教训:界面上两个数对不上 = 某处长出了第二套现算逻辑。** 现在全部归一:

| 显示的数 | 唯一来源 | 用它的看板 |
|---|---|---|
| 价格 / 涨跌 / 市值 | `us-stocks.json`(Nasdaq)+ `/api/market` 实时 | 热力图 · 列表 · 详情页 · Wire |
| 五方分 + 分歧 | `pulse-scores` / `us-panel-summary`(同派生自库 `us_analyses`,顺序一致) | 热力图镜头 · 列表迷你雷达 · 详情面板 · 个股页 |
| 基本面 PE/PS/EV/ROE/股息 | `us-fundamentals.json`(Yahoo) | 详情页类型卡 · 热力图详情 |
| 过热/泡沫度 + 分项(估值/离高点/RSI/动量) | `us-heat.json`(由 fundamentals + 自攒历史算,分项 recompose = 总分) | 热力图「过热度」镜头 + 详情分项 |
| RSI / 动量 / 趋势 | 自攒 `price_history`(每次 refresh 追加全市场收盘 → 自己算) | 过热度 · 趋势 |
| 大佬持仓占比 / 谁在持有 | `whales.json` 的 `by_ticker`(从 `investors[].holdings` 一次派生) | `/whales` · 个股页"谁在持有" |
| 宏观 / 指数 | `macro.json` + `/api/macro` 实时 | 顶部宏观条(首页 / Wire) |
| 股票 vs ETF 区分 + ETF 近1年回报 | `us-etfs.json`(Nasdaq ETF screener,库表 `us_etfs`) | 列表 ETF 视图 · 搜索 · ETF 详情页 |
| 市场日历(宏观+重磅财报,未来10天) | `market-calendar.json`(Finnhub,**fetch-cache**:滚动窗口,不进库,可随时重抓) | 盘报 tab 顶部 |
| 盘报(盘前/盘中/收盘) | `reports.json`(`publish_report.py` 手动发布,refresh/build 不碰它) | 盘报 tab |
| 财报日历 / 市场快讯 | `earnings-calendar` / `market-news`(Finnhub) | 详情页"下次财报" · Wire |
| 个股新闻 | `us-news/{sym}.json`(Google News) | 详情页"近期新闻" |
| 印股票 / 稀释 | `dilution-flags.json`(SEC EDGAR) | 列表 · 详情页 |

**加功能守则**:要显示某个数之前先问——"这个数已经有唯一源了吗?" 有 → 读它;没有 → 在派生层(`build_*.py`)算一次写进 JSON,**绝不在前端组件里现算**。前端现算 = 迟早和源对不上。

## 实时层 + 自攒历史(本轮新增)

- **实时**:前端轮询 3 个 keyless API 路由(服务端 fetch + revalidate 缓存,不砸源)——`/api/macro`(Yahoo 指数 ~30s)· `/api/quote`(Yahoo 个股 ~20s)· `/api/market`(Nasdaq 全盘 ~60s)。轻量实时用 Yahoo(量小不限流),批量历史用 Nasdaq(和 screener 同源,宽容)。顶部「美股 开盘中/休市」盘口状态按美东时间算。
- **自攒历史**:`price_history` 表每次 refresh 追加全市场收盘(Nasdaq 一次回种 3 个月起步)→ RSI/动量/趋势全自己算,**不依赖任何外部历史接口**,谁也限不了流。攒满后全 6000+ 只都有原生历史。

## 五层拆解

| 层 | 干什么 | 关键文件 |
|---|---|---|
| **① 数据源** | 抓行情/财务/分析 | `fetchers/`(us_stocks, dilution_flags, east_money…,共 8 个) |
| **② 真相源** | 一个 SQLite 存全部 | `data/leslie.db`(~20 张表:行情/五方/基本面/历史/新闻/13F…)· schema 在 `db/schema.sql` |
| **③ AI 分析** | 5 方独立判读,单股文件派发 | Claude Workflow + `scripts/ingest_*.py` |
| **④ 派生层** | 库 → 13 份前端 JSON | `scripts/build_json.py` + 各 `build_*.py` |
| **⑤ 前端** | 读 JSON 渲染 | `web/`(Next.js 16) |

## 一站式更新(运维就一条命令)

```bash
python scripts/refresh.py            # 抓最新行情 → 入库 → 派生全部 JSON(8.5 秒)
python scripts/refresh.py --deploy   # 上面 + 提交 + Vercel 部署
```

**定时任务(launchd,已挂载)**:
- `com.leslie.stock.refresh` —— 每天 05:00(北京 = 美东收盘后)跑 `refresh.py --deploy`,行情/ETF/日历/13F 全自动新鲜 + 上线
- `com.leslie.stock.premarket` —— 每天 20:30(= 美东开盘前 1h)生成盘前报告 + 邮件(周末跳过)

## 三个"加功能=改配置"的设计(可扩展性)

1. **股神注册表** `data/masters.json` —— 加一个大师 = 加一条配置 + 写一份 SKILL + 跑一次补跑。前端自动多渲一张雷达/一个镜头。
2. **数据驱动产业链** `industry-map.json` —— 加一条大类(如"自动驾驶")= 在 `build_industry_map.py` 的 CHAINS 配置加链名 + 各层 + 关键词,重跑即可。
3. **单股神补跑** `us_one_master.workflow.js` —— 给全市场补一个大师,**不重跑其他 4 方**(append 进 panel)。

## 技术栈

- **前端**:Next.js 16 + Turbopack + Tailwind v4 + Canvas 粒子场 · 部署 Vercel
- **数据/后端**:Python(fetchers + 派生脚本)+ SQLite(SoT)
- **AI**:Claude Workflow(后台多 agent 编排,5 方判读)+ 5 份 Skill 定义大师立场
- **数据源**:全部免费 —— Nasdaq(行情+历史)· Yahoo(宏观/基本面/实时报价)· SEC EDGAR(印股票)· 东财/Tushare(A股)· Google News(个股新闻)· Dataroma(超投 13F)· Finnhub(财报日历,需免费 key)· **自攒 `price_history`**(全市场日线,RSI/动量自给自足)。轻量实时 Yahoo、批量历史 Nasdaq。**唯一需 key 的是 Finnhub(免费档)**;Polygon 免费档不含期权,留作升级位

---

## 现状快照(截至本文)

| | |
|---|---|
| 美股行情 | 6104 只(全市场,每日刷新)+ `/api/market` 实时轮询 |
| 美股五方深度 | 1429 只(持续补,目标全覆盖) |
| A 股 Serenity | 5510 只 |
| 基本面 PE/PS/EV… | 1687 只(Yahoo) |
| 自攒历史 | `price_history` 132k 行 / 90 个交易日(每次 refresh +1 天,RSI/动量自算) |
| 大佬持仓 | 81 位超级投资者 13F(Dataroma)→ 1026 只票有持仓 |
| 产业链 | 8 条(AI / 稀有金属 / 人形机器人 / 国防军工 / 生物医药 / 新能源车 / 光伏储能 / 消费电子) |
| 热力图节点 | ~1400 |
| 印股票预警 | 501 只 |
| 实时层 | 3 个 keyless API 路由(macro/quote/market)+ 盘口状态 |
| 派生数据 | ~20 份 JSON,全部从一个库派生 · 每块看板单一数据源(见上「数据一致性」) |
