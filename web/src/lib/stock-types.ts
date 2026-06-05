// 股票类型注册表 —— "每类股票该看的指标不一样,PE 只是其一"。
// 与五方大师正交的第二条轴:先定类型(用什么尺子量)+ 哪个大师的主场,再看五方判读。
// 来源:站内"怎么炒美股"框架(成长/价值/周期/防御/垄断)。

export type StockTypeKey = "growth" | "value" | "cyclical" | "defensive" | "moat";

export type StockType = {
  key: StockTypeKey;
  name: string;
  emoji: string;
  tagline: string;     // 一句话核心
  watch: string[];     // 该看的指标
  avoid: string;       // 别只盯什么(最容易踩的坑)
  master: string;      // 主场大师(和五方咬合)
  tone: "up" | "accent" | "amber" | "muted" | "moat"; // 上色
};

export const STOCK_TYPES: Record<StockTypeKey, StockType> = {
  growth: {
    key: "growth", name: "成长股", emoji: "🚀", tagline: "未来盈利最重要,买的是未来数年的盈利扩张",
    watch: ["收入增速", "毛利率", "PS 市销率", "Rule of 40"],
    avoid: "高速扩张期 PE 易失效 —— 别只盯 PE,PS 才是在给未来利润率定价",
    master: "德鲁肯米勒", tone: "up",
  },
  value: {
    key: "value", name: "价值股", emoji: "🏦", tagline: "成熟稳定,以折扣价买可预测的现金流",
    watch: ["PE 家族(TTM / Forward)", "P/FCF", "ROIC", "Earnings Yield"],
    avoid: "PE 易被会计操纵 —— P/FCF 扣掉资本支出更真,要和历史/行业对比着看",
    master: "巴菲特", tone: "accent",
  },
  cyclical: {
    key: "cyclical", name: "周期股", emoji: "🔄", tagline: "盈利随宏观/商品周期剧烈波动",
    watch: ["EV/EBITDA", "库存周期", "商品价格", "资产重置成本"],
    avoid: "千万别看 PE!低 PE 常出现在周期顶部,高 PE 反而可能是底部反转 —— 判断周期位置远比静态倍数重要",
    master: "Serenity", tone: "amber",
  },
  defensive: {
    key: "defensive", name: "防御 / 利息股", emoji: "🛡️", tagline: "买的是确定性,不是高增长",
    watch: ["股息率", "FCF 稳定性", "利息覆盖倍数", "AFFO(REITs)"],
    avoid: "本质是股市里的'类固定收益' —— 看利率敏感性和股息,别套成长逻辑",
    master: "情绪资金面", tone: "muted",
  },
  moat: {
    key: "moat", name: "垄断股", emoji: "👑", tagline: "网络/品牌/技术/规模壁垒,时间是它的盟友",
    watch: ["毛利率稳定性", "市场份额", "定价权(卡脖子环节最强)"],
    avoid: "估值定性 > 定量,PE / 营收都会失真 —— 要加'垄断溢价',回到产业链定性分析",
    master: "段永平", tone: "moat",
  },
};

export const STOCK_TYPE_LIST = Object.values(STOCK_TYPES);
