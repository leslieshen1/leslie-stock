import { promises as fs } from "fs";
import path from "path";
import PulseClient from "./pulse/PulseClient";
import {
  COMPANIES_WITH_HEAT,
  enrichWithSnapshot,
  mergeSupplement,
  type PulseSnapshot,
  type SupplementItem,
} from "@/lib/supply-chain";
import { loadTrends } from "@/lib/pulse-static";
import MacroBar, { type MacroSeries } from "@/components/MacroBar";
import PremarketStrip from "@/components/PremarketStrip";

// Home = Heatmap（不藏起来）
async function loadMacro(): Promise<MacroSeries[]> {
  try {
    const p = path.join(process.cwd(), "public", "data", "macro.json");
    return (JSON.parse(await fs.readFile(p, "utf-8")).series || []) as MacroSeries[];
  } catch {
    return [];
  }
}

// 热力图价格/涨跌/市值与 list 同源:us-stocks.json(Nasdaq 全市场),取代 12 天前的 pulse-snapshot
async function loadUsPrices(): Promise<Record<string, { price: number | null; pct: number | null; mcapB: number | null }>> {
  try {
    const p = path.join(process.cwd(), "public", "data", "us-stocks.json");
    const stocks = JSON.parse(await fs.readFile(p, "utf-8")).stocks || [];
    const m: Record<string, { price: number | null; pct: number | null; mcapB: number | null }> = {};
    for (const s of stocks) m[s.sym] = { price: s.price ?? null, pct: s.pct ?? null, mcapB: s.mcapB ?? null };
    return m;
  } catch {
    return {};
  }
}

// 基本面与详情页同源:us-fundamentals.json(紧凑 key),映射成热力图 FundamentalsBlock 的字段
type CompactFund = {
  pe?: number; fpe?: number; pb?: number; ps?: number; roe?: number; pm?: number;
  gm?: number; revG?: number; earnG?: number; de?: number; divY?: number; beta?: number;
};
async function loadUsFundamentals(): Promise<Record<string, CompactFund>> {
  try {
    const p = path.join(process.cwd(), "public", "data", "us-fundamentals.json");
    return (JSON.parse(await fs.readFile(p, "utf-8")).stocks || {}) as Record<string, CompactFund>;
  } catch {
    return {};
  }
}
// 紧凑 → snapshot 字段。注意股息率单位:us-fundamentals 的 divY 是百分数(2.75=2.75%),
// 而 FundamentalsBlock 会 ×100,所以这里 /100 还原成小数。
function mapFund(f: CompactFund) {
  return {
    trailingPE: f.pe, forwardPE: f.fpe, priceToBook: f.pb, priceToSales: f.ps,
    roe: f.roe, profitMargin: f.pm, grossMargin: f.gm,
    revenueGrowth: f.revG, earningsGrowth: f.earnG, debtToEquity: f.de,
    dividendYield: f.divY != null ? f.divY / 100 : undefined, beta: f.beta,
  };
}
async function loadSnapshot(): Promise<PulseSnapshot | null> {
  try {
 const p = path.join(process.cwd(), "public", "data", "pulse-snapshot.json");
 const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as PulseSnapshot;
  } catch {
    return null;
  }
}

async function loadSupplement(): Promise<SupplementItem[] | null> {
  try {
 const p = path.join(process.cwd(), "public", "data", "pulse-supplement.json");
 const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as SupplementItem[];
  } catch {
    return null;
  }
}

type IndustryLayerDef = { id: string; name: string; summary?: string };
type IndustryDef = { id: string; name: string; desc: string; layers: IndustryLayerDef[] };
type IndustryMap = { industries: IndustryDef[]; placement: Record<string, Record<string, string>> };
async function loadIndustryMap(): Promise<IndustryMap> {
  try {
    const p = path.join(process.cwd(), "public", "data", "industry-map.json");
    return JSON.parse(await fs.readFile(p, "utf-8")) as IndustryMap;
  } catch {
    return { industries: [], placement: {} };
  }
}

type HeatRec = { h: number; pos: number | null; val: number | null; rsi: number | null; mom: number | null };
type UsHeat = { generated_at?: string | null; stocks: Record<string, HeatRec> };
async function loadUsHeat(): Promise<UsHeat> {
  try {
    const p = path.join(process.cwd(), "public", "data", "us-heat.json");
    return JSON.parse(await fs.readFile(p, "utf-8")) as UsHeat;
  } catch {
    return { stocks: {} };
  }
}

type PanelSummary = { order: string[]; generated_at?: string | null; stocks: Record<string, { sc: (number | null)[]; div: number }> };
// 热力图真分源:US 五方 + A股 Serenity(scripts/build_pulse_scores.py 合成),取代 mock 评分
async function loadPanelSummary(): Promise<PanelSummary> {
  try {
    const p = path.join(process.cwd(), "public", "data", "pulse-scores.json");
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as PanelSummary;
  } catch {
    return { order: [], stocks: {} };
  }
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ industry?: string; highlight?: string }>;
}) {
  const [snapshot, supplement, panelSummary, industryMap, usHeat, macro, usPrices, usFund] = await Promise.all([
    loadSnapshot(),
    loadSupplement(),
    loadPanelSummary(),
    loadIndustryMap(),
    loadUsHeat(),
    loadMacro(),
    loadUsPrices(),
    loadUsFundamentals(),
  ]);
  const baseItems = snapshot ? enrichWithSnapshot(snapshot) : COMPANIES_WITH_HEAT;
  // 与 list/详情页同源:heat=us-heat,price/pct/市值=us-stocks,基本面=us-fundamentals(全是最新 Nasdaq/Yahoo)
  const items = mergeSupplement(baseItems, supplement).map((it) => {
    let m = it;
    // 过热度总分 + 分项(离高点/估值/RSI/动量)一起注入,详情面板分项就和总分对齐
    const hv = usHeat.stocks[it.ticker];
    if (hv) m = { ...m, heat: hv.h, pos52: hv.pos,
      valuationPct: hv.val ?? m.valuationPct, rsi: hv.rsi ?? m.rsi, momentum20d: hv.mom ?? m.momentum20d };
    const up = usPrices[it.ticker];
    if (up && up.price != null) {
      m = { ...m, livePrice: up.price, pct: up.pct, dataSource: "live" as const };
      if (up.mcapB != null) m = { ...m, marketCapB: up.mcapB };
    }
    // 基本面只认 us-fundamentals(和详情页同一口径);没有就清空,不留 12 天前的旧 snapshot
    const fu = usFund[it.ticker];
    m = { ...m, fundamentals: fu ? mapFund(fu) : undefined };
    return m;
  });

  // 真分 + 产业链放置都只裁剪出热力图节点用到的(避免全量塞进 client payload)
  const nodeTickers = new Set(items.map((i) => i.ticker));
  const scopedScores: Record<string, { sc: (number | null)[]; div: number }> = {};
  for (const [k, v] of Object.entries(panelSummary.stocks)) {
    if (nodeTickers.has(k)) scopedScores[k] = v;
  }
  const scopedPlacement: Record<string, Record<string, string>> = {};
  for (const [k, v] of Object.entries(industryMap.placement)) {
    if (nodeTickers.has(k)) scopedPlacement[k] = v;
  }
  // 徽章口径:真正驱动上色的是"分析判读覆盖",不是旧价格快照
  const coveredCount = Object.keys(scopedScores).length;
  const analyzedAtLabel = panelSummary.generated_at ? fmtAge(panelSummary.generated_at) : null;
  // 短期热度行情的新鲜度(us-stocks 生成时间,格式 "YYYY-MM-DD HH:mm UTC")
  const heatAge = usHeat.generated_at
    ? fmtAge(usHeat.generated_at.replace(" UTC", "Z").replace(" ", "T"))
    : null;
 const liveCount = items.filter((i) => i.dataSource === "live").length;
 const serenityCount = items.filter((i) => i.dataSource === "serenity").length;

  // 30 天 trend 从静态 JSON 读
  const trends = await loadTrends();

  // URL params: ?industry=rare-metals&highlight=002428
  const sp = await searchParams;
 const ALLOWED_INDUSTRIES = ["AI", "humanoid", "defense", "rare-metals", "biotech"] as const;
  const initialIndustry =
    sp.industry && ALLOWED_INDUSTRIES.includes(sp.industry as typeof ALLOWED_INDUSTRIES[number])
      ? (sp.industry as typeof ALLOWED_INDUSTRIES[number])
      : undefined;
  const initialHighlight = sp.highlight;

  return (
 <main className="mx-auto max-w-[1480px] px-6 py-10">
      <MacroBar series={macro} />
      <PremarketStrip />
      <PulseClient
        items={items}
        trends={trends}
        liveCount={liveCount}
        initialIndustry={initialIndustry}
        initialHighlight={initialHighlight}
        panelSummary={scopedScores}
        masterOrder={panelSummary.order}
        coveredCount={coveredCount}
        analyzedAtLabel={analyzedAtLabel}
        priceAgeLabel={heatAge}
        chainIndustries={industryMap.industries}
        chainPlacement={scopedPlacement}
      />

 <footer className="mt-12 pt-2 text-center">
 <p className="text-[10px] text-faint">
          实时行情(Nasdaq/Yahoo)· 五方独立判读(AI)· 自攒历史 RSI/动量 · v0.6
        </p>
      </footer>
    </main>
  );
}

function fmtAge(iso: string): string {
  const t = new Date(iso).getTime();
  const diffMs = Date.now() - t;
  const mins = Math.floor(diffMs / 60_000);
 if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  return `${days} 天前`;
}
