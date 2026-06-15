import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { marked } from "marked";
import { safeCode, safeMarket, safeUnder } from "./sanitize";

// 数据目录优先级：web/data（部署用）→ ../data（本地开发回退）
const WEB_DATA = path.join(process.cwd(), "data");
const SIBLING_DATA = path.resolve(process.cwd(), "..", "data");
const DATA_ROOT = fs.existsSync(WEB_DATA) ? WEB_DATA : SIBLING_DATA;
const PROJECT_ROOT = path.resolve(DATA_ROOT, "..");

const PORTFOLIO_PATH = path.join(PROJECT_ROOT, "core", "portfolio.csv");
const DELIVERABLES_DIR = path.join(PROJECT_ROOT, "deliverables");
const RANKINGS_PATH = path.join(DATA_ROOT, "rankings.json");
const ANALYSES_DIR = path.join(DATA_ROOT, "analyses");
const WATCHLIST_PATH = path.join(DATA_ROOT, "watchlist.json");
const ALEABIT_MANIFEST_PATH = path.join(DATA_ROOT, "aleabit_manifest.json");

export const LESLIE_STOCK_ROOT = PROJECT_ROOT;
export const ANALYSES_DIRECTORY = ANALYSES_DIR;

export type Position = {
  code: string;
  market: "a" | "hk";
  name: string;
  buy_date: string;
  buy_price: number;
  shares: number;
  position_pct: number;
  thesis: string;
  sell_conditions: string[];
  notes: string;
};

export function loadPortfolio(): Position[] {
  if (!fs.existsSync(PORTFOLIO_PATH)) return [];
  const raw = fs.readFileSync(PORTFOLIO_PATH, "utf-8");
  // 过滤掉注释行
  const cleaned = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  const rows = parse(cleaned, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  return rows.map((r) => ({
    code: r.code,
    market: (r.market || "a").toLowerCase() as "a" | "hk",
    name: r.name,
    buy_date: r.buy_date,
    buy_price: Number(r.buy_price),
    shares: Number(r.shares),
    position_pct: Number(r.position_pct || 0),
    thesis: r.thesis || "",
    sell_conditions: (r.sell_conditions || "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean),
    notes: r.notes || "",
  }));
}

export function loadLatestBriefing(): { date: string; markdown: string; html: string } | null {
  if (!fs.existsSync(DELIVERABLES_DIR)) return null;
  const files = fs
    .readdirSync(DELIVERABLES_DIR)
    .filter((f) => f.startsWith("briefing_") && f.endsWith(".md"))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  const latest = files[0];
  const dateMatch = latest.match(/briefing_(\d{4}-\d{2}-\d{2})\.md/);
  const date = dateMatch ? dateMatch[1] : "未知日期";
  const markdown = fs.readFileSync(path.join(DELIVERABLES_DIR, latest), "utf-8");
  const html = marked.parse(markdown, { async: false }) as string;
  return { date, markdown, html };
}

export function dayDiff(fromDate: string): number {
  const start = new Date(fromDate);
  const now = new Date();
  return Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

export type Ranking = {
  code: string;
  name: string;
  market: "a" | "hk";
  industry: string | null;
  circles: string;
  market_cap: number | null;
  price: number | null;
  change_pct: number | null;
  pe_ttm: number | null;
  pb: number | null;
  score_overall: number;
  score_financials: number;
  score_valuation: number;
  score_circle: number;
  grade: string;
  n_red: number;
  n_yellow: number;
  n_green: number;
  top_flags: string;
  updated_at: string;
};

export function loadRankings(): Ranking[] {
  if (!fs.existsSync(RANKINGS_PATH)) return [];
  try {
    const raw = fs.readFileSync(RANKINGS_PATH, "utf-8");
    const arr = JSON.parse(raw) as Ranking[];
    return arr;
  } catch {
    return [];
  }
}

export function getRankingsUpdatedAt(): string | null {
  if (!fs.existsSync(RANKINGS_PATH)) return null;
  const stats = fs.statSync(RANKINGS_PATH);
  return stats.mtime.toISOString();
}

export const CIRCLES = [
  "AI 上下游",
  "能源/材料/资源",
  "医药生物",
  "互联网",
] as const;
export type Circle = (typeof CIRCLES)[number];

export function rankingsByCircle(rankings: Ranking[]): Record<string, Ranking[]> {
  const out: Record<string, Ranking[]> = {};
  for (const c of CIRCLES) out[c] = [];
  for (const r of rankings) {
    for (const c of CIRCLES) {
      if (r.circles.includes(c)) {
        out[c].push(r);
      }
    }
  }
  // sort each by score
  for (const c of CIRCLES) {
    out[c].sort((a, b) => b.score_overall - a.score_overall);
  }
  return out;
}

export type DimensionScore = {
  name: string;
  score: number;
  grade: string;
  details: string[];
  flags: string[];
};

export type FinancialsHistory = {
  dates?: string[];
  roe?: (number | null)[];
  gross_margin?: (number | null)[];
  net_margin?: (number | null)[];
  debt_ratio?: (number | null)[];
  roa?: (number | null)[];
  ocf_to_ni?: (number | null)[];
};

export type AleabitSignal = {
  name: string;
  hit: "yes" | "partial" | "no";
  note: string;
};

export type AleabitAnalysis = {
  supply_chain_layer: 1 | 2 | 3 | 4 | null;
  layer_label: string;
  bottleneck_score: number;
  verdict:
    | "high_conviction"
    | "worth_watching"
    | "macro_tailwind"
    | "aleabit_analogue"
    | "crowded_but_valid"
    | "not_aleabit_territory";
  verdict_label: string;
  thesis: string;
  signals: AleabitSignal[];
  signals_hit: number;
  red_flags: string[];
  ai_relevance: string;
  updated_at: string;
};

// ============================================================
// 深度分析扩展（v2+ 票才有）
// ============================================================

export type AnalysisVersion = {
  framework: "serenity" | "bg" | "news";
  version: string;
  score: number | null;
  verdict_label: string;
  layer_label: string;
  thesis: string;
  signals_hit: number;
  red_flags: string[];
  model: string;
  pre_labeled: boolean;
  created_at: string;
};

export type FinancialQuarter = {
  period: string;
  revenue: number | null;
  n_income: number | null;
  or_yoy: number | null;
  net_margin: number | null;
  gross_margin: number | null;
  roe: number | null;
  debt_to_assets: number | null;
};

export type RecentEvent = {
  ann_date: string;
  title: string;
  tier: 1 | 2 | 3 | 4 | 5;
  keyword: string;
  url: string;
  pdf_url: string | null;
};

export type Analysis = {
  code: string;
  name: string;
  market: "a" | "hk" | "us";
  sector?: string;
  industry: string | null;
  overall_score: number;
  overall_grade: string;
  verdict: string;
  llm_used: boolean;
  llm_model?: string | null;
  dimensions: {
    business_model: DimensionScore;
    moat: DimensionScore;
    management: DimensionScore;
    financials: DimensionScore;
    valuation: DimensionScore;
    circle: DimensionScore;
  };
  raw_quote: Record<string, unknown>;
  sell_triggers: string[];
  markdown?: string;
  updated_at: string;
  elapsed_seconds?: number;
  financials_history?: FinancialsHistory;
  financials?: { quarters: FinancialQuarter[] };
  aleabit?: AleabitAnalysis;
  // 深度分析扩展
  analyses_history?: AnalysisVersion[];
  recent_events?: RecentEvent[];
};

export type NewsAnalysis = {
  code: string;
  market: "a" | "hk";
  days: number;
  updated_at: string;
  news_analyzed?: Array<{
    title: string;
    pub_time: string;
    bg_tags: string[];
    signal: string;
    verdict: string;
  }>;
  announcements_analyzed?: Array<{
    title: string;
    pub_time: string;
    bg_tags: string[];
    signal: string;
    verdict: string;
  }>;
  summary?: {
    overall_signal: string;
    narrative: string;
    action_suggestion: string;
    sell_condition_triggered: string;
    key_signals: string[];
  };
};

export function loadNewsAnalysis(code: string, market: string): NewsAnalysis | null {
  const c = safeCode(code), m = safeMarket(market);
  if (!c || !m) return null;
  const p = safeUnder(path.join(LESLIE_STOCK_ROOT, "data", "news_analyzed"), `${c}_${m}.json`);
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as NewsAnalysis;
  } catch {
    return null;
  }
}

export type WatchItem = {
  code: string;
  market: "a" | "hk" | "us";
  name: string;
  added_date: string;
  score_pro: number;
  score_alpha: number;
  grade: string;
  my_view: string;
  key_thesis: string;
  key_risks: string;
  target_buy_price: string;
  status: "ready_to_buy" | "tracking" | "hold_off";
  notes: string;
};

export function loadWatchlist(): WatchItem[] {
  if (!fs.existsSync(WATCHLIST_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(WATCHLIST_PATH, "utf-8")) as WatchItem[];
  } catch {
    return [];
  }
}

// 增强版 WatchItem：合并 watchlist + analyses cache 的 sector/concepts + aleabit verdict
export type EnrichedWatchItem = WatchItem & {
  sector?: string;
  concepts?: string[];
  industry?: string | null;
  has_analysis?: boolean;
  aleabit_verdict?: AleabitAnalysis["verdict"];
  aleabit_label?: string;
  aleabit_score?: number;
};

export function loadWatchlistEnriched(): EnrichedWatchItem[] {
  const items = loadWatchlist();
  return items.map((w) => {
    const analysis = loadAnalysis(w.code, w.market);
    return {
      ...w,
      sector: (analysis as unknown as { sector?: string })?.sector || "",
      concepts: (analysis as unknown as { concepts?: string[] })?.concepts || [],
      industry: analysis?.industry || null,
      has_analysis: !!analysis,
      aleabit_verdict: analysis?.aleabit?.verdict,
      aleabit_label: analysis?.aleabit?.verdict_label,
      aleabit_score: analysis?.aleabit?.bottleneck_score,
    };
  });
}

export function groupByConcept(items: EnrichedWatchItem[]): Record<string, EnrichedWatchItem[]> {
  const groups: Record<string, EnrichedWatchItem[]> = {};
  for (const item of items) {
    for (const concept of item.concepts || []) {
      if (!groups[concept]) groups[concept] = [];
      groups[concept].push(item);
    }
  }
  return groups;
}

export function groupBySector(items: EnrichedWatchItem[]): Record<string, EnrichedWatchItem[]> {
  const groups: Record<string, EnrichedWatchItem[]> = {};
  for (const item of items) {
    const sec = item.sector || "未分类";
    if (!groups[sec]) groups[sec] = [];
    groups[sec].push(item);
  }
  return groups;
}

export type AleabitManifestEntry = {
  code: string;
  name: string;
  market: "a" | "hk" | "us";
  market_cap_yi: number | null;
  sector: string;
  concepts?: string[];
  layer: 1 | 2 | 3 | 4 | null;
  score: number;
  verdict: AleabitAnalysis["verdict"];
  verdict_label: string;
  signals_hit: number;
  thesis: string;
  pre_labeled: boolean;
  has_full_analysis: boolean;
};

export function loadAleabitManifest(): AleabitManifestEntry[] {
  if (!fs.existsSync(ALEABIT_MANIFEST_PATH)) return [];
  try {
    const raw = fs.readFileSync(ALEABIT_MANIFEST_PATH, "utf-8");
    return JSON.parse(raw) as AleabitManifestEntry[];
  } catch {
    return [];
  }
}

export function loadAnalysis(code: string, market: string): Analysis | null {
  const c = safeCode(code), m = safeMarket(market);
  if (!c || !m) return null;
  const p = safeUnder(ANALYSES_DIR, `${c}_${m}.json`);
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as Analysis;
  } catch {
    return null;
  }
}

export function analysisExists(code: string, market: string): boolean {
  const c = safeCode(code), m = safeMarket(market);
  if (!c || !m) return false;
  const p = safeUnder(ANALYSES_DIR, `${c}_${m}.json`);
  return !!p && fs.existsSync(p);
}

export function analysisPending(code: string, market: string): boolean {
  const c = safeCode(code), m = safeMarket(market);
  if (!c || !m) return false;
  const p = safeUnder(ANALYSES_DIR, `${c}_${m}.lock`);
  return !!p && fs.existsSync(p);
}

export function formatMarketCap(v: number | null): string {
  if (v === null || v === undefined) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)} 万亿`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)} 亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(0)} 万`;
  return String(Math.round(v));
}
