// AI 产业链 · 粒子脉冲数据模型
// heat 0-100 综合分 = 估值分位 × 0.40 + 动量 × 0.30 + RSI × 0.20 + 情绪 × 0.10
// 当前为 mock seed，结构为后续接入真实数据（yfinance / akshare）预留

export type Region = "US" | "CN" | "HK" | "TW" | "KR" | "EU" | "JP" | "PRV";

export type LayerId = "L0" | "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7";

export interface Company {
  id: string;
  ticker: string;
  name: string;
  layer: LayerId;
  segment: string;
  region: Region;
  marketCapB: number; // 市值 ($B)
  moat: 1 | 2 | 3 | 4 | 5; // 护城河强度

  // 热度子指标（mock，0-100）
  valuationPct: number; // 估值历史分位（越高越贵）
  momentum20d: number;  // 20 日涨幅排序分位
  rsi: number;          // 0-100
  sentiment: number;    // 卖方+社媒情绪分位
}

export interface Layer {
  id: LayerId;
  name: string;
  nameEn: string;
  summary: string;
  importance: 1 | 2 | 3 | 4 | 5;
  bottleneck: 1 | 2 | 3 | 4 | 5;
}

export const LAYERS: Layer[] = [
  { id: "L0", name: "能源底座",       nameEn: "Power · Cooling",       importance: 5, bottleneck: 5, summary: "燃气轮机交付排到 2028，核电 SMR 重启" },
  { id: "L1", name: "EDA · 设备 · 材料", nameEn: "Semi Foundations",     importance: 5, bottleneck: 4, summary: "寡头垄断，AI 把周期股升级为成长股" },
  { id: "L2", name: "晶圆 · 封装 · HBM", nameEn: "Foundry · Packaging",  importance: 5, bottleneck: 5, summary: "CoWoS / HBM 仍是 NVDA 出货上限" },
  { id: "L3", name: "AI 芯片",        nameEn: "AI Silicon",            importance: 5, bottleneck: 3, summary: "NVDA 主导，ASIC 第二极崛起" },
  { id: "L4", name: "数据中心基建",   nameEn: "DC Infra",              importance: 4, bottleneck: 4, summary: "1.6T 光模块 + 800V HVDC + 液冷" },
  { id: "L5", name: "云 · 模型 · 数据", nameEn: "Cloud · Foundation",  importance: 5, bottleneck: 3, summary: "Hyperscaler Capex 3 年 >$2T" },
  { id: "L6", name: "AI 应用",        nameEn: "Apps · Agents",         importance: 3, bottleneck: 2, summary: "最分散；垂直 + 数据闭环为王" },
  { id: "L7", name: "端侧 · 入口",    nameEn: "Edge AI",               importance: 4, bottleneck: 2, summary: "手机 + 眼镜 + 机器人三路抢入口" },
];

// 热度分计算（与 PulseField 共用）
export function computeHeat(c: Pick<Company, "valuationPct" | "momentum20d" | "rsi" | "sentiment">): number {
  return Math.round(
    c.valuationPct * 0.40 +
    c.momentum20d * 0.30 +
    c.rsi * 0.20 +
    c.sentiment * 0.10
  );
}

export function heatBand(heat: number): { label: string; tone: "cold" | "cool" | "fair" | "warm" | "hot" } {
  if (heat >= 85) return { label: "过热警告", tone: "hot" };
  if (heat >= 70) return { label: "偏热",     tone: "warm" };
  if (heat >= 50) return { label: "合理",     tone: "fair" };
  if (heat >= 30) return { label: "偏冷",     tone: "cool" };
  return { label: "深度价值区", tone: "cold" };
}

// ---------------- 种子数据 ----------------
// 内联辅助：快速构造一个 Company
const c = (
  ticker: string, name: string, layer: LayerId, segment: string,
  region: Region, mcap: number, moat: 1|2|3|4|5,
  val: number, mom: number, rsi: number, sent: number
): Company => ({
  id: `${layer}-${ticker}-${name}`.replace(/\s+/g, ""),
  ticker, name, layer, segment, region,
  marketCapB: mcap, moat,
  valuationPct: val, momentum20d: mom, rsi, sentiment: sent,
});

export const COMPANIES: Company[] = [
  // ===================== L0 能源底座 =====================
  c("GEV",    "GE Vernova",       "L0", "燃气轮机",  "US", 165, 5, 92, 88, 78, 90),
  c("ENR",    "Siemens Energy",   "L0", "燃气轮机",  "EU",  95, 5, 86, 80, 72, 75),
  c("MHI",    "三菱重工",         "L0", "燃气轮机",  "JP",  78, 4, 82, 76, 68, 60),
  c("VST",    "Vistra",           "L0", "核电 / SMR", "US", 70, 5, 90, 95, 82, 88),
  c("CEG",    "Constellation",    "L0", "核电 / SMR", "US", 85, 5, 88, 85, 76, 82),
  c("TLN",    "Talen Energy",     "L0", "核电 / SMR", "US", 14, 4, 78, 90, 80, 65),
  c("OKLO",   "Oklo",             "L0", "核电 / SMR", "US",  9, 3, 95, 96, 88, 92),
  c("601985", "中国核电",         "L0", "核电 / SMR", "CN", 35, 4, 55, 45, 52, 40),
  c("003816", "中国广核",         "L0", "核电 / SMR", "CN", 28, 4, 52, 42, 48, 38),
  c("VRT",    "Vertiv",           "L0", "UPS · HVDC", "US", 50, 5, 88, 82, 74, 80),
  c("ETN",    "Eaton",            "L0", "UPS · HVDC", "US", 130, 5, 80, 70, 65, 68),
  c("002335", "科华数据",         "L0", "UPS · HVDC", "CN",  4, 3, 72, 78, 70, 55),
  c("002518", "科士达",           "L0", "UPS · HVDC", "CN",  3, 3, 68, 65, 62, 48),

  // ===================== L1 EDA · 设备 · 材料 =====================
  c("SNPS",   "Synopsys",         "L1", "EDA / IP",  "US", 85,  5, 75, 60, 58, 70),
  c("CDNS",   "Cadence",          "L1", "EDA / IP",  "US", 80,  5, 76, 62, 60, 70),
  c("ARM",    "ARM Holdings",     "L1", "EDA / IP",  "US", 145, 5, 92, 75, 68, 85),
  c("301269", "华大九天",         "L1", "EDA / IP",  "CN", 6,   3, 70, 50, 55, 60),
  c("688521", "芯原股份",         "L1", "EDA / IP",  "CN", 4,   3, 68, 55, 58, 55),
  c("ASML",   "阿斯麦",           "L1", "光刻机",    "EU", 320, 5, 70, 55, 52, 72),
  c("AMAT",   "Applied Materials","L1", "刻蚀 / 沉积","US", 165, 5, 65, 58, 56, 65),
  c("LRCX",   "Lam Research",     "L1", "刻蚀 / 沉积","US", 105, 5, 72, 65, 60, 68),
  c("KLAC",   "KLA",              "L1", "量测",      "US", 105, 5, 78, 70, 65, 72),
  c("8035",   "Tokyo Electron",   "L1", "刻蚀 / 沉积","JP", 130, 5, 68, 60, 58, 60),
  c("002371", "北方华创",         "L1", "刻蚀 / 沉积","CN", 35,  4, 80, 75, 70, 75),
  c("688012", "中微公司",         "L1", "刻蚀",      "CN", 22,  4, 82, 78, 72, 78),
  c("688072", "拓荆科技",         "L1", "沉积",      "CN",  8,  3, 78, 80, 76, 70),
  c("688120", "华海清科",         "L1", "CMP",       "CN",  6,  3, 75, 72, 68, 65),
  c("4063",   "信越化学",         "L1", "硅片 · 材料","JP",  80,  5, 60, 45, 48, 55),
  c("688126", "沪硅产业",         "L1", "硅片",       "CN",  5,  3, 65, 52, 55, 50),
  c("688019", "安集科技",         "L1", "CMP 抛光液", "CN",  3,  4, 72, 65, 60, 58),
  c("300346", "南大光电",         "L1", "光刻胶",     "CN",  3,  3, 70, 68, 62, 55),
  c("688268", "华特气体",         "L1", "电子特气",   "CN",  2,  3, 65, 55, 52, 48),
  // Serenity chokepoint · A 股关键金属 / 上游材料（瓶颈狙击思路）
  c("002428", "云南锗业",         "L1", "关键金属 · 锗",     "CN",  8, 5, 75, 70, 65, 78),
  c("000831", "中国稀土",         "L1", "关键金属 · 稀土",   "CN", 75, 5, 75, 65, 60, 75),
  c("600301", "华锡有色",         "L1", "关键金属 · 锡",     "CN", 48, 4, 70, 75, 70, 70),
  c("002409", "雅克科技",         "L1", "半导体材料 · 全平台", "CN", 84, 4, 72, 68, 65, 72),
  c("300666", "江丰电子",         "L1", "半导体材料 · 靶材", "CN", 75, 4, 70, 65, 60, 68),
  c("000962", "东方钽业",         "L1", "关键金属 · 钽",     "CN", 47, 4, 70, 68, 65, 65),
  c("000960", "锡业股份",         "L1", "关键金属 · 锡",     "CN", 47, 4, 70, 65, 62, 68),

  // ===================== L2 晶圆 · 封装 · HBM =====================
  c("TSM",    "台积电",           "L2", "晶圆代工",  "TW", 750, 5, 82, 70, 62, 88),
  c("005930", "Samsung",          "L2", "晶圆代工",  "KR", 380, 4, 55, 40, 45, 50),
  c("INTC",   "Intel",            "L2", "晶圆代工",  "US",  95, 3, 35, 55, 60, 30),
  c("981",    "中芯国际",         "L2", "晶圆代工",  "HK", 95,  4, 78, 82, 75, 80),
  c("1347",   "华虹半导体",       "L2", "晶圆代工",  "HK", 12,  3, 60, 55, 58, 45),
  c("3711",   "日月光投控 ASE",   "L2", "先进封装",  "TW", 25,  4, 75, 68, 62, 65),
  c("AMKR",   "Amkor",            "L2", "先进封装",  "US",  7,  3, 65, 60, 58, 50),
  c("600584", "长电科技",         "L2", "先进封装",  "CN", 10,  4, 80, 78, 72, 75),
  c("002156", "通富微电",         "L2", "先进封装",  "CN",  6,  4, 82, 80, 75, 78),
  c("002185", "华天科技",         "L2", "先进封装",  "CN",  4,  3, 72, 68, 65, 60),
  c("000660", "SK Hynix",         "L2", "HBM",       "KR", 145, 5, 95, 92, 82, 95),
  c("MU",     "Micron",           "L2", "HBM",       "US", 130, 4, 88, 85, 78, 88),

  // ===================== L3 AI 芯片 =====================
  c("NVDA",   "NVIDIA",           "L3", "GPU",       "US", 3800, 5, 90, 78, 70, 95),
  c("AMD",    "AMD",              "L3", "GPU",       "US", 280,  4, 78, 72, 65, 75),
  c("AVGO",   "Broadcom",         "L3", "ASIC",      "US", 1100, 5, 92, 85, 75, 92),
  c("MRVL",   "Marvell",          "L3", "ASIC",      "US", 85,   4, 85, 80, 72, 80),
  c("3661",   "Alchip 世芯",      "L3", "ASIC 代工", "TW", 18,   4, 88, 82, 75, 78),
  c("688256", "寒武纪",           "L3", "中国 AI 芯片","CN", 35,  4, 95, 92, 85, 90),
  c("688041", "海光信息",         "L3", "中国 AI 芯片","CN", 50,  4, 92, 88, 80, 88),
  c("QCOM",   "高通",             "L3", "边缘 / 端侧","US", 180,  4, 65, 55, 58, 60),
  c("2454",   "联发科",           "L3", "边缘 / 端侧","TW", 80,   4, 72, 65, 60, 65),

  // ===================== L4 数据中心基建 =====================
  c("SMCI",   "Supermicro",       "L4", "服务器",    "US", 32,  3, 75, 78, 70, 65),
  c("DELL",   "Dell",             "L4", "服务器",    "US", 90,  4, 78, 72, 65, 70),
  c("601138", "工业富联",         "L4", "服务器",    "CN", 80,  4, 88, 90, 82, 85),
  c("2317",   "鸿海精密",         "L4", "服务器",    "TW", 95,  4, 80, 75, 68, 72),
  c("2382",   "广达电脑",         "L4", "服务器",    "TW", 50,  4, 85, 80, 72, 75),
  c("000977", "浪潮信息",         "L4", "服务器",    "CN", 22,  4, 78, 80, 75, 70),
  c("603019", "中科曙光",         "L4", "服务器",    "CN", 10,  3, 72, 70, 68, 60),
  c("300308", "中际旭创",         "L4", "光模块",    "CN", 28,  5, 92, 90, 82, 95),
  c("300502", "新易盛",           "L4", "光模块",    "CN", 22,  5, 95, 95, 88, 95),
  c("300394", "天孚通信",         "L4", "光模块",    "CN", 10,  4, 88, 85, 78, 85),
  c("688498", "源杰科技",         "L4", "光模块",    "CN",  5,  4, 90, 88, 80, 80),
  c("002222", "福晶科技",         "L4", "激光晶体 · 上游", "CN", 73, 4, 76, 70, 65, 72),
  c("ANET",   "Arista Networks",  "L4", "网络",      "US", 130, 5, 85, 75, 68, 80),
  c("COHR",   "Coherent",         "L4", "光模块",    "US", 18,  4, 78, 75, 70, 70),
  c("CSCO",   "Cisco",            "L4", "网络",      "US", 220, 3, 50, 40, 45, 45),
  c("002837", "英维克",           "L4", "液冷",      "CN", 12,  4, 90, 88, 82, 85),
  c("301018", "申菱环境",         "L4", "液冷",      "CN",  4,  3, 82, 80, 75, 70),
  c("300499", "高澜股份",         "L4", "液冷",      "CN",  3,  3, 78, 82, 76, 65),
  c("872808", "曙光数创",         "L4", "液冷",      "CN",  3,  3, 75, 70, 65, 58),
  c("EQIX",   "Equinix",          "L4", "IDC",       "US", 80,  5, 68, 50, 52, 65),
  c("DLR",    "Digital Realty",   "L4", "IDC",       "US", 55,  4, 70, 55, 55, 60),
  c("9698",   "GDS 万国数据",     "L4", "IDC",       "HK", 12,  4, 75, 88, 80, 70),
  c("600845", "宝信软件",         "L4", "IDC",       "CN", 12,  4, 78, 75, 70, 68),
  c("300442", "润泽科技",         "L4", "IDC",       "CN",  8,  3, 72, 70, 65, 60),
  c("CRWV",   "CoreWeave",        "L4", "Neocloud",  "US", 45,  3, 88, 92, 85, 85),
  c("NBIS",   "Nebius",           "L4", "Neocloud",  "US", 12,  3, 85, 90, 82, 78),
  c("APLD",   "Applied Digital",  "L4", "Neocloud",  "US",  3,  2, 80, 92, 85, 70),

  // ===================== L5 云 · 模型 · 数据 =====================
  c("MSFT",   "Microsoft",        "L5", "Hyperscale","US", 3500, 5, 72, 60, 58, 80),
  c("GOOGL",  "Alphabet",         "L5", "Hyperscale","US", 2400, 5, 68, 65, 60, 75),
  c("AMZN",   "Amazon",           "L5", "Hyperscale","US", 2300, 5, 70, 62, 58, 72),
  c("META",   "Meta",             "L5", "Hyperscale","US", 1800, 5, 75, 70, 62, 78),
  c("ORCL",   "Oracle",           "L5", "Hyperscale","US", 600,  4, 85, 88, 78, 82),
  c("9988",   "阿里巴巴",         "L5", "Hyperscale","HK", 280,  5, 50, 75, 68, 65),
  c("700",    "腾讯控股",         "L5", "Hyperscale","HK", 520,  5, 55, 60, 60, 65),
  c("9888",   "百度",             "L5", "Hyperscale","HK",  40,  3, 35, 30, 42, 35),
  c("PLTR",   "Palantir",         "L5", "MLOps",     "US", 380,  5, 98, 95, 88, 98),
  c("SNOW",   "Snowflake",        "L5", "MLOps",     "US",  60,  4, 75, 60, 55, 65),
  c("DDOG",   "Datadog",          "L5", "MLOps",     "US",  45,  4, 78, 65, 58, 68),
  c("MDB",    "MongoDB",          "L5", "MLOps",     "US",  20,  3, 60, 50, 52, 50),

  // ===================== L6 AI 应用 =====================
  c("CRM",    "Salesforce",       "L6", "横向 SaaS","US", 290, 4, 60, 50, 52, 60),
  c("ADBE",   "Adobe",            "L6", "横向 SaaS","US", 200, 5, 55, 40, 48, 55),
  c("NOW",    "ServiceNow",       "L6", "横向 SaaS","US", 200, 5, 75, 65, 60, 70),
  c("TEM",    "Tempus AI",        "L6", "医疗",     "US",  14, 3, 85, 88, 80, 75),
  c("RXRX",   "Recursion",        "L6", "医疗",     "US",   2, 2, 65, 70, 68, 55),
  c("VEEV",   "Veeva",            "L6", "生科 SaaS","US", 40, 5, 60, 50, 52, 55),
  c("DUOL",   "Duolingo",         "L6", "教育",     "US", 15,  4, 80, 75, 68, 75),
  c("TSLA",   "Tesla",            "L6", "自动驾驶 / 机器人", "US", 1300, 4, 88, 82, 72, 92),
  c("PONY",   "小马智行",         "L6", "自动驾驶", "US",   5,  3, 85, 88, 80, 75),
  c("WRD",    "文远知行",         "L6", "自动驾驶", "US",   2,  3, 78, 82, 75, 65),
  c("002050", "三花智控",         "L6", "机器人零部件","CN", 16, 4, 78, 75, 70, 75),
  c("688017", "绿的谐波",         "L6", "机器人零部件","CN",  5, 4, 80, 78, 72, 72),
  c("601689", "拓普集团",         "L6", "机器人零部件","CN", 12, 4, 75, 72, 68, 70),

  // ===================== L7 端侧 · 入口 =====================
  c("AAPL",   "Apple",            "L7", "AI 手机",  "US", 3400, 5, 70, 50, 55, 75),
  c("005930-S","Samsung 端侧",    "L7", "AI 手机",  "KR", 380,  4, 55, 45, 50, 55),
  c("1810",   "小米集团",         "L7", "AI 手机",  "HK",  70,  4, 80, 85, 78, 80),
  c("META-S", "Meta Ray-Ban",     "L7", "AI 眼镜",  "US", 1800, 5, 75, 70, 62, 85),
  c("002475", "立讯精密",         "L7", "代工 / 零部件","CN", 35, 4, 70, 65, 60, 65),
  c("002241", "歌尔股份",         "L7", "代工 / 零部件","CN", 12, 4, 75, 78, 72, 70),
  c("2018",   "瑞声科技",         "L7", "代工 / 零部件","HK",  6, 4, 72, 70, 68, 60),
];

// ---- Fundamentals 切片（yfinance Ticker.info 来源） ----
export interface Fundamentals {
  trailingPE?: number;
  forwardPE?: number;
  priceToBook?: number;
  priceToSales?: number;
  roe?: number;             // 0.xx
  roa?: number;
  profitMargin?: number;
  operatingMargin?: number;
  grossMargin?: number;
  fcf?: number;
  fcfMargin?: number;       // FCF / Revenue
  totalRevenue?: number;
  marketCap?: number;
  debtToEquity?: number;
  currentRatio?: number;
  revenueGrowth?: number;   // YoY 0.xx
  earningsGrowth?: number;
  beta?: number;
  trailingEps?: number;
  forwardEps?: number;
  dividendYield?: number;
}

// 自动计算所有公司的 heat（默认 mock）
export interface CompanyWithHeat extends Company {
  heat: number;
  dataSource: "live" | "mock" | "serenity";
  livePrice?: number;
  pct?: number | null;        // 当日涨跌%（与 list 同源:us-stocks / /api/market）
  pos52?: number | null;      // 过热度分项:离 52 周高点位置（0-100）
  liveBar?: string;
  fundamentals?: Fundamentals;
  valuationMethod?: "pe_history" | "price_history";
  // industry 标签（来自 pulse-supplement）
  industries?: IndustryId[];
  // Serenity 评分（如果是 supplement 来源）
  serenityScore?: number;
  thesis?: string;
}

export const COMPANIES_WITH_HEAT: CompanyWithHeat[] = COMPANIES.map((c) => ({
  ...c,
  heat: computeHeat(c),
  dataSource: "mock" as const,
}));

// ---------------- 真实数据 merge ----------------
export interface SnapshotItem {
  price: number;
  valuationPct: number | null;
  valuationMethod?: "pe_history" | "price_history";
  momentum20d: number | null;
  rsi: number | null;
  sentiment: number | null;
  lastBar: string;
  bars: number;
  symbol: string;
  fundamentals?: Fundamentals;
}

export interface PulseSnapshot {
  generated_at: string;
  data_window: string;
  ok: number;
  total: number;
  missing: string[];
  items: Record<string, SnapshotItem>;
}

/** 把真实数据 merge 进 COMPANIES_WITH_HEAT；缺数据的保留 mock + 标记 */
export function enrichWithSnapshot(snapshot: PulseSnapshot | null): CompanyWithHeat[] {
  if (!snapshot) return COMPANIES_WITH_HEAT;
  return COMPANIES.map((c): CompanyWithHeat => {
    const live = snapshot.items[c.ticker];
    if (
      !live ||
      live.valuationPct == null ||
      live.momentum20d == null ||
      live.rsi == null ||
      live.sentiment == null
    ) {
      return { ...c, heat: computeHeat(c), dataSource: "mock" };
    }
    const enriched = {
      valuationPct: Math.round(live.valuationPct),
      momentum20d: Math.round(live.momentum20d),
      rsi: Math.round(live.rsi),
      sentiment: Math.round(live.sentiment),
    };
    return {
      ...c,
      ...enriched,
      heat: computeHeat(enriched),
      dataSource: "live",
      livePrice: live.price,
      liveBar: live.lastBar,
      fundamentals: live.fundamentals,
      valuationMethod: live.valuationMethod,
    };
  });
}

// ---------------- 产业链关系矩阵 ----------------
// 端点 = ticker（必须与 COMPANIES.ticker 一致）
// strength: 1 弱 / 2 中 / 3 强
export interface Edge {
  from: string;
  to: string;
  strength: 1 | 2 | 3;
}

const E = (from: string, to: string, strength: 1 | 2 | 3 = 2): Edge => ({ from, to, strength });

export const SUPPLY_EDGES: Edge[] = [
  // L1 设备 → L2 晶圆
  E("ASML", "TSM", 3), E("ASML", "005930", 2), E("ASML", "981", 1),
  E("AMAT", "TSM", 3), E("LRCX", "TSM", 3), E("KLAC", "TSM", 2),
  E("002371", "981", 3), E("688012", "981", 3), E("688072", "981", 2),
  // L2 HBM → L3 AI 芯片
  E("000660", "NVDA", 3), E("000660", "AMD", 2),
  E("MU", "NVDA", 2), E("MU", "AMD", 1),
  // L2 封装 → L3 AI 芯片
  E("3711", "NVDA", 2), E("3711", "AVGO", 2),
  E("600584", "688041", 2), E("600584", "688256", 2),
  E("002156", "AMD", 2),
  // L2 晶圆 → L3 AI 芯片
  E("TSM", "NVDA", 3), E("TSM", "AMD", 3), E("TSM", "AVGO", 3),
  E("TSM", "AAPL", 3), E("TSM", "MRVL", 2), E("TSM", "3661", 2),
  E("TSM", "QCOM", 2), E("TSM", "2454", 2),
  E("981", "688256", 2), E("981", "688041", 2),
  // L3 AI 芯片 → L4 服务器
  E("NVDA", "SMCI", 3), E("NVDA", "DELL", 2),
  E("NVDA", "601138", 3), E("NVDA", "2317", 2), E("NVDA", "2382", 2),
  E("NVDA", "000977", 2), E("AMD", "SMCI", 2),
  // L3 ASIC → L5 云（自研芯片代设计）
  E("AVGO", "GOOGL", 3), E("AVGO", "META", 2), E("AVGO", "AAPL", 2),
  E("MRVL", "AMZN", 2),
  // L4 网络/光模块 → L3/L5
  E("300308", "NVDA", 3), E("300502", "NVDA", 3),
  E("300394", "NVDA", 2), E("ANET", "META", 3), E("ANET", "MSFT", 2),
  // L0 电力 → L5 云（PPA / 长协）
  E("VST", "MSFT", 2), E("CEG", "MSFT", 3),
  E("GEV", "MSFT", 2), E("GEV", "GOOGL", 2), E("GEV", "AMZN", 1),
  E("VRT", "MSFT", 2), E("VRT", "EQIX", 2),
  // L0 中国电力 → 国内云
  E("601985", "9988", 1), E("003816", "700", 1),
  // L4 IDC → L5 云
  E("EQIX", "MSFT", 2), E("EQIX", "AMZN", 2), E("DLR", "GOOGL", 2),
  E("9698", "9988", 3), E("9698", "700", 2), E("600845", "9988", 2),
  E("CRWV", "MSFT", 2),
  // L4 液冷 → L4 IDC
  E("002837", "9698", 2), E("002837", "600845", 2),
  E("301018", "600845", 1),
  // L5 云 → L6 应用
  E("MSFT", "CRM", 1), E("MSFT", "NOW", 1), E("MSFT", "ADBE", 1),
  E("9988", "002050", 1),
  // L6 → L7 端侧（机器人/汽车零部件 ↔ 终端品牌）
  E("002475", "AAPL", 3), E("002475", "META-S", 2),
  E("002241", "META-S", 3), E("002241", "AAPL", 2),
  E("2018", "AAPL", 2), E("2018", "1810", 2),
  // L7 端侧 ← L3 芯片
  E("QCOM", "1810", 2), E("QCOM", "005930-S", 2),
  E("2454", "1810", 2),

  // Serenity 关键金属 / 上游材料 → 下游
  // 锗 → 光模块（光纤、红外）
  E("002428", "300308", 3), E("002428", "300502", 2), E("002428", "002222", 2),
  // 稀土 → 永磁电机（机器人 / EV）
  E("000831", "002050", 2), E("000831", "688017", 2), E("000831", "601689", 2),
  // 锡 → 半导体封装焊料（全行业）
  E("600301", "TSM", 1), E("600301", "600584", 2), E("000960", "TSM", 1), E("000960", "600584", 2),
  // 钽 → 服务器电容（高端 IDC）
  E("000962", "601138", 2), E("000962", "SMCI", 1),
  // 半导体材料 → 晶圆代工
  E("002409", "TSM", 2), E("002409", "981", 3), E("002409", "1347", 2),
  E("300666", "TSM", 2), E("300666", "981", 3), E("300666", "005930", 2),
  // 福晶激光晶体 → 光模块 / 激光器
  E("002222", "300308", 2), E("002222", "COHR", 2), E("002222", "300502", 2),
];

// ---------------- 产业链切换 ----------------
export type IndustryId = "AI" | "humanoid" | "defense" | "rare-metals" | "biotech";

export interface Industry {
  id: IndustryId;
  name: string;
  emoji: string;
  desc: string;
  // tickers 为空 = 包含所有（用于默认 AI）
  tickers?: string[];
}

export const INDUSTRIES: Industry[] = [
  {
    id: "AI",
    name: "AI 产业链",
    emoji: "🤖",
    desc: "L0 能源 → L7 端侧的 8 层全景",
    // 不指定 tickers = 包含所有 COMPANIES
  },
  {
    id: "humanoid",
    name: "人形机器人",
    emoji: "🦾",
    desc: "减速器 / 丝杠 / 伺服 / 稀土永磁 / 传感器 / 整机",
    tickers: [
      "TSLA",
      "002050", "688017", "601689", // 机器人零部件三剑客
      "000831", // 中国稀土（永磁）
      "000970", // 中科三环
      "300748", // 金力永磁
      "300127", // 银河磁体
      "600366", // 宁波韵升
      "300553", // 集智股份（动平衡机+humanoid）
      "688322", // 奥比中光-W（3D 视觉传感）
      "002472", // 双环传动（减速器齿轮）
      "688686", // 奥普特（机器视觉）
      "300420", // — TBD
      "601877", // 正泰电器
      "688322", "688400", // 机器视觉
    ],
  },
  {
    id: "defense",
    name: "国防 / 军工",
    emoji: "🛡️",
    desc: "航发 / 雷达 / 隐身材料 / IMU / 特种 IC / UAV",
    tickers: [
      "688122", // 西部超导
      "688708", // 佳驰科技
      "688281", // 华秦科技
      "600893", // 航发动力
      "600765", // 中航重机
      "300034", // 钢研高纳
      "300855", // 图南股份
      "688563", // 航材股份
      "688510", // 航亚科技
      "688237", // 超卓航科
      "688231", // 隆达股份
      "300775", // 三角防务
      "002296", // 兴森 — TBD
      "002414", // 高德红外
      "688002", // 睿创微纳
      "688272", // 富吉瑞
      "300516", // 久之洋
      "002389", // 航天彩虹
      "688297", // 中无人机
      "600038", // 中直股份
      "302132", // 中航成飞
      "000768", // 中航西飞
      "688522", // 纳睿雷达
      "688683", // — TBD
      "600562", // 国睿科技
      "002025", // 航天电器
      "688582", // 芯动联科 IMU
      "003031", // 中瓷电子
      "002049", // 紫光国微
      "002246", // 北化股份
      "000733", // 振华科技
      "688709", // 成都华微
      "603712", // 七一二
      "001270", // 铖昌科技
      "300447", // 全信股份
      "688682", // 霍莱沃
      "002025", "600372", // 中航机载
    ],
  },
  {
    id: "rare-metals",
    name: "稀有 / 战略金属",
    emoji: "⚛️",
    desc: "稀土 / 锗 / 锡 / 钨 / 钽 / 铟 / 镓 / 铂族",
    tickers: [
      "000831", // 中国稀土
      "600259", // 中稀有色
      "600392", // 盛和资源
      "002428", // 云南锗业
      "600497", // 驰宏锌锗
      "600301", // 华锡有色
      "000960", // 锡业股份
      "002378", // 章源钨业
      "002842", // 翔鹭钨业
      "000657", // 中钨高新
      "000962", // 东方钽业
      "002155", // 湖南黄金
      "002709", // 天赐材料
      "601899", // 紫金矿业
      "600988", // 赤峰黄金
      "603799", // 华友钴业
      "603993", // 洛阳钼业
      "600459", // 贵研铂业
      "600160", // 巨化股份（氟化）
      "300618", // 寒锐钴业
      "600188", // — TBD
      "000538", // — TBD
      "600188", // — TBD
      "300677", // 英科医疗
    ],
  },
  {
    id: "biotech",
    name: "生物医药",
    emoji: "🧬",
    desc: "创新药 / CRO / API / IVD / 医械 / 培养基",
    tickers: [
      "688506", // 百利天恒（ADC）
      "688271", // 联影医疗
      "688114", // 华大智造
      "688293", // 奥浦迈（细胞培养基）
      "688137", // 近岸蛋白（mRNA 原料酶）
      "002675", // 东诚药业（核药）
      "688278", // 特宝生物
      "300401", // 花园生物（VD3）
      "300285", // — 已在 AI（MLCC 粉体）
      "600161", // 天坛生物
      "300601", // — TBD
      "002252", // 上海莱士
      "000403", // 派林生物
      "601607", // — TBD
      "002007", // — TBD
      "688617", // 惠泰医疗
      "688050", // 爱博医疗
      "688212", // 澳华内镜
      "688301", // 奕瑞科技（X 射线探测器）
      "688151", // — TBD
      "300463", // — TBD
      "002030", // — TBD
      "688235", // — TBD
      "300782", // — 已在 AI
      "300601", // — TBD
      "603259", // — TBD
      "300759", // — TBD
      "603392", // — TBD
      "688331", // 荣昌生物
    ],
  },
];

export function getIndustry(id: IndustryId): Industry {
  return INDUSTRIES.find((x) => x.id === id) ?? INDUSTRIES[0];
}

export function filterByIndustry<T extends { ticker: string; industries?: IndustryId[] }>(
  items: T[],
  id: IndustryId,
): T[] {
  if (id === "AI") return items; // AI = 全部
  return items.filter((c) => {
    // 优先看公司自带的 industries tag
    if (c.industries && c.industries.includes(id)) return true;
    // fallback：检查 INDUSTRIES.tickers 列表
    const ind = getIndustry(id);
    return ind.tickers?.includes(c.ticker) ?? false;
  });
}

// ---------------- Supplement Companies（来自 aleabit_manifest） ----------------
// pulse-supplement.json 的每条记录
export interface SupplementItem {
  ticker: string;
  name: string;
  layer: LayerId;
  segment: string;
  region: Region;
  marketCapB: number;
  moat: 1 | 2 | 3 | 4 | 5;
  valuationPct: number;
  momentum20d: number;
  rsi: number;
  sentiment: number;
  industries: IndustryId[];
  _serenity_score?: number;
  _verdict?: string;
  _thesis?: string;
}

/** 把 supplement 合并到 items 之后。supplement 的 dataSource = "serenity"。
 *  现有 items 的 industries 默认设为 ["AI"]（如果没设过）。 */
export function mergeSupplement(
  items: CompanyWithHeat[],
  supplement: SupplementItem[] | null,
): CompanyWithHeat[] {
  // 给现有 items 默认 industries: ["AI"]
  const augmented = items.map((c) => ({
    ...c,
    industries: c.industries ?? (["AI"] as IndustryId[]),
  }));
  if (!supplement) return augmented;
  const existing = new Set(augmented.map((c) => c.ticker));
  const extra: CompanyWithHeat[] = [];
  for (const s of supplement) {
    if (existing.has(s.ticker)) continue;
    const inputs = {
      valuationPct: s.valuationPct,
      momentum20d: s.momentum20d,
      rsi: s.rsi,
      sentiment: s.sentiment,
    };
    extra.push({
      id: `${s.layer}-${s.ticker}-${s.name}`.replace(/\s+/g, ""),
      ticker: s.ticker,
      name: s.name,
      layer: s.layer,
      segment: s.segment,
      region: s.region,
      marketCapB: s.marketCapB,
      moat: s.moat,
      ...inputs,
      heat: computeHeat(inputs),
      dataSource: "serenity",
      industries: s.industries,
      serenityScore: s._serenity_score,
      thesis: s._thesis,
    });
  }
  return [...augmented, ...extra];
}

// 全市场情绪聚合
export function marketPulse(items: CompanyWithHeat[] = COMPANIES_WITH_HEAT) {
  const avg = items.reduce((s, x) => s + x.heat, 0) / items.length;
  const hot = items.filter((x) => x.heat >= 85).length;
  const cold = items.filter((x) => x.heat < 30).length;
  return {
    avgHeat: Math.round(avg),
    band: heatBand(avg),
    hotCount: hot,
    coldCount: cold,
    total: items.length,
  };
}
