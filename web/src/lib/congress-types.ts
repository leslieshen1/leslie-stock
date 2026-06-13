// 客户端安全：纯类型 + 常量，无 node:fs。加载器在 congress.ts（仅服务端）。
export type CongressSide = "buy" | "sell" | "exchange";

export type CongressTrade = {
  ticker: string;
  side: CongressSide;
  date: string;        // YYYY-MM-DD（交易日，非申报日）
  size: string;        // "$1K-$15K"
  lo: number | null;   // 区间下界（排序/规模用）
};

export type CongressMember = {
  id: string;          // 详情页路由：bioguide 或 区+末名
  name: string;
  party: "D" | "R" | "I" | "?";
  state: string;
  district: string;    // "CA11"
  bioguide: string | null;
  photo: string | null;
  current: boolean;
  n_trades: number;
  last_date: string;
  latest: CongressTrade;
  top_tickers: string[];
  trades: CongressTrade[];
};

export type CongressData = {
  updated: string;
  source: string;
  n_members: number;
  n_trades: number;
  members: CongressMember[];
};

export const PARTY_META: Record<string, { label: string; en: string; tone: string; dot: string }> = {
  D: { label: "民主党", en: "Democrat", tone: "text-[#3B82F6]", dot: "bg-[#3B82F6]" },
  R: { label: "共和党", en: "Republican", tone: "text-[#EF4444]", dot: "bg-[#EF4444]" },
  I: { label: "独立", en: "Independent", tone: "text-accent", dot: "bg-accent" },
  "?": { label: "—", en: "—", tone: "text-muted", dot: "bg-faint" },
};
