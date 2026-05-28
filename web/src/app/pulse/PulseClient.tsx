"use client";

import { useEffect, useMemo, useState } from "react";
import PulseField from "./PulseField";
import {
  LAYERS,
  SUPPLY_EDGES,
  heatBand,
  marketPulse,
  INDUSTRIES,
  filterByIndustry,
  type CompanyWithHeat,
  type LayerId,
  type Region,
  type IndustryId,
} from "@/lib/supply-chain";
import {
  getLayersFor,
  getEdgesFor,
  remapItemsForIndustry,
} from "@/lib/industry-chains";
import { tripleScore, type TripleScore, type PerspectiveScore } from "@/lib/scoring";

const REGIONS: { id: Region | "ALL"; label: string }[] = [
  { id: "ALL", label: "全部" },
  { id: "US",  label: "美股" },
  { id: "CN",  label: "A 股" },
  { id: "HK",  label: "港股" },
  { id: "TW",  label: "台股" },
  { id: "KR",  label: "韩股" },
  { id: "EU",  label: "欧" },
  { id: "JP",  label: "日" },
];

const HEAT_TIERS = [
  { id: "all", label: "全部", min: 0,  max: 100 },
  { id: "hot", label: "过热 ≥85", min: 85, max: 100 },
  { id: "warm", label: "偏热 70-85", min: 70, max: 85 },
  { id: "fair", label: "合理 50-70", min: 50, max: 70 },
  { id: "cool", label: "偏冷 <50", min: 0, max: 50 },
];

interface TrendPt { date: string; close?: number | null; heat?: number | null }
export default function PulseClient({
  items,
  trends = {},
  liveCount = 0,
  generatedAtLabel = null,
  initialIndustry,
  initialHighlight,
}: {
  items: CompanyWithHeat[];
  trends?: Record<string, TrendPt[]>;
  liveCount?: number;
  generatedAtLabel?: string | null;
  initialIndustry?: IndustryId;
  initialHighlight?: string;
}) {
  const [selected, setSelected] = useState<CompanyWithHeat | null>(null);
  const [industry, setIndustry] = useState<IndustryId>(initialIndustry ?? "AI");
  const [region, setRegion] = useState<Region | "ALL">("ALL");
  const [tier, setTier] = useState<string>("all");
  const [highlightLayer, setHighlightLayer] = useState<LayerId | null>(null);
  const [colorMode, setColorMode] = useState<"heat" | "triple">("heat");
  // 从详情页跳转过来时高亮的 ticker
  const [highlightTicker, setHighlightTicker] = useState<string | null>(initialHighlight ?? null);

  // 跳转过来时自动打开对应公司的 detail drawer
  useEffect(() => {
    if (!highlightTicker) return;
    const target = items.find((x) => x.ticker === highlightTicker);
    if (target) {
      setSelected(target);
      setHighlightTicker(null); // 只触发一次
    }
  }, [highlightTicker, items]);

  // 切换 industry 时清空 layer focus（旧 layer id 在新 industry 里无效）
  useEffect(() => {
    setHighlightLayer(null);
  }, [industry]);

  // 给每只 item 计算 triple score（只算一次，cache 住）
  const itemsScored = useMemo(
    () => items.map((c) => ({ ...c, triple: tripleScore(c).average })),
    [items],
  );

  // 先按 industry 过滤（AI = 全部，其他 industry = 子集 + 重映射 layer 到该 industry 的层级体系）
  const industryItems = useMemo(() => {
    const f = filterByIndustry(itemsScored, industry);
    return remapItemsForIndustry(f, industry);
  }, [itemsScored, industry]);

  // 每个 industry 的预计数量（用于按钮 badge）— 也用 remap 后数量，让 badge 反映实际产业链可见公司数
  const industryCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const ind of INDUSTRIES) {
      const f = filterByIndustry(itemsScored, ind.id);
      out[ind.id] = remapItemsForIndustry(f, ind.id).length;
    }
    return out;
  }, [itemsScored]);

  // 当前 industry 的 layers（非 AI 用 industry-chains.ts 里定义的）
  const activeLayers = useMemo(() => {
    const ind = getLayersFor(industry);
    if (ind) return ind.map((L) => ({ id: L.id, name: L.name }));
    return LAYERS.map((L) => ({ id: L.id, name: L.name }));
  }, [industry]);

  // 当前 industry 的 edges（hover 时显示上下游连线）
  const activeEdges = useMemo(() => {
    const ind = getEdgesFor(industry);
    return ind ?? SUPPLY_EDGES;
  }, [industry]);

  const filtered = useMemo(() => {
    const t = HEAT_TIERS.find((x) => x.id === tier)!;
    return industryItems.filter((c) => {
      if (region !== "ALL" && c.region !== region) return false;
      const score = colorMode === "heat" ? c.heat : c.triple;
      return score >= t.min && score <= t.max;
    });
  }, [industryItems, region, tier, colorMode]);

  const pulse = useMemo(() => {
    const src = filtered.length ? filtered : industryItems;
    // Market Pulse 大数也跟 mode 切
    if (colorMode === "heat") return marketPulse(src);
    // Triple mode 自己算
    const avg = Math.round(src.reduce((s, x) => s + x.triple, 0) / src.length);
    const hot = src.filter((x) => x.triple >= 70).length;
    const cold = src.filter((x) => x.triple < 40).length;
    return {
      avgHeat: avg,
      band: { label: avg >= 70 ? "整体优质" : avg >= 50 ? "平均水平" : avg >= 35 ? "整体偏弱" : "整体差", tone: "fair" as const },
      hotCount: hot,
      coldCount: cold,
      total: src.length,
    };
  }, [filtered, industryItems, colorMode]);

  const topHot = useMemo(() => {
    const score = (c: typeof itemsScored[number]) => (colorMode === "heat" ? c.heat : c.triple);
    return [...filtered].sort((a, b) => score(b) - score(a)).slice(0, 8);
  }, [filtered, colorMode]);
  const topCold = useMemo(() => {
    const score = (c: typeof itemsScored[number]) => (colorMode === "heat" ? c.heat : c.triple);
    return [...filtered].sort((a, b) => score(a) - score(b)).slice(0, 6);
  }, [filtered, colorMode]);

  const currentInd = INDUSTRIES.find((x) => x.id === industry) ?? INDUSTRIES[0];

  return (
    <>
      {/* ===== 顶部 Industry Header（动态标题 + Tab 切换） ===== */}
      <header className="mb-6 border-b border-zinc-200 pb-6">
        <div className="mb-4 flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
              {currentInd.emoji} {currentInd.name} · 脉冲热力图
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {currentInd.desc} · {industryItems.length} 个标的 · 粒子尺寸 = 市值 · 颜色 = 热度 / 三方综合
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono">
            {generatedAtLabel ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded bg-emerald-50 text-emerald-700 px-2.5 py-1 border border-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  LIVE {liveCount}/{items.length}
                </span>
                <span className="text-zinc-400">· 更新于 {generatedAtLabel}</span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded bg-amber-50 text-amber-700 px-2.5 py-1 border border-amber-200">
                MOCK 数据 · 跑 npm run fetch-pulse 接入真实
              </span>
            )}
          </div>
        </div>

        {/* Industry Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {INDUSTRIES.map((ind) => {
            const active = industry === ind.id;
            const isPrimary = ind.id === "AI";
            const count = industryCounts[ind.id] ?? 0;
            return (
              <button
                key={ind.id}
                onClick={() => setIndustry(ind.id)}
                className={`flex items-baseline gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition ${
                  active
                    ? "bg-zinc-900 text-white shadow-sm"
                    : isPrimary
                    ? "bg-violet-50 text-violet-700 hover:bg-violet-100 ring-1 ring-violet-200"
                    : "bg-white text-zinc-700 hover:bg-zinc-50 ring-1 ring-zinc-200"
                }`}
                title={ind.desc}
              >
                <span>
                  {ind.emoji} {ind.name}
                </span>
                <span
                  className={`font-mono text-[10px] tabular-nums ${
                    active ? "opacity-70" : "text-zinc-400"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="grid grid-cols-12 gap-5">
      {/* ===== 左侧：过滤 + 排行 ===== */}
      <aside className="col-span-12 lg:col-span-3 space-y-4">
        {/* 全市场情绪 */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-xs uppercase tracking-wider text-zinc-400 font-mono">
              Market {colorMode === "heat" ? "Pulse" : "Quality"}
            </div>
            <div className="text-[10px] font-mono text-zinc-400">
              {colorMode === "heat" ? "短期热度" : "三方综合"}
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold tabular-nums" style={{color: scoreHex(pulse.avgHeat, colorMode)}}>
              {pulse.avgHeat}
            </span>
            <span className="text-sm text-zinc-500">/ 100</span>
          </div>
          <div className="mt-1 text-sm font-medium" style={{color: scoreHex(pulse.avgHeat, colorMode)}}>
            {pulse.band.label}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-xl font-semibold text-red-600 tabular-nums">{pulse.hotCount}</div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">
                {colorMode === "heat" ? "过热" : "顶级"}
              </div>
            </div>
            <div>
              <div className="text-xl font-semibold text-zinc-800 tabular-nums">{pulse.total}</div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">总数</div>
            </div>
            <div>
              <div className="text-xl font-semibold text-blue-600 tabular-nums">{pulse.coldCount}</div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">
                {colorMode === "heat" ? "深价值" : "基本面差"}
              </div>
            </div>
          </div>
        </div>

        {/* 地域筛选 */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="text-xs uppercase tracking-wider text-zinc-400 font-mono mb-3">
            Region
          </div>
          <div className="flex flex-wrap gap-1.5">
            {REGIONS.map((r) => (
              <button
                key={r.id}
                onClick={() => setRegion(r.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  region === r.id
                    ? "bg-zinc-900 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* 热度阈值 */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="text-xs uppercase tracking-wider text-zinc-400 font-mono mb-3">
            Heat Filter
          </div>
          <div className="flex flex-col gap-1.5">
            {HEAT_TIERS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTier(t.id)}
                className={`text-left px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  tier === t.id
                    ? "bg-zinc-900 text-white"
                    : "bg-zinc-50 text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* 层级聚焦 */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="text-xs uppercase tracking-wider text-zinc-400 font-mono mb-3">
            Layer Focus
          </div>
          <div className="flex flex-col gap-1">
            <button
              onClick={() => setHighlightLayer(null)}
              className={`text-left px-2.5 py-1.5 rounded-md text-xs transition ${
                !highlightLayer ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              全部 {activeLayers.length} 层
            </button>
            {activeLayers.map((L) => (
              <button
                key={L.id}
                onClick={() => setHighlightLayer(L.id === highlightLayer ? null : (L.id as LayerId))}
                className={`text-left px-2.5 py-1.5 rounded-md text-xs transition ${
                  highlightLayer === L.id
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                <span className="font-mono text-[10px] text-zinc-400 mr-1.5">{L.id}</span>
                {L.name}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* ===== 中间：粒子场 + 排行 ===== */}
      <section className="col-span-12 lg:col-span-6 space-y-4">
        {/* 染色 mode 切换 + 色阶条 */}
        <div className="bg-white border border-zinc-200 rounded-xl px-3 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-100">
              <button
                onClick={() => setColorMode("heat")}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  colorMode === "heat" ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                🔥 短期热度
              </button>
              <button
                onClick={() => setColorMode("triple")}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  colorMode === "triple" ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                💎 三方综合
              </button>
            </div>
            <div className="text-[10px] font-mono text-zinc-400">
              {colorMode === "heat" ? "短期 价格 + 动量 + RSI + 情绪" : "基本面 + 估值 + 护城河 综合"}
            </div>
          </div>
          <ColorScale mode={colorMode} />
        </div>

        <PulseField
          items={filtered}
          edges={activeEdges}
          marketAvg={pulse.avgHeat}
          colorMode={colorMode}
          onSelect={setSelected}
          selectedId={selected?.id ?? null}
          highlightLayer={highlightLayer}
          layers={activeLayers}
        />

        {/* 排行榜 */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-sm font-semibold text-zinc-900">
                {colorMode === "heat" ? "🔥 最热 TOP 8" : "💎 最优质 TOP 8"}
              </h3>
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                {colorMode === "heat" ? "Overheat" : "Best Quality"}
              </span>
            </div>
            <div className="space-y-1">
              {topHot.map((c, i) => {
                const v = colorMode === "heat" ? c.heat : c.triple;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md hover:bg-zinc-50 transition"
                  >
                    <span className="font-mono text-[10px] text-zinc-400 w-4">{i + 1}</span>
                    <span className="font-mono text-xs font-semibold text-zinc-800 w-14 truncate">{c.ticker}</span>
                    <span className="text-xs text-zinc-600 flex-1 truncate">{c.name}</span>
                    <span className="font-mono text-xs font-semibold tabular-nums" style={{color: scoreHex(v, colorMode)}}>
                      {v}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-sm font-semibold text-zinc-900">
                {colorMode === "heat" ? "❄️ 最冷 TOP 6" : "⚠️ 最差 TOP 6"}
              </h3>
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                {colorMode === "heat" ? "Deep Value" : "Worst Quality"}
              </span>
            </div>
            <div className="space-y-1">
              {topCold.map((c, i) => {
                const v = colorMode === "heat" ? c.heat : c.triple;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md hover:bg-zinc-50 transition"
                  >
                    <span className="font-mono text-[10px] text-zinc-400 w-4">{i + 1}</span>
                    <span className="font-mono text-xs font-semibold text-zinc-800 w-14 truncate">{c.ticker}</span>
                    <span className="text-xs text-zinc-600 flex-1 truncate">{c.name}</span>
                    <span className="font-mono text-xs font-semibold tabular-nums" style={{color: scoreHex(v, colorMode)}}>
                      {v}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ===== 右侧：选中详情 ===== */}
      <aside className="col-span-12 lg:col-span-3">
        {selected ? (
          <DetailPanel
            c={selected}
            allItems={itemsScored}
            edges={SUPPLY_EDGES}
            colorMode={colorMode}
            onSelect={setSelected}
            trend={trends[selected.ticker] || []}
          />
        ) : (
          <EmptyHint />
        )}
      </aside>
      </div>
    </>
  );
}

// ---- 详情面板 ----
interface ScoredItem extends CompanyWithHeat { triple: number }
function DetailPanel({
  c,
  allItems,
  edges,
  colorMode,
  onSelect,
  trend,
}: {
  c: CompanyWithHeat;
  allItems: ScoredItem[];
  edges: typeof SUPPLY_EDGES;
  colorMode: "heat" | "triple";
  onSelect: (c: CompanyWithHeat) => void;
  trend: TrendPt[];
}) {
  // c.layer 可能是 AI 的 L0-L7 或某个 industry 的（如 RM-D / DF-M）— 用宽容 lookup
  const layer = useMemo(() => {
    const allLayers: { id: string; name: string }[] = [
      ...LAYERS,
      ...(getLayersFor("rare-metals") ?? []),
      ...(getLayersFor("humanoid") ?? []),
      ...(getLayersFor("defense") ?? []),
      ...(getLayersFor("biotech") ?? []),
    ];
    return allLayers.find((L) => L.id === c.layer) ?? { id: c.layer, name: "—" };
  }, [c.layer]);
  const ts = useMemo(() => tripleScore(c), [c]);
  const [tab, setTab] = useState<"heat" | "triple">("heat");

  // 上下游标的（从 SUPPLY_EDGES 反查）
  const { upstream, downstream } = useMemo(() => {
    const byTicker = new Map(allItems.map((x) => [x.ticker, x]));
    const ups: ScoredItem[] = [];
    const downs: ScoredItem[] = [];
    for (const e of edges) {
      if (e.to === c.ticker) {
        const u = byTicker.get(e.from);
        if (u && !ups.find((x) => x.ticker === u.ticker)) ups.push(u);
      }
      if (e.from === c.ticker) {
        const d = byTicker.get(e.to);
        if (d && !downs.find((x) => x.ticker === d.ticker)) downs.push(d);
      }
    }
    return { upstream: ups, downstream: downs };
  }, [c.ticker, allItems, edges]);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 sticky top-6">
      {/* 公司头 */}
      <div className="flex items-baseline justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="font-mono text-xs text-zinc-400">
              {layer.id} · {layer.name} · {c.segment}
            </span>
          </div>
          <h3 className="text-2xl font-semibold tracking-tight text-zinc-900">{c.name}</h3>
          <div className="mt-1 flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-zinc-700">{c.ticker}</span>
            <span className="text-xs text-zinc-500">{c.region}</span>
            <span className="text-xs text-zinc-400">·</span>
            <span className="text-xs text-zinc-500">${c.marketCapB}B</span>
            {c.dataSource === "live" ? (
              <span className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                LIVE
              </span>
            ) : (
              <span className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                MOCK
              </span>
            )}
          </div>
          {c.dataSource === "live" && c.livePrice && (
            <div className="mt-1.5 font-mono text-[10px] text-zinc-400">
              {c.livePrice.toFixed(2)} · 收于 {c.liveBar}
            </div>
          )}
        </div>
      </div>

      {/* Tab 切换器 */}
      <div className="mt-5 grid grid-cols-2 gap-1 p-1 rounded-lg bg-zinc-100">
        <button
          onClick={() => setTab("heat")}
          className={`flex flex-col items-start px-3 py-2 rounded-md transition ${
            tab === "heat" ? "bg-white shadow-sm" : "hover:bg-white/50"
          }`}
        >
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            短期热度
          </span>
          <span className="flex items-baseline gap-1 mt-0.5">
            <span className="text-xl font-semibold tabular-nums" style={{ color: heatHex(c.heat) }}>
              {c.heat}
            </span>
            <span className="text-[10px] text-zinc-400 font-mono">heat</span>
          </span>
        </button>
        <button
          onClick={() => setTab("triple")}
          className={`flex flex-col items-start px-3 py-2 rounded-md transition ${
            tab === "triple" ? "bg-white shadow-sm" : "hover:bg-white/50"
          }`}
        >
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            三方综合
          </span>
          <span className="flex items-baseline gap-1 mt-0.5">
            <span className="text-xl font-semibold tabular-nums" style={{ color: scoreColor(ts.average) }}>
              {ts.average}
            </span>
            <span className="text-[10px] text-zinc-400 font-mono">avg · ±{ts.spread}</span>
          </span>
        </button>
      </div>

      {/* 30 日趋势 sparkline */}
      {trend.length >= 5 && (
        <SparklineBlock trend={trend} mode={tab} />
      )}

      {/* Tab 内容 */}
      <div className="mt-4">
        {tab === "heat" ? <HeatView c={c} /> : <TripleView c={c} ts={ts} />}
      </div>

      {/* 基本面数据 */}
      <FundamentalsBlock c={c} />

      {/* 上下游产业链 */}
      {(upstream.length > 0 || downstream.length > 0) && (
        <UpDownStreamBlock
          upstream={upstream}
          downstream={downstream}
          colorMode={colorMode}
          onSelect={onSelect}
        />
      )}

      {/* BG 判读 */}
      <div className="mt-5 pt-4 border-t border-zinc-100">
        <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-2">
          BG DNA 判读
        </div>
        <p className="text-xs text-zinc-600 leading-relaxed">{bgVerdict(c)}</p>
      </div>
    </div>
  );
}

// ---- 30 日趋势 sparkline ----
function SparklineBlock({ trend, mode }: { trend: TrendPt[]; mode: "heat" | "triple" }) {
  // mode "heat" 显示 price + heat 双线；"triple" 只显示 price（triple 时序还没存）
  const W = 280;
  const H = 56;
  const pad = 4;

  // 用 close 画主线，heat 画次线
  const closes = trend.map((t) => t.close).filter((v): v is number => v != null);
  const heats = trend.map((t) => t.heat).filter((v): v is number => v != null);

  const priceFirst = closes[0] ?? null;
  const priceLast = closes[closes.length - 1] ?? null;
  const priceChange = priceFirst && priceLast ? ((priceLast - priceFirst) / priceFirst) * 100 : null;

  const linePath = (vals: number[]): string => {
    if (vals.length < 2) return "";
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const stepX = (W - pad * 2) / (vals.length - 1);
    return vals
      .map((v, i) => {
        const x = pad + i * stepX;
        const y = H - pad - ((v - min) / range) * (H - pad * 2);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };

  return (
    <div className="mt-4 rounded-md bg-zinc-50 border border-zinc-100 px-3 pt-2.5 pb-2">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
          过去 {trend.length} 日趋势
        </span>
        {priceChange != null && (
          <span className={`text-[11px] font-mono tabular-nums font-semibold ${
            priceChange >= 0 ? "text-emerald-600" : "text-red-600"
          }`}>
            {priceChange >= 0 ? "+" : ""}{priceChange.toFixed(1)}%
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="overflow-visible">
        {/* 0 线 */}
        <line x1={pad} y1={H / 2} x2={W - pad} y2={H / 2} stroke="#E4E4E7" strokeWidth="0.5" strokeDasharray="2,2" />
        {/* 价格主线 */}
        {closes.length >= 2 && (
          <>
            <path d={linePath(closes)} fill="none" stroke="#165DFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            {/* 起止点 */}
            <circle cx={pad} cy={H - pad - ((closes[0] - Math.min(...closes)) / (Math.max(...closes) - Math.min(...closes) || 1)) * (H - pad * 2)} r="2" fill="#165DFF" />
            <circle cx={W - pad} cy={H - pad - ((closes[closes.length-1] - Math.min(...closes)) / (Math.max(...closes) - Math.min(...closes) || 1)) * (H - pad * 2)} r="2.5" fill="#165DFF" />
          </>
        )}
        {/* heat 次线 - 只在 heat 模式显示 */}
        {mode === "heat" && heats.length >= 2 && (
          <path d={linePath(heats)} fill="none" stroke="#F59E0B" strokeWidth="1" strokeDasharray="3,2" opacity="0.7" />
        )}
      </svg>
      <div className="flex items-center justify-between text-[9px] font-mono text-zinc-400 mt-0.5">
        <span>{trend[0]?.date.slice(5)}</span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="w-3 h-px bg-[#165DFF]" />价格</span>
          {mode === "heat" && heats.length >= 2 && (
            <span className="flex items-center gap-1"><span className="w-3 h-px bg-[#F59E0B] border-dashed" />heat</span>
          )}
        </div>
        <span>{trend[trend.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

// ---- 基本面数据块 ----
function FundamentalsBlock({ c }: { c: CompanyWithHeat }) {
  const f = c.fundamentals;
  if (!f) return null;

  const fmt = (v: number | undefined, suffix: string = "", digits: number = 1): string => {
    if (v == null || !Number.isFinite(v)) return "—";
    return `${v.toFixed(digits)}${suffix}`;
  };
  const pct = (v: number | undefined, digits: number = 0): string => {
    if (v == null || !Number.isFinite(v)) return "—";
    return `${(v * 100).toFixed(digits)}%`;
  };

  // value color: 好的绿 / 差的红 / 中性灰
  const peCol = (pe?: number) => !pe || pe < 0 ? "text-zinc-400" : pe < 20 ? "text-emerald-600" : pe < 40 ? "text-zinc-700" : pe < 80 ? "text-amber-600" : "text-red-600";
  const roeCol = (roe?: number) => !roe ? "text-zinc-400" : roe < 0.05 ? "text-red-600" : roe < 0.15 ? "text-amber-600" : roe < 0.30 ? "text-zinc-700" : "text-emerald-600";
  const growthCol = (g?: number) => !g ? "text-zinc-400" : g < 0 ? "text-red-600" : g < 0.10 ? "text-zinc-500" : g < 0.30 ? "text-zinc-700" : "text-emerald-600";

  return (
    <div className="mt-5 pt-4 border-t border-zinc-100">
      <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-2">
        Fundamentals · 基本面
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <FundRow label="trail PE"    value={fmt(f.trailingPE, "x")} valueColor={peCol(f.trailingPE)} />
        <FundRow label="fwd PE"      value={fmt(f.forwardPE, "x")}  valueColor={peCol(f.forwardPE)} />
        <FundRow label="P/B"         value={fmt(f.priceToBook, "x")} />
        <FundRow label="P/S"         value={fmt(f.priceToSales, "x")} />
        <FundRow label="ROE"         value={pct(f.roe, 1)}        valueColor={roeCol(f.roe)} />
        <FundRow label="净利率"      value={pct(f.profitMargin)} />
        <FundRow label="毛利率"      value={pct(f.grossMargin)} />
        <FundRow label="FCF margin"  value={pct(f.fcfMargin)} />
        <FundRow label="营收增速"    value={pct(f.revenueGrowth)} valueColor={growthCol(f.revenueGrowth)} />
        <FundRow label="盈利增速"    value={pct(f.earningsGrowth)} valueColor={growthCol(f.earningsGrowth)} />
        <FundRow label="D/E"         value={fmt(f.debtToEquity, "", 0)} />
        <FundRow label="股息率"      value={pct(f.dividendYield, 2)} />
      </div>
    </div>
  );
}

function FundRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-zinc-50 pb-1">
      <span className="text-[10px] font-mono text-zinc-400">{label}</span>
      <span className={`text-[11px] font-mono tabular-nums font-medium ${valueColor || "text-zinc-700"}`}>{value}</span>
    </div>
  );
}

// ---- 上下游产业链 ----
function UpDownStreamBlock({
  upstream,
  downstream,
  colorMode,
  onSelect,
}: {
  upstream: ScoredItem[];
  downstream: ScoredItem[];
  colorMode: "heat" | "triple";
  onSelect: (c: CompanyWithHeat) => void;
}) {
  return (
    <div className="mt-5 pt-4 border-t border-zinc-100">
      <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-2.5">
        产业链 · Supply Chain
      </div>
      {upstream.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] font-mono text-zinc-500 mb-1 flex items-center gap-1.5">
            <span>↑ 上游</span>
            <span className="text-zinc-400">{upstream.length}</span>
          </div>
          <div className="space-y-0.5">
            {upstream.map((u) => <ChainRow key={u.ticker} c={u} mode={colorMode} onClick={onSelect} />)}
          </div>
        </div>
      )}
      {downstream.length > 0 && (
        <div>
          <div className="text-[10px] font-mono text-zinc-500 mb-1 flex items-center gap-1.5">
            <span>↓ 下游</span>
            <span className="text-zinc-400">{downstream.length}</span>
          </div>
          <div className="space-y-0.5">
            {downstream.map((d) => <ChainRow key={d.ticker} c={d} mode={colorMode} onClick={onSelect} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ChainRow({ c, mode, onClick }: { c: ScoredItem; mode: "heat" | "triple"; onClick: (c: CompanyWithHeat) => void }) {
  const v = mode === "heat" ? c.heat : c.triple;
  return (
    <button
      onClick={() => onClick(c)}
      className="w-full flex items-center gap-2 text-left px-2 py-1 rounded hover:bg-zinc-50 transition"
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: scoreHex(v, mode) }}
      />
      <span className="font-mono text-[10px] font-semibold text-zinc-700 w-12 shrink-0 truncate">{c.ticker}</span>
      <span className="text-[11px] text-zinc-600 flex-1 truncate">{c.name}</span>
      <span className="font-mono text-[10px] font-semibold tabular-nums" style={{ color: scoreHex(v, mode) }}>
        {v}
      </span>
    </button>
  );
}

// ---- Heat 视图：大数 + 4 metrics + MOAT ----
function HeatView({ c }: { c: CompanyWithHeat }) {
  const band = heatBand(c.heat);
  return (
    <div>
      <div className="py-3 border-y border-zinc-100">
        <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
          Heat Score · 短期热度（价格 + 动量 + RSI + 情绪）
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-5xl font-semibold tabular-nums" style={{ color: heatHex(c.heat) }}>
            {c.heat}
          </span>
          <span className="text-sm font-medium" style={{ color: heatHex(c.heat) }}>
            {band.label}
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <Metric label="估值分位" value={c.valuationPct} weight="40%" />
        <Metric label="20D 动量" value={c.momentum20d} weight="30%" />
        <Metric label="RSI"      value={c.rsi}         weight="20%" />
        <Metric label="情绪面"   value={c.sentiment}   weight="10%" />
      </div>

      <div className="mt-5 pt-4 border-t border-zinc-100">
        <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1.5">
          Moat · 护城河
        </div>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-sm ${i <= c.moat ? "bg-zinc-900" : "bg-zinc-100"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Triple 视图：综合分 / 共识 / 雷达 / 三方分 / verdict ----
function TripleView({ c, ts }: { c: CompanyWithHeat; ts: TripleScore }) {
  return (
    <div>
      {/* 平均分 + 共识分 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md bg-zinc-50 px-3 py-2">
          <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">平均分</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums" style={{ color: scoreColor(ts.average) }}>{ts.average}</span>
            <span className="text-[10px] text-zinc-400">/100</span>
          </div>
        </div>
        <div className="rounded-md bg-zinc-50 px-3 py-2">
          <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">共识分 (min)</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums" style={{ color: scoreColor(ts.consensus) }}>{ts.consensus}</span>
            <span className="text-[10px] text-zinc-400">分歧 ±{ts.spread}</span>
          </div>
        </div>
      </div>

      <RadarChart ts={ts} />

      <div className="space-y-2.5 mt-4">
        <PerspectiveRow name="段永平"   tag="DUAN"    score={ts.duan}    color="#7C3AED" />
        <PerspectiveRow name="巴菲特"   tag="BUFFETT" score={ts.buffett} color="#0891B2" />
        <PerspectiveRow name="Serenity" tag="SERE"    score={ts.serenity} color="#EA580C" />
      </div>

      <div className="mt-3 rounded-md bg-zinc-900 text-zinc-100 px-3 py-2 text-xs leading-relaxed">
        {ts.verdict}
      </div>

      {/* 未选中标的的小提示，避免完全没文字 */}
      <div className="mt-2 text-[10px] font-mono text-zinc-400 italic">
        ℹ 这是基本面 + 估值 + 护城河综合，不含短期价格热度
      </div>
    </div>
  );
}

function PerspectiveRow({ name, tag, score, color }: { name: string; tag: string; score: PerspectiveScore; color: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 text-left"
      >
        <span className="font-mono text-[9px] font-semibold text-white px-1.5 py-0.5 rounded" style={{background: color}}>
          {tag}
        </span>
        <span className="text-xs font-medium text-zinc-700 w-12">{name}</span>
        <div className="flex-1 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
          <div className="h-full rounded-full" style={{width: `${score.total}%`, background: color}} />
        </div>
        <span className="font-mono text-xs font-semibold tabular-nums w-6 text-right" style={{color: scoreColor(score.total)}}>{score.total}</span>
        <span className="text-zinc-300 text-xs">{open ? "−" : "+"}</span>
      </button>
      <div className="ml-12 mt-0.5 text-[11px] text-zinc-500 italic">{score.oneLiner}</div>
      {open && (
        <div className="ml-12 mt-2 space-y-1">
          {score.dims.map((d) => (
            <div key={d.key} className="flex items-baseline gap-2 text-[11px]">
              <span className="font-mono text-zinc-400 w-24 shrink-0 truncate">{d.label}</span>
              <span className="font-mono tabular-nums text-zinc-700 w-6 text-right">{d.score}</span>
              <span className="text-zinc-500 italic flex-1">{d.reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RadarChart({ ts }: { ts: TripleScore }) {
  // 用 3 个轴：段 / 巴 / Serenity 的 total
  const size = 160;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 18;
  const angles = [-Math.PI / 2, -Math.PI / 2 + (Math.PI * 2) / 3, -Math.PI / 2 + (Math.PI * 4) / 3];
  const points = [ts.duan.total, ts.buffett.total, ts.serenity.total].map((v, i) => {
    const r = (v / 100) * R;
    return { x: cx + r * Math.cos(angles[i]), y: cy + r * Math.sin(angles[i]) };
  });
  const axisEnds = angles.map(a => ({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }));
  const labelOffsets = angles.map(a => ({ x: cx + (R + 12) * Math.cos(a), y: cy + (R + 12) * Math.sin(a) }));
  const labels = ["段", "巴", "Sere"];
  const colors = ["#7C3AED", "#0891B2", "#EA580C"];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto block">
      {/* 网格：25/50/75/100 */}
      {[0.25, 0.5, 0.75, 1].map((k) => {
        const pts = angles.map(a => `${cx + R * k * Math.cos(a)},${cy + R * k * Math.sin(a)}`).join(" ");
        return <polygon key={k} points={pts} fill="none" stroke="#E5E5E5" strokeWidth="0.5" />;
      })}
      {/* 轴 */}
      {axisEnds.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#D4D4D8" strokeWidth="0.5" />
      ))}
      {/* 数据三角 */}
      <polygon
        points={points.map(p => `${p.x},${p.y}`).join(" ")}
        fill="rgba(22, 93, 255, 0.15)"
        stroke="#165DFF"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* 顶点 */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={colors[i]} />
      ))}
      {/* 标签 */}
      {labelOffsets.map((p, i) => (
        <text key={i} x={p.x} y={p.y} fontSize={10} fontWeight={600} fill={colors[i]} textAnchor="middle" dominantBaseline="middle">
          {labels[i]}
        </text>
      ))}
    </svg>
  );
}

function scoreColor(s: number): string {
  if (s >= 70) return "#059669"; // 绿
  if (s >= 55) return "#165DFF"; // 蓝
  if (s >= 40) return "#D97706"; // 琥珀
  return "#DC2626";              // 红
}

function Metric({ label, value, weight }: { label: string; value: number; weight: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs text-zinc-600">{label}</span>
        <span className="flex items-baseline gap-1.5">
          <span className="font-mono text-xs font-semibold tabular-nums" style={{color: heatHex(value)}}>{value}</span>
          <span className="text-[10px] text-zinc-400 font-mono">{weight}</span>
        </span>
      </div>
      <div className="h-1 rounded-full bg-zinc-100 overflow-hidden">
        <div className="h-full rounded-full" style={{width:`${value}%`, background: heatHex(value)}} />
      </div>
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center sticky top-6">
      <div className="text-sm text-zinc-700 font-medium mb-2">悬停或点击粒子</div>
      <p className="text-xs text-zinc-500 leading-relaxed">
        每个粒子的尺寸 = 市值 log<br/>
        脉冲频率 = 短期涨速<br/>
        颜色 = 综合热度
      </p>
    </div>
  );
}

// ---- 工具 · 8 档 heat 色阶 + 7 档 triple 反向色阶 ----
const HEX_STOPS = [
  { p: 0.00, h: 252, s: 55, l: 22 }, // 死气深紫黑
  { p: 0.12, h: 246, s: 70, l: 30 },
  { p: 0.28, h: 218, s: 82, l: 42 },
  { p: 0.42, h: 178, s: 75, l: 38 },
  { p: 0.56, h: 145, s: 72, l: 40 },
  { p: 0.70, h:  68, s: 88, l: 42 },
  { p: 0.82, h:  35, s: 95, l: 45 },
  { p: 0.92, h:  12, s: 95, l: 46 },
  { p: 1.00, h: 340, s: 92, l: 50 },
];
// triple 色阶：低=红警（基本面差），高=金/绿（顶级好资产）
const TRIPLE_HEX_STOPS = [
  { p: 0.00, h: 358, s: 88, l: 45 },
  { p: 0.20, h:  18, s: 92, l: 48 },
  { p: 0.40, h:  42, s: 92, l: 48 },
  { p: 0.55, h: 200, s: 65, l: 42 },
  { p: 0.70, h: 160, s: 70, l: 38 },
  { p: 0.85, h: 145, s: 78, l: 36 },
  { p: 1.00, h: 165, s: 90, l: 40 },
];
function hex(stops: typeof HEX_STOPS, score: number): string {
  const t = Math.max(0, Math.min(100, score)) / 100;
  let i = 0;
  while (i < stops.length - 1 && stops[i + 1].p < t) i++;
  const a = stops[i];
  const b = stops[Math.min(i + 1, stops.length - 1)];
  const span = (b.p - a.p) || 1;
  const k = (t - a.p) / span;
  let dh = b.h - a.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const h = (a.h + dh * k + 360) % 360;
  const s = a.s + (b.s - a.s) * k;
  const l = a.l + (b.l - a.l) * k;
  return `hsl(${h.toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`;
}
function heatHex(heat: number): string { return hex(HEX_STOPS, heat); }
function tripleHex(score: number): string { return hex(TRIPLE_HEX_STOPS, score); }
function scoreHex(score: number, mode: "heat" | "triple"): string {
  return mode === "heat" ? heatHex(score) : tripleHex(score);
}

// ---- 色阶条（颜色 legend）----
function ColorScale({ mode }: { mode: "heat" | "triple" }) {
  // 用 25 个采样点画 CSS 渐变（足够平滑）
  const stops = Array.from({ length: 25 }, (_, i) => {
    const v = (i / 24) * 100;
    return `${scoreHex(v, mode)} ${(i / 24) * 100}%`;
  }).join(", ");
  const gradient = `linear-gradient(to right, ${stops})`;

  const ticks = mode === "heat"
    ? [
        { v: 0,   label: "深价值",   color: "#3F1A8C" },
        { v: 30,  label: "偏冷",     color: "#1E5BCC" },
        { v: 50,  label: "中性",     color: "#1A8E72" },
        { v: 70,  label: "合理",     color: "#A6A828" },
        { v: 85,  label: "偏热",     color: "#DC4914" },
        { v: 100, label: "过热警告", color: "#C4126B" },
      ]
    : [
        { v: 0,   label: "基本面差", color: "#D11E2C" },
        { v: 30,  label: "弱",       color: "#E16C1C" },
        { v: 55,  label: "合理",     color: "#3B82B8" },
        { v: 75,  label: "好",       color: "#1B8964" },
        { v: 100, label: "顶级",     color: "#0D8C76" },
      ];

  return (
    <div className="relative">
      {/* 渐变条 */}
      <div
        className="h-2 w-full rounded-full ring-1 ring-zinc-900/5"
        style={{ background: gradient }}
      />
      {/* 刻度 + 语义 */}
      <div className="relative mt-1.5 h-7">
        {ticks.map((t) => (
          <div
            key={t.v}
            className="absolute -translate-x-1/2 flex flex-col items-center"
            style={{ left: `${t.v}%` }}
          >
            <div className="w-px h-1.5 bg-zinc-300 -mt-2" />
            <span className="font-mono text-[9px] text-zinc-500 mt-0.5">{t.v}</span>
            <span
              className="text-[9px] font-medium mt-0.5 whitespace-nowrap"
              style={{ color: t.color }}
            >
              {t.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function bgVerdict(c: CompanyWithHeat): string {
  const band = heatBand(c.heat);
  const moatTxt = c.moat >= 4 ? "强护城河" : c.moat === 3 ? "护城河一般" : "弱护城河";
  if (band.tone === "hot") {
    return `${moatTxt}，但当前估值/动量已在历史高位。段永平视角：好生意不代表好价格，列入观察、等回调而非追涨。`;
  }
  if (band.tone === "warm") {
    return `${moatTxt}，估值偏热但未到极端。可分批跟踪，警惕进一步追高。`;
  }
  if (band.tone === "fair") {
    return `${moatTxt}，估值与基本面相对匹配。如属看得懂的生意，是建仓 / 加仓的合理区间。`;
  }
  if (band.tone === "cool") {
    return `${moatTxt}，市场情绪偏冷。如基本面未恶化，是逆向布局窗口。`;
  }
  return `${moatTxt}，深度价值区。需要核实是低估还是基本面 deteriorating——警惕价值陷阱。`;
}
