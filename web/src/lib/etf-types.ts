// 客户端安全：ETF 类型 + 展示常量。数据 = web/public/data/etf-analyses.json（客户端 fetch）。
export type EtfRow = {
  rank: number;
  sym: string;
  name: string;
  price: number | null;
  pct: number | null;
  aum: number | null;      // 千美元
  expense: number | null;  // %
  beta: number | null;
  yield: number | null;
  // 业绩(Nasdaq 5年日线算)
  ret1y: number | null;    // % 累计
  ret3y: number | null;
  ret5y: number | null;
  mdd: number | null;      // % 最大回撤(负数)
  vol: number | null;      // % 年化波动
  years: number | null;    // 历史年限
  sector: string;          // 细分板块，如 半导体 / 黄金 / 红利
  kind: string;            // 大类：宽基/行业/主题/因子策略/债券/商品/工具/其他
  verdict: string;         // BG 判decision tag
  cls: "up" | "neutral" | "down";
  why: string;
  thesis?: string;
};

export type SectorAgg = { sector: string; super: string; n: number; aum: number };

export type EtfData = {
  updated: string;
  n: number;
  supers: Record<string, number>;
  sectors: SectorAgg[];
  etfs: EtfRow[];
};

// 大类筛选顺序 + 中英
export const SUPERS: { key: string; zh: string; en: string }[] = [
  { key: "宽基", zh: "宽基", en: "Broad" },
  { key: "行业", zh: "行业", en: "Sector" },
  { key: "主题", zh: "主题", en: "Thematic" },
  { key: "因子策略", zh: "因子/策略", en: "Factor" },
  { key: "债券", zh: "债券", en: "Bond" },
  { key: "商品", zh: "商品", en: "Commodity" },
  { key: "工具", zh: "杠杆/反向", en: "Leveraged" },
  { key: "其他", zh: "其他", en: "Other" },
];

// 排序维度
export const SORTS: { key: string; zh: string; en: string }[] = [
  { key: "aum", zh: "规模", en: "AUM" },
  { key: "ret1y", zh: "近1年", en: "1Y" },
  { key: "ret5y", zh: "近5年", en: "5Y" },
  { key: "mdd", zh: "抗跌", en: "Drawdown" },
];

export const CLS_TONE: Record<string, string> = {
  up: "text-up border-up/30 bg-up-soft",
  neutral: "text-accent border-accent/25 bg-accent/10",
  down: "text-down border-down/30 bg-down-soft",
};
