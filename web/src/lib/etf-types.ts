// 客户端安全：ETF 类型 + 展示常量。数据 = web/public/data/etf-analyses.json（客户端 fetch）。
export type EtfRow = {
  rank: number;
  sym: string;
  name: string;
  price: number | null;
  pct: number | null;
  ret1y: number | null;
  aum: number | null;      // 千美元
  expense: number | null;  // %
  beta: number | null;
  yield: number | null;
  kind: string;            // 宽基/行业/主题/杠杆反向/债券/商品/因子红利/混合其他
  verdict: string;         // BG 判decision tag
  cls: "up" | "neutral" | "down";
  why: string;
  thesis?: string;         // LLM 一句话(top AUM 才有)
};

export type EtfData = {
  updated: string;
  n: number;
  kinds: Record<string, number>;
  etfs: EtfRow[];
};

// 类型筛选顺序 + 中英
export const KINDS: { key: string; zh: string; en: string }[] = [
  { key: "宽基", zh: "宽基", en: "Broad" },
  { key: "行业", zh: "行业", en: "Sector" },
  { key: "主题", zh: "主题", en: "Thematic" },
  { key: "因子/红利", zh: "因子/红利", en: "Factor" },
  { key: "债券", zh: "债券", en: "Bond" },
  { key: "商品", zh: "商品", en: "Commodity" },
  { key: "杠杆反向", zh: "杠杆/反向", en: "Leveraged" },
  { key: "混合/其他", zh: "其他", en: "Other" },
];

// BG 判决 → 颜色 class
export const CLS_TONE: Record<string, string> = {
  up: "text-up border-up/30 bg-up-soft",
  neutral: "text-accent border-accent/25 bg-accent/10",
  down: "text-down border-down/30 bg-down-soft",
};
