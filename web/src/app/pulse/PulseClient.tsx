"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
import { MASTERS } from "@/lib/masters";

// ===== 镜头注册表:热度 + 综合 + 5 位大师(masters.ts) + 分歧 =====
type LensMeta = { key: string; label: string; sub: string; ramp: "heat" | "triple"; hi: string; lo: string };
const LENSES: LensMeta[] = [
  { key: "heat", label: "过热度", sub: "估值贵 + 离52周高点 + RSI/动量 · 越高越泡沫(不随当天涨跌跳)", ramp: "heat", hi: "过热/泡沫", lo: "便宜/破位" },
  { key: "triple", label: "综合", sub: "已判读各方真实评分均值(A股 = Serenity 瓶颈分)", ramp: "triple", hi: "高信念", lo: "回避" },
  ...MASTERS.map((m): LensMeta => ({ key: m.key, label: m.name, sub: m.school, ramp: "triple", hi: "高信念", lo: "看空/回避" })),
  { key: "divergence", label: "分歧", sub: "5 方评分极差 · 越大越撕裂(分歧即信号)", ramp: "heat", hi: "最撕裂", lo: "共识" },
];
const LENS_BY_KEY: Record<string, LensMeta> = Object.fromEntries(LENSES.map((l) => [l.key, l]));

type MastersJoin = { byKey: Record<string, number | null>; div: number };
function toByKey(sum: { sc: (number | null)[]; div: number } | undefined, order: string[]): MastersJoin | undefined {
  if (!sum) return undefined;
  const byKey: Record<string, number | null> = {};
  order.forEach((k, i) => { byKey[k] = sum.sc[i] ?? null; });
  return { byKey, div: sum.div };
}
// 某只票在某镜头下的值(null = 该镜头未覆盖)。综合 = 已判读各方真实评分均值,不再用 mock
function lensValueOf(c: { heat: number; triple: number | null; masters?: MastersJoin }, lens: string): number | null {
  if (lens === "heat") return c.heat;
  if (!c.masters) return null;
  if (lens === "divergence") return c.masters.div;
  if (lens === "triple") {
    const vals = Object.values(c.masters.byKey).filter((v): v is number => v != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }
  return c.masters.byKey[lens] ?? null;
}
function lensRampOf(lens: string): "heat" | "triple" {
  return LENS_BY_KEY[lens]?.ramp ?? "triple";
}

// ===== 产业链(数据驱动,来自 industry-map.json;AI 用 supply-chain 的 L0-L7)=====
type ChainLayerDef = { id: string; name: string; summary?: string };
type ChainDef = { id: string; name: string; desc: string; layers: ChainLayerDef[] };

const REGIONS: { id: Region | "ALL"; label: string }[] = [
 { id: "ALL", label: "全部" },
 { id: "US", label: "美股" },
 { id: "CN", label: "A 股" },
 { id: "HK", label: "港股" },
 { id: "TW", label: "台股" },
 { id: "KR", label: "韩股" },
 { id: "EU", label: "欧" },
 { id: "JP", label: "日" },
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
  panelSummary = {},
  masterOrder = [],
  coveredCount = 0,
  analyzedAtLabel = null,
  priceAgeLabel = null,
  chainIndustries = [],
  chainPlacement = {},
}: {
  items: CompanyWithHeat[];
  trends?: Record<string, TrendPt[]>;
  liveCount?: number;
  generatedAtLabel?: string | null;
  initialIndustry?: string;
  initialHighlight?: string;
  panelSummary?: Record<string, { sc: (number | null)[]; div: number }>;
  masterOrder?: string[];
  coveredCount?: number;
  analyzedAtLabel?: string | null;
  priceAgeLabel?: string | null;
  chainIndustries?: ChainDef[];
  chainPlacement?: Record<string, Record<string, string>>;
}) {
  const [selected, setSelected] = useState<CompanyWithHeat | null>(null);
 const [industry, setIndustry] = useState<string>(initialIndustry ?? "AI");
 const [region, setRegion] = useState<Region | "ALL">("US");
 const [tier, setTier] = useState<string>("all");
  const [highlightLayer, setHighlightLayer] = useState<LayerId | null>(null);
 const [colorMode, setColorMode] = useState<string>("heat");
  // 从详情页跳转过来时高亮的 ticker
  const [highlightTicker, setHighlightTicker] = useState<string | null>(initialHighlight ?? null);
  // 全盘实时报价(/api/market,Nasdaq 快照 60s 缓存)
  const [liveQ, setLiveQ] = useState<Record<string, { price: number | null; pct: number | null }>>({});

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

  // 全盘实时:轮询 /api/market(~60s),拿最新 price/pct
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/market", { cache: "no-store" });
        const j = await r.json();
        if (alive && j.quotes && Object.keys(j.quotes).length) setLiveQ(j.quotes);
      } catch {
        /* 静默 */
      }
    };
    const id = setInterval(poll, 60_000);
    poll();
    return () => { alive = false; clearInterval(id); };
  }, []);

  // 综合 = 已判读各方真实评分均值(null = 未判读 → 粒子灰色),和镜头/详情面板同源 —— 绝不前端现算第二套
  const itemsScored = useMemo(
    () => items.map((c) => {
      const masters = toByKey(panelSummary[c.ticker], masterOrder);
      const vals = masters ? Object.values(masters.byKey).filter((v): v is number => v != null) : [];
      const base = {
        ...c,
        triple: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
        masters,
      };
      // 实时只更新价格/涨跌,不动 heat —— 过热度是慢变量(估值/位置/RSI/动量),不随当天涨跌跳
      const q = liveQ[c.ticker];
      if (q) {
        if (q.price != null) base.livePrice = q.price;
        if (q.pct != null) { base.pct = q.pct; base.dataSource = "live"; }
      }
      return base;
    }),
    [items, panelSummary, masterOrder, liveQ],
  );

  // 产业 tab 定义:AI 用 supply-chain 的 L0-L7;其余链来自 industry-map(数据驱动)
  const industryDefs = useMemo<ChainDef[]>(() => [
    { id: "AI", name: "AI 产业链", desc: "L0 能源 → L7 端侧 · 8 层全景", layers: LAYERS.map((L) => ({ id: L.id, name: L.name })) },
    ...chainIndustries,
  ], [chainIndustries]);

  // 按 industry 取节点:AI = 全部;其余链 = placement 里的票 + 摆到该链的层
  const industryItems = useMemo(() => {
    if (industry === "AI") return itemsScored;
    return itemsScored
      .filter((c) => chainPlacement[c.ticker]?.[industry])
      .map((c) => ({ ...c, layer: chainPlacement[c.ticker][industry] as typeof c.layer }));
  }, [itemsScored, industry, chainPlacement]);

  // 每个 industry 的数量（tab badge）
  const industryCounts = useMemo(() => {
    const out: Record<string, number> = { AI: itemsScored.length };
    for (const def of industryDefs) {
      if (def.id === "AI") continue;
      out[def.id] = itemsScored.filter((c) => chainPlacement[c.ticker]?.[def.id]).length;
    }
    return out;
  }, [itemsScored, industryDefs, chainPlacement]);

  // 当前 industry 的 layers
  const activeLayers = useMemo(() => {
    const def = industryDefs.find((d) => d.id === industry) ?? industryDefs[0];
    return def.layers.map((L) => ({ id: L.id, name: L.name }));
  }, [industry, industryDefs]);

  // 当前 industry 的 edges（仅 AI 有策展上下游连线;数据驱动链暂无）
  const activeEdges = useMemo(() => (industry === "AI" ? SUPPLY_EDGES : []), [industry]);

  const filtered = useMemo(() => {
    const t = HEAT_TIERS.find((x) => x.id === tier)!;
    return industryItems.filter((c) => {
      if (region !== "ALL" && c.region !== region) return false;
      const score = lensValueOf(c, colorMode);
      if (score == null) return tier === "all"; // 未覆盖:默认档显示(灰),选具体档则隐藏
      return score >= t.min && score <= t.max;
    });
  }, [industryItems, region, tier, colorMode]);

  // 当前镜头下"有判读"的可见标的数
  const coveredInView = useMemo(
    () => filtered.filter((c) => lensValueOf(c, colorMode) != null).length,
    [filtered, colorMode],
  );

  const pulse = useMemo(() => {
    const src = filtered.length ? filtered : industryItems;
    if (colorMode === "heat") return marketPulse(src);
    // 其他镜头:用 lens 值,只统计有判读的
    const vals = src.map((x) => lensValueOf(x, colorMode)).filter((v): v is number => v != null);
    const n = vals.length || 1;
    const avg = Math.round(vals.reduce((s, v) => s + v, 0) / n);
    const hot = vals.filter((v) => v >= 70).length;
    const cold = vals.filter((v) => v < 40).length;
    return {
      avgHeat: avg,
 band: { label: avg >= 70 ? "整体优质" : avg >= 50 ? "平均水平" : avg >= 35 ? "整体偏弱" : "整体差", tone: "fair" as const },
      hotCount: hot,
      coldCount: cold,
      total: vals.length,
    };
  }, [filtered, industryItems, colorMode]);

  // 排行:未覆盖排除,按 lens 值排序
  const ranked = useMemo(() => {
    return filtered
      .map((c) => ({ c, v: lensValueOf(c, colorMode) }))
      .filter((x): x is { c: typeof x.c; v: number } => x.v != null)
      .sort((a, b) => b.v - a.v);
  }, [filtered, colorMode]);
  const topHot = useMemo(() => ranked.slice(0, 8).map((x) => x.c), [ranked]);
  const topCold = useMemo(() => ranked.slice(-6).reverse().map((x) => x.c), [ranked]);

  const currentInd = industryDefs.find((x) => x.id === industry) ?? industryDefs[0];

  return (
    <>
      {/* ===== 顶部 Industry Header（动态标题 + Tab 切换） ===== */}
 <header className="mb-4 sm:mb-6 border-b border-line pb-4 sm:pb-6">
 <div className="mb-3 sm:mb-4 flex items-baseline justify-between flex-wrap gap-2 sm:gap-3">
          <div>
            <div className="kicker mb-2">Pulse Heatmap · Five Lenses</div>
 <h1 className="text-xl sm:text-[34px] font-semibold tracking-tight text-ink">
              {currentInd.name} · 脉冲热力图
            </h1>
 <p className="mt-1.5 text-xs sm:text-sm text-muted">
              {currentInd.desc} · {industryItems.length} 个标的 · 粒子尺寸 = 市值 · 颜色 = 镜头(过热度 / 综合 / 大师 / 分歧)
            </p>
          </div>
 <div className="flex items-center gap-2 text-xs font-mono">
            {coveredCount > 0 ? (
              <>
 <span className="inline-flex items-center gap-1.5 rounded bg-up-soft text-up px-2.5 py-1 border border-up/30">
 <span className="h-1.5 w-1.5 rounded-full bg-up" />
                  判读 {coveredCount}/{items.length}
                </span>
 {analyzedAtLabel && <span className="text-faint">· {analyzedAtLabel}判读</span>}
 {priceAgeLabel && <span className="text-faint/70">· 行情 {priceAgeLabel}</span>}
              </>
            ) : (
 <span className="inline-flex items-center gap-1.5 rounded bg-accent-soft text-accent px-2.5 py-1 border border-accent/30">
                示意数据 · 待接入实时行情
              </span>
            )}
          </div>
        </div>

        {/* Industry Tabs — 手机横滑,桌面换行 */}
 <div className="flex flex-nowrap overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap items-center gap-2">
          {industryDefs.map((ind) => {
            const active = industry === ind.id;
 const isPrimary = ind.id === "AI";
            const count = industryCounts[ind.id] ?? 0;
            return (
              <button
                key={ind.id}
                onClick={() => setIndustry(ind.id)}
                className={`flex shrink-0 items-baseline gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition ${
                  active
 ? "bg-surface-3 text-white "
                    : isPrimary
 ? "bg-surface-2 text-accent hover:bg-surface-2 ring-1 ring-accent/30"
 : "bg-surface text-muted hover:bg-surface-2 ring-1 ring-line"
                }`}
                title={ind.desc}
              >
                <span>
                  {ind.name}
                </span>
                <span
                  className={`font-mono text-[10px] tabular-nums ${
 active ? "opacity-70" : "text-faint"
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
 <div className="rounded-xl border border-line bg-surface p-5">
 <div className="flex items-baseline justify-between mb-2">
 <div className="text-xs uppercase tracking-wider text-faint font-mono">
 Market · {LENS_BY_KEY[colorMode]?.label ?? colorMode} 镜头
            </div>
 <div className="text-[10px] font-mono text-faint">
 {colorMode === "heat" ? "过热度" : colorMode === "triple" ? "综合" : coveredInView + " 已判读"}
            </div>
          </div>
 <div className="flex items-baseline gap-2">
 <span className="text-4xl font-semibold tabular-nums" style={{color: scoreHex(pulse.avgHeat, colorMode)}}>
              {pulse.avgHeat}
            </span>
 <span className="text-sm text-muted">/ 100</span>
          </div>
 <div className="mt-1 text-sm font-medium" style={{color: scoreHex(pulse.avgHeat, colorMode)}}>
            {pulse.band.label}
          </div>
 <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div>
 <div className="text-xl font-semibold text-down tabular-nums">{pulse.hotCount}</div>
 <div className="text-[10px] text-muted uppercase tracking-wider mt-0.5">
 {LENS_BY_KEY[colorMode]?.hi ?? "高"}
              </div>
            </div>
            <div>
 <div className="text-xl font-semibold text-ink tabular-nums">{pulse.total}</div>
 <div className="text-[10px] text-muted uppercase tracking-wider mt-0.5">总数</div>
            </div>
            <div>
 <div className="text-xl font-semibold text-accent tabular-nums">{pulse.coldCount}</div>
 <div className="text-[10px] text-muted uppercase tracking-wider mt-0.5">
 {LENS_BY_KEY[colorMode]?.lo ?? "低"}
              </div>
            </div>
          </div>
        </div>

        {/* 地域筛选 */}
 <div className="rounded-xl border border-line bg-surface p-5">
 <div className="text-xs uppercase tracking-wider text-faint font-mono mb-3">
            Region
          </div>
 <div className="flex flex-wrap gap-1.5">
            {REGIONS.map((r) => (
              <button
                key={r.id}
                onClick={() => setRegion(r.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  region === r.id
 ? "bg-surface-3 text-white"
 : "bg-surface-2 text-muted hover:bg-line"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* 热度阈值 */}
 <div className="rounded-xl border border-line bg-surface p-5">
 <div className="text-xs uppercase tracking-wider text-faint font-mono mb-3">
            Heat Filter
          </div>
 <div className="flex flex-col gap-1.5">
            {HEAT_TIERS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTier(t.id)}
                className={`text-left px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  tier === t.id
 ? "bg-surface-3 text-white"
 : "bg-surface text-muted hover:bg-surface-2"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* 层级聚焦 */}
 <div className="rounded-xl border border-line bg-surface p-5">
 <div className="text-xs uppercase tracking-wider text-faint font-mono mb-3">
            Layer Focus
          </div>
 <div className="flex flex-col gap-1">
            <button
              onClick={() => setHighlightLayer(null)}
              className={`text-left px-2.5 py-1.5 rounded-md text-xs transition ${
 !highlightLayer ? "bg-surface-3 text-white" : "text-muted hover:bg-surface-2"
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
 ? "bg-surface-3 text-white"
 : "text-muted hover:bg-surface-2"
                }`}
              >
 <span className="font-mono text-[10px] text-faint mr-1.5">{L.id}</span>
                {L.name}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* ===== 中间：粒子场 + 排行 ===== */}
 <section className="order-first lg:order-none col-span-12 lg:col-span-6 space-y-4">
        {/* 镜头选择 + 色阶条 */}
        <div className="bg-surface border border-line rounded-xl px-3 py-3 space-y-2">
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-surface-2">
            {LENSES.map((l) => (
              <button
                key={l.key}
                onClick={() => setColorMode(l.key)}
                title={l.sub}
                className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition ${
                  colorMode === l.key ? "bg-surface text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono text-faint truncate">{LENS_BY_KEY[colorMode]?.sub}</span>
            {colorMode !== "heat" && colorMode !== "triple" && (
              <span className="text-[10px] font-mono text-faint shrink-0">{coveredInView}/{filtered.length} 已判读 · 灰=未判读</span>
            )}
          </div>
          <ColorScale lens={colorMode} />
        </div>

        <PulseField
          items={filtered}
          edges={activeEdges}
          marketAvg={pulse.avgHeat}
          colorMode={colorMode}
          lensLabel={LENS_BY_KEY[colorMode]?.label ?? colorMode}
          onSelect={setSelected}
          selectedId={selected?.id ?? null}
          highlightLayer={highlightLayer}
          layers={activeLayers}
        />

        {/* 排行榜 */}
 <div className="grid grid-cols-2 gap-4">
 <div className="rounded-xl border border-line bg-surface p-4">
 <div className="flex items-baseline justify-between mb-3">
 <h3 className="text-sm font-semibold text-ink">
 高分 TOP 8
              </h3>
 <span className="text-[10px] font-mono text-faint uppercase tracking-wider">
 {LENS_BY_KEY[colorMode]?.label ?? colorMode}
              </span>
            </div>
 <div className="space-y-1">
              {topHot.map((c, i) => {
 const v = lensValueOf(c, colorMode) ?? 0;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c)}
 className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md hover:bg-surface-2 transition"
                  >
 <span className="font-mono text-[10px] text-faint w-4">{i + 1}</span>
 <span className="font-mono text-xs font-semibold text-ink w-14 truncate">{c.ticker}</span>
 <span className="text-xs text-muted flex-1 truncate">{c.name}</span>
 <span className="font-mono text-xs font-semibold tabular-nums" style={{color: scoreHex(v, colorMode)}}>
                      {v}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
 <div className="rounded-xl border border-line bg-surface p-4">
 <div className="flex items-baseline justify-between mb-3">
 <h3 className="text-sm font-semibold text-ink">
 低分 TOP 6
              </h3>
 <span className="text-[10px] font-mono text-faint uppercase tracking-wider">
 {LENS_BY_KEY[colorMode]?.label ?? colorMode}
              </span>
            </div>
 <div className="space-y-1">
              {topCold.map((c, i) => {
 const v = lensValueOf(c, colorMode) ?? 0;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c)}
 className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md hover:bg-surface-2 transition"
                  >
 <span className="font-mono text-[10px] text-faint w-4">{i + 1}</span>
 <span className="font-mono text-xs font-semibold text-ink w-14 truncate">{c.ticker}</span>
 <span className="text-xs text-muted flex-1 truncate">{c.name}</span>
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
interface ScoredItem extends CompanyWithHeat { triple: number | null; masters?: MastersJoin }
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
 colorMode: string;
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
  // 用真 AI 五方(每只 item 已带 masters = pulse-scores),不再用 tripleScore 启发式 —— 和镜头/详情页一致
  const masters = useMemo(() => allItems.find((x) => x.ticker === c.ticker)?.masters, [allItems, c.ticker]);
  const aiVals = masters ? Object.values(masters.byKey).filter((v): v is number => v != null) : [];
  const aiAvg = aiVals.length ? Math.round(aiVals.reduce((a, b) => a + b, 0) / aiVals.length) : null;
 const [tab, setTab] = useState<"heat" | "triple">("heat");
  // 选中标的价格变动时闪烁
  const [priceFlash, setPriceFlash] = useState<"" | "up" | "down">("");
  const prevPrice = useRef<number | null>(c.livePrice ?? null);
  useEffect(() => {
    if (c.livePrice == null) return;
    if (prevPrice.current != null && c.livePrice !== prevPrice.current) {
      setPriceFlash(c.livePrice > prevPrice.current ? "up" : "down");
      prevPrice.current = c.livePrice;
      const t = setTimeout(() => setPriceFlash(""), 1100);
      return () => clearTimeout(t);
    }
    prevPrice.current = c.livePrice;
  }, [c.livePrice]);

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
 <div className="rounded-xl border border-line bg-surface p-5 sticky top-6">
      {/* 公司头 */}
 <div className="flex items-baseline justify-between">
 <div className="flex-1">
 <div className="flex items-center gap-1.5 mb-1">
 <span className="font-mono text-xs text-faint">
              {layer.id} · {layer.name} · {c.segment}
            </span>
          </div>
 <h3 className="text-2xl font-semibold tracking-tight text-ink">{c.name}</h3>
 <div className="mt-1 flex items-baseline gap-2 flex-wrap">
 <span className="font-mono text-sm font-semibold text-muted">{c.ticker}</span>
 <span className="text-xs text-muted">{c.region}</span>
 <span className="text-xs text-faint">·</span>
 <span className="text-xs text-muted">${c.marketCapB}B</span>
 {c.dataSource === "live" ? (
 <span className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded bg-up-soft text-up border border-up/30">
                LIVE
              </span>
            ) : (
 <span className="font-mono text-[9px] font-semibold px-1.5 py-0.5 rounded bg-accent-soft text-accent border border-accent/30">
                MOCK
              </span>
            )}
          </div>
 {c.livePrice != null && (
 <div className="mt-1.5 flex items-baseline gap-2 font-mono text-xs">
              <span className={`rounded px-1 font-semibold transition-colors duration-700 ${
                priceFlash === "up" ? "bg-up-soft text-up" : priceFlash === "down" ? "bg-down-soft text-down" : "text-ink"
              }`}>${c.livePrice.toFixed(2)}</span>
              {c.pct != null && (
                <span className={c.pct >= 0 ? "text-up" : "text-down"}>
                  {c.pct >= 0 ? "+" : ""}{c.pct.toFixed(2)}%
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tab 切换器 */}
 <div className="mt-5 grid grid-cols-2 gap-1 p-1 rounded-lg bg-surface-2">
        <button
 onClick={() => setTab("heat")}
          className={`flex flex-col items-start px-3 py-2 rounded-md transition ${
 tab === "heat" ? "bg-surface " : "hover:bg-surface/50"
          }`}
        >
 <span className="text-[10px] font-mono uppercase tracking-wider text-muted">
            过热度
          </span>
 <span className="flex items-baseline gap-1 mt-0.5">
 <span className="text-xl font-semibold tabular-nums" style={{ color: heatHex(c.heat) }}>
              {c.heat}
            </span>
 <span className="text-[10px] text-faint font-mono">heat</span>
          </span>
        </button>
        <button
 onClick={() => setTab("triple")}
          className={`flex flex-col items-start px-3 py-2 rounded-md transition ${
 tab === "triple" ? "bg-surface " : "hover:bg-surface/50"
          }`}
        >
 <span className="text-[10px] font-mono uppercase tracking-wider text-muted">
            五方判读
          </span>
 <span className="flex items-baseline gap-1 mt-0.5">
 <span className="text-xl font-semibold tabular-nums" style={{ color: aiAvg == null ? undefined : scoreColor(aiAvg) }}>
              {aiAvg == null ? "—" : aiAvg}
            </span>
 <span className="text-[10px] text-faint font-mono">{aiAvg == null ? "未判读" : `avg · 分歧 ${masters?.div ?? 0}`}</span>
          </span>
        </button>
      </div>

      {/* 30 日趋势 sparkline */}
      {trend.length >= 5 && (
        <SparklineBlock trend={trend} mode={tab} />
      )}

      {/* Tab 内容 */}
 <div className="mt-4">
 {tab === "heat" ? <HeatView c={c} /> : <MasterAIView masters={masters} ticker={c.ticker} />}
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
 <div className="mt-5 pt-4 border-t border-line">
 <div className="text-[10px] font-mono uppercase tracking-wider text-faint mb-2">
          BG DNA 判读
        </div>
 <p className="text-xs text-muted leading-relaxed">{bgVerdict(c)}</p>
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
 <div className="mt-4 rounded-md bg-surface border border-line px-3 pt-2.5 pb-2">
 <div className="flex items-baseline justify-between mb-1.5">
 <span className="text-[10px] font-mono uppercase tracking-wider text-muted">
          过去 {trend.length} 日趋势
        </span>
        {priceChange != null && (
          <span className={`text-[11px] font-mono tabular-nums font-semibold ${
 priceChange >= 0 ? "text-up" : "text-down"
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
 <div className="flex items-center justify-between text-[9px] font-mono text-faint mt-0.5">
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
 const peCol = (pe?: number) => !pe || pe < 0 ? "text-faint" : pe < 20 ? "text-up" : pe < 40 ? "text-muted" : pe < 80 ? "text-accent" : "text-down";
 const roeCol = (roe?: number) => !roe ? "text-faint" : roe < 0.05 ? "text-down" : roe < 0.15 ? "text-accent" : roe < 0.30 ? "text-muted" : "text-up";
 const growthCol = (g?: number) => !g ? "text-faint" : g < 0 ? "text-down" : g < 0.10 ? "text-muted" : g < 0.30 ? "text-muted" : "text-up";

  return (
 <div className="mt-5 pt-4 border-t border-line">
 <div className="text-[10px] font-mono uppercase tracking-wider text-faint mb-2">
        Fundamentals · 基本面
      </div>
 <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
 <FundRow label="trail PE" value={fmt(f.trailingPE, "x")} valueColor={peCol(f.trailingPE)} />
 <FundRow label="fwd PE" value={fmt(f.forwardPE, "x")}  valueColor={peCol(f.forwardPE)} />
 <FundRow label="P/B" value={fmt(f.priceToBook, "x")} />
 <FundRow label="P/S" value={fmt(f.priceToSales, "x")} />
 <FundRow label="ROE"         value={pct(f.roe, 1)}        valueColor={roeCol(f.roe)} />
 <FundRow label="净利率"      value={pct(f.profitMargin)} />
 <FundRow label="毛利率"      value={pct(f.grossMargin)} />
 <FundRow label="FCF margin"  value={pct(f.fcfMargin)} />
 <FundRow label="营收增速"    value={pct(f.revenueGrowth)} valueColor={growthCol(f.revenueGrowth)} />
 <FundRow label="盈利增速"    value={pct(f.earningsGrowth)} valueColor={growthCol(f.earningsGrowth)} />
 <FundRow label="D/E" value={fmt(f.debtToEquity, "", 0)} />
 <FundRow label="股息率"      value={pct(f.dividendYield, 2)} />
      </div>
    </div>
  );
}

function FundRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
 <div className="flex items-baseline justify-between border-b border-surface pb-1">
 <span className="text-[10px] font-mono text-faint">{label}</span>
 <span className={`text-[11px] font-mono tabular-nums font-medium ${valueColor || "text-muted"}`}>{value}</span>
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
 colorMode: string;
  onSelect: (c: CompanyWithHeat) => void;
}) {
  return (
 <div className="mt-5 pt-4 border-t border-line">
 <div className="text-[10px] font-mono uppercase tracking-wider text-faint mb-2.5">
        产业链 · Supply Chain
      </div>
      {upstream.length > 0 && (
 <div className="mb-3">
 <div className="text-[10px] font-mono text-muted mb-1 flex items-center gap-1.5">
            <span>↑ 上游</span>
 <span className="text-faint">{upstream.length}</span>
          </div>
 <div className="space-y-0.5">
            {upstream.map((u) => <ChainRow key={u.ticker} c={u} mode={colorMode} onClick={onSelect} />)}
          </div>
        </div>
      )}
      {downstream.length > 0 && (
        <div>
 <div className="text-[10px] font-mono text-muted mb-1 flex items-center gap-1.5">
            <span>↓ 下游</span>
 <span className="text-faint">{downstream.length}</span>
          </div>
 <div className="space-y-0.5">
            {downstream.map((d) => <ChainRow key={d.ticker} c={d} mode={colorMode} onClick={onSelect} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ChainRow({ c, mode, onClick }: { c: ScoredItem; mode: string; onClick: (c: CompanyWithHeat) => void }) {
 const v = lensValueOf(c, mode);
 const color = v == null ? "hsl(220, 10%, 46%)" : scoreHex(v, mode);
  return (
    <button
      onClick={() => onClick(c)}
 className="w-full flex items-center gap-2 text-left px-2 py-1 rounded hover:bg-surface-2 transition"
    >
      <span
 className="w-2 h-2 rounded-full shrink-0"
        style={{ background: color }}
      />
 <span className="font-mono text-[10px] font-semibold text-muted w-12 shrink-0 truncate">{c.ticker}</span>
 <span className="text-[11px] text-muted flex-1 truncate">{c.name}</span>
 <span className="font-mono text-[10px] font-semibold tabular-nums" style={{ color }}>
        {v == null ? "—" : v}
      </span>
    </button>
  );
}

// ---- Heat 视图：大数 + 4 metrics + MOAT ----
function HeatView({ c }: { c: CompanyWithHeat }) {
  const band = heatBand(c.heat);
  return (
    <div>
 <div className="py-3 border-y border-line">
 <div className="text-[10px] font-mono uppercase tracking-wider text-faint mb-1">
          过热/泡沫度 · 估值 + 离 52 周高点 + RSI + 动量
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
 <Metric label="离 52 周高点" value={c.pos52} weight="35%" />
 <Metric label="估值贵 (分位)" value={c.valuationPct} weight="30%" />
 <Metric label="RSI" value={c.rsi}            weight="20%" />
 <Metric label="60D 动量" value={c.momentum20d}  weight="15%" />
      </div>

 <div className="mt-5 pt-4 border-t border-line">
 <div className="text-[10px] font-mono uppercase tracking-wider text-faint mb-1.5">
          Moat · 护城河
        </div>
 <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
 className={`h-1.5 flex-1 rounded-sm ${i <= c.moat ? "bg-surface-3" : "bg-surface-2"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- AI 五方判读(真分,来自 pulse-scores,和镜头/详情页同源)----
function MasterAIView({ masters, ticker }: { masters?: MastersJoin; ticker: string }) {
  const has = !!masters && Object.values(masters.byKey).some((v) => v != null);
  return (
    <div>
      {!has ? (
        <p className="text-xs text-muted">这只票还没有 AI 五方判读。</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-surface px-3 py-2">
              <div className="text-[9px] font-mono uppercase tracking-wider text-muted">分歧度</div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-semibold tabular-nums text-ink">{masters!.div}</span>
                <span className="text-[10px] text-faint">越大越撕裂</span>
              </div>
            </div>
            <div className="rounded-md bg-surface px-3 py-2">
              <div className="text-[9px] font-mono uppercase tracking-wider text-muted">五方</div>
              <div className="mt-1 text-[10px] leading-tight text-muted">独立判读 · 不取平均掩盖分歧</div>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {MASTERS.map((m) => (
              <MasterBar key={m.key} name={m.name} school={m.school} score={masters!.byKey[m.key] ?? null} />
            ))}
          </div>
        </>
      )}
      <Link href={`/stock/${ticker}?market=us`} className="mt-4 inline-block text-xs text-accent hover:underline">
        看完整五方分析 →
      </Link>
    </div>
  );
}

function MasterBar({ name, school, score }: { name: string; school?: string; score: number | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 truncate text-xs text-muted" title={school}>{name}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${score ?? 0}%`, background: score == null ? "transparent" : scoreColor(score) }} />
      </div>
      <span className="w-6 text-right font-mono text-xs font-semibold tabular-nums" style={{ color: score == null ? undefined : scoreColor(score) }}>
        {score == null ? "—" : score}
      </span>
    </div>
  );
}

function scoreColor(s: number): string {
 if (s >= 70) return "#059669"; // 绿
 if (s >= 55) return "#165DFF"; // 蓝
 if (s >= 40) return "#D97706"; // 琥珀
 return "#DC2626";              // 红
}

function Metric({ label, value, weight }: { label: string; value: number | null | undefined; weight: string }) {
  const v = value == null ? null : value;
  return (
    <div>
 <div className="flex items-baseline justify-between mb-1">
 <span className="text-xs text-muted">{label}</span>
 <span className="flex items-baseline gap-1.5">
 <span className="font-mono text-xs font-semibold tabular-nums" style={{color: v == null ? undefined : heatHex(v)}}>{v == null ? "—" : v}</span>
 <span className="text-[10px] text-faint font-mono">{weight}</span>
        </span>
      </div>
 <div className="h-1 rounded-full bg-surface-2 overflow-hidden">
 <div className="h-full rounded-full" style={{width:`${v ?? 0}%`, background: v == null ? "transparent" : heatHex(v)}} />
      </div>
    </div>
  );
}

function EmptyHint() {
  return (
 <div className="rounded-xl border border-dashed border-line-2 bg-surface p-8 text-center sticky top-6">
 <div className="text-sm text-muted font-medium mb-2">悬停或点击粒子</div>
 <p className="text-xs text-muted leading-relaxed">
        每个粒子的尺寸 = 市值 log<br/>
        颜色 = 当前镜头的真实评分<br/>
        灰 = 该镜头下还没判读
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
function scoreHex(score: number, lens: string): string {
 return lensRampOf(lens) === "heat" ? heatHex(score) : tripleHex(score);
}

// ---- 色阶条（颜色 legend）----
function ColorScale({ lens }: { lens: string }) {
  // 用 25 个采样点画 CSS 渐变（足够平滑）
  const stops = Array.from({ length: 25 }, (_, i) => {
    const v = (i / 24) * 100;
    return `${scoreHex(v, lens)} ${(i / 24) * 100}%`;
 }).join(", ");
  const gradient = `linear-gradient(to right, ${stops})`;

 const ticks = lens === "divergence"
    ? [
 { v: 0,   label: "共识", color: "#3F1A8C" },
 { v: 40,  label: "分歧", color: "#1A8E72" },
 { v: 70,  label: "撕裂", color: "#DC4914" },
 { v: 100, label: "极撕裂", color: "#C4126B" },
      ]
    : lensRampOf(lens) === "heat"
    ? [
 { v: 0,   label: "深价值", color: "#3F1A8C" },
 { v: 30,  label: "偏冷", color: "#1E5BCC" },
 { v: 50,  label: "中性", color: "#1A8E72" },
 { v: 70,  label: "合理", color: "#A6A828" },
 { v: 85,  label: "偏热", color: "#DC4914" },
 { v: 100, label: "过热警告", color: "#C4126B" },
      ]
    : [
 { v: 0,   label: "回避", color: "#D11E2C" },
 { v: 30,  label: "偏空", color: "#E16C1C" },
 { v: 55,  label: "中性", color: "#3B82B8" },
 { v: 75,  label: "看多", color: "#1B8964" },
 { v: 100, label: "高信念", color: "#0D8C76" },
      ];

  return (
 <div className="relative">
      {/* 渐变条 */}
      <div
 className="h-2 w-full rounded-full ring-1 ring-surface-3/5"
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
 <div className="w-px h-1.5 bg-line-2 -mt-2" />
 <span className="font-mono text-[9px] text-muted mt-0.5">{t.v}</span>
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
