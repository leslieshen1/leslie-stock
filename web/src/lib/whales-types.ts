// 类型 + 展示常量（client 安全,无 fs）。loader 在 whales.ts（server only）。

export type ChangeType = "new" | "add" | "trim" | "exit" | "hold";

export type Holding = {
  ticker: string;
  market: "a" | "us" | "hk";
  stock_name: string;
  period: string;
  shares: number | null;
  market_value: number | null;
  pct_of_portfolio: number | null;
  rank_in_portfolio: number | null;
  change_type: ChangeType | null;
  change_pct: number | null;
  amount_range?: string | null;   // 议员交易金额区间("$1M–5M")
  trade_date?: string | null;     // 议员交易日
  source: string;
};

export type InvestorType = "superinvestor" | "fund" | "politician" | "hot_money" | "northbound";

export type Investor = {
  slug: string;
  name: string;
  name_en: string | null;
  entity: string | null;
  type: InvestorType;
  archetype: "contract" | "meme" | null;
  country: string;
  aum_usd: number | null;
  holdings_count: number | null;
  notable_for: string | null;
  latest_period: string;
  holdings: Holding[];
};

export type TickerHolder = {
  investor: string;
  slug: string;
  type: InvestorType;
  archetype: string | null;
  entity: string | null;
  pct: number | null;
  rank: number | null;
  change_type: ChangeType | null;
  amount_range?: string | null;
  trade_date?: string | null;
  period: string;
};

export type WhalesData = {
  investors: Investor[];
  by_ticker: Record<string, TickerHolder[]>;
};

export const CHANGE_META: Record<ChangeType, { label: string; tone: string }> = {
  new:  { label: "新建仓", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  add:  { label: "加仓",   tone: "bg-blue-50 text-blue-700 border-blue-200" },
  trim: { label: "减仓",   tone: "bg-amber-50 text-amber-700 border-amber-200" },
  exit: { label: "清仓",   tone: "bg-rose-50 text-rose-700 border-rose-200" },
  hold: { label: "持有",   tone: "bg-zinc-50 text-zinc-500 border-zinc-200" },
};

export const TYPE_META: Record<InvestorType, { label: string; emoji: string }> = {
  superinvestor: { label: "美股大佬", emoji: "🇺🇸" },
  fund:          { label: "A股顶流", emoji: "🏦" },
  politician:    { label: "政客 / 议员", emoji: "🏛️" },
  hot_money:     { label: "游资席位", emoji: "🎰" },
  northbound:    { label: "北向资金", emoji: "🌊" },
};
