"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AleabitManifestEntry } from "@/lib/data";
import { type DilutionFlag, dilutionMagnitude } from "@/lib/dilution-types";
import { useWatchlist } from "@/lib/useWatchlist";
import { MASTERS } from "@/lib/masters";
import { useLang } from "@/lib/i18n";

const VERDICTS = [
 { key: "high_conviction", label: " High Conviction", short: "H. Conv." },
 { key: "aleabit_analogue", label: " Aleabit Analogue", short: "Analogue" },
 { key: "worth_watching", label: " Worth Watching", short: "Watching" },
 { key: "macro_tailwind", label: " Macro Tailwind", short: "Tailwind" },
 { key: "crowded_but_valid", label: " Crowded but Valid", short: "Crowded" },
 { key: "not_aleabit_territory", label: "❌ Not in Territory", short: "Not in" },
] as const;

const SCORE_BUCKETS = [
 { key: "70+", min: 70, max: 999, label: " 70+", default: true },
 { key: "60-69", min: 60, max: 69, label: " 60-69", default: true },
 { key: "40-59", min: 40, max: 59, label: " 40-59", default: false },
 { key: "20-39", min: 20, max: 39, label: " 20-39", default: false },
 { key: "<20", min: 0, max: 19, label: "❌ <20（批量预标）", default: false },
] as const;

type SortKey = "score" | "mcap" | "name";

export type UsStock = {
  sym: string;
  name: string;
  price: number | null;
  pct: number | null;
  mcapB: number | null;
  sector: string;
  industry: string;
  vol: number | null;
  country: string;
};

// ETF:无市值/行业/成交量,多一个近1年回报(us-etfs.json)
export type EtfRow = { sym: string; name: string; price: number | null; pct: number | null; ret1y: number | null };
// 股票 + ETF 统一类型,type 区分
export type UsSec = UsStock & { type: "stock" | "etf"; ret1y?: number | null };

// scan 用的轻量五方摘要(build_panel_summary.py 生成)。sc 按 order 顺序,缺为 null;div=max-min 分歧度
export type UsPanelSummary = {
  order: string[];
  stocks: Record<string, { sc: (number | null)[]; div: number }>;
};

// 筛选状态持久化:点进个股再返回时,筛选条件不丢(存 sessionStorage,会话内有效)。
// 仅在 mount 后恢复 → 首帧与 SSR 一致,不引入 hydration mismatch;支持 Set 与基础类型。
function usePersisted<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("scan:" + key);
      if (raw != null) {
        const parsed = JSON.parse(raw);
        setV((initial instanceof Set ? new Set(parsed) : parsed) as T);
      }
    } catch {
      /* 忽略损坏值 */
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!hydrated) return; // 恢复完成前不写,避免用初值覆盖已存的
    try {
      sessionStorage.setItem("scan:" + key, JSON.stringify(v instanceof Set ? [...v] : v));
    } catch {
      /* 忽略 */
    }
  }, [key, v, hydrated]);
  return [v, setV] as const;
}

export default function ScanClient() {
  const { t, lang } = useLang();
  const [market, setMarket] = usePersisted<"a" | "us">("market", "us");
  // 数据客户端按需 fetch(静态 JSON,浏览器会缓存),避免 SSR 把 4MB 塞进 HTML
  const [items, setItems] = useState<AleabitManifestEntry[]>([]);
  const [usStocks, setUsStocks] = useState<UsStock[]>([]);
  const [dilutionFlags, setDilutionFlags] = useState<Record<string, DilutionFlag>>({});
  const [usPanels, setUsPanels] = useState<UsPanelSummary>({ order: [], stocks: {} });
  const [aPanels, setAPanels] = useState<UsPanelSummary>({ order: [], stocks: {} });  // A股五方
  const [loading, setLoading] = useState(true);
  const [priceFlash, setPriceFlash] = useState<Record<string, "up" | "down">>({});
  const pricesRef = useRef<Record<string, number>>({});
  // 首屏只拉美股个股(us-stocks 1.3MB + 摘要 + 印股票);A股 manifest(2.5MB)切页签才取
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/data/us-stocks.json").then((r) => r.json()).then((j) => j.stocks || j).catch(() => []),
      fetch("/data/dilution-flags.json").then((r) => r.json()).then((j) => j.flags || {}).catch(() => ({})),
      fetch("/data/us-panel-summary.json").then((r) => r.json()).catch(() => ({ order: [], stocks: {} })),
    ]).then(([u, d, p]) => {
      if (!alive) return;
      setUsStocks(u as UsStock[]);
      setDilutionFlags(d as Record<string, DilutionFlag>);
      setUsPanels(p as UsPanelSummary);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);
  const aLoaded = useRef(false);
  useEffect(() => {
    if (market !== "a" || aLoaded.current) return;
    aLoaded.current = true;
    fetch("/data/aleabit_manifest.json").then((r) => r.json())
      .then((a) => setItems(a as AleabitManifestEntry[])).catch(() => { aLoaded.current = false; });
    fetch("/data/a-panel-summary.json").then((r) => r.json())
      .then((p) => setAPanels(p as UsPanelSummary)).catch(() => {});
  }, [market]);

  // 全盘实时:轮询 /api/market(Nasdaq 快照,服务端 60s 缓存),合并最新 price/pct
  useEffect(() => {
    if (market !== "us") return;
    let alive = true;
    let flashTimer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await fetch("/api/market", { cache: "no-store" });
        const j = await r.json();
        const q = (j.quotes || {}) as Record<string, { price: number | null; pct: number | null }>;
        if (!alive || !Object.keys(q).length) return;
        // 算涨跌闪烁:对比上次价(首轮无 ref → 不闪,作为基线)
        const f: Record<string, "up" | "down"> = {};
        for (const sym in q) {
          const np = q[sym].price;
          if (np == null) continue;
          const op = pricesRef.current[sym];
          if (op != null && np !== op) f[sym] = np > op ? "up" : "down";
          pricesRef.current[sym] = np;
        }
        setUsStocks((prev) =>
          prev.map((s) => {
            const nq = q[s.sym];
            return nq && nq.price != null ? { ...s, price: nq.price, pct: nq.pct } : s;
          }),
        );
        if (Object.keys(f).length) {
          setPriceFlash(f);
          flashTimer = setTimeout(() => alive && setPriceFlash({}), 1200);
        }
      } catch {
        /* 静默,保留上次 */
      }
    };
    const id = setInterval(poll, 60_000);
    poll();
    return () => { alive = false; clearInterval(id); clearTimeout(flashTimer); };
  }, [market]);
  // 默认筛选：score >= 60，隐藏批量预标的（均持久化,返回不丢）
  const [scoreBuckets, setScoreBuckets] = usePersisted<Set<string>>(
    "a:score", new Set(SCORE_BUCKETS.filter((b) => b.default).map((b) => b.key))
  );
  const [verdictSet, setVerdictSet] = usePersisted<Set<string>>("a:verdict", new Set());
  const [layerSet, setLayerSet] = usePersisted<Set<string>>("a:layer", new Set());
  const [conceptSet, setConceptSet] = usePersisted<Set<string>>("a:concept", new Set());
  // 五方判读筛选(与美股同一套):覆盖/高分/共识/分歧 + 按单个股神
  const [aPanelF, setAPanelF] = usePersisted<"all" | "covered" | "high" | "consensus" | "diverge">("a:panelF", "all");
  const [aMasterF, setAMasterF] = usePersisted<string>("a:masterF", "all");
 const [sortBy, setSortBy] = usePersisted<SortKey>("a:sort", "score");
 const [search, setSearch] = usePersisted<string>("a:search", "");
 const [conceptSearch, setConceptSearch] = useState("");

  // 提取概念列表，按出现频率排序（热门概念优先）
  const allConcepts = useMemo(() => {
    const freq = new Map<string, number>();
    items.forEach((i) => {
      (i.concepts || []).forEach((c) => freq.set(c, (freq.get(c) || 0) + 1));
    });
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [items]);

  const visibleConcepts = useMemo(() => {
    const q = conceptSearch.trim().toLowerCase();
    const list = q ? allConcepts.filter((c) => c.name.toLowerCase().includes(q)) : allConcepts;
    return list.slice(0, q ? 60 : 40);
  }, [allConcepts, conceptSearch]);

  // A 股每只的代表分:有五方就用五方均分,没有(<50亿)退回 Serenity 瓶颈分 —— 与美股同一把尺
  const aSc = (i: AleabitManifestEntry) => avgOf(aPanels.stocks[i.code]) ?? i.score;

  const filtered = useMemo(() => {
    let r = items;

    // 五方判读筛选(与美股同一套)
    if (aPanelF === "covered") r = r.filter((i) => aPanels.stocks[i.code]);
    else if (aPanelF === "high") r = r.filter((i) => (avgOf(aPanels.stocks[i.code]) ?? -1) >= 65);
    else if (aPanelF === "consensus")
      r = r.filter((i) => { const p = aPanels.stocks[i.code]; return !!p && (avgOf(p) ?? -1) >= 60 && p.div <= 25; });
    else if (aPanelF === "diverge") r = r.filter((i) => (aPanels.stocks[i.code]?.div ?? 0) >= 40);
    if (aMasterF !== "all") {
      const mi = aPanels.order.indexOf(aMasterF);
      if (mi >= 0) r = r.filter((i) => (aPanels.stocks[i.code]?.sc[mi] ?? -1) >= 70);
    }
    if (conceptSet.size > 0) {
      r = r.filter((i) => (i.concepts || []).some((c) => conceptSet.has(c)));
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter(
        (i) =>
          i.code.toLowerCase().includes(q) ||
          i.name.toLowerCase().includes(q) ||
          (i.concepts || []).some((c) => c.toLowerCase().includes(q))
      );
    }

    r = [...r];
    // 按分排序时:有五方判读的(大中盘)优先靠前,再按五方均分;没判读的小盘(Serenity 兜底)沉底 ——
    // 否则瓶颈分天然偏高的小盘会霸占顶部,列表又变回"瓶颈狙击"的样子
 if (sortBy === "score") r.sort((a, b) => {
      const ca = aPanels.stocks[a.code] ? 1 : 0, cb = aPanels.stocks[b.code] ? 1 : 0;
      return cb - ca || aSc(b) - aSc(a);
    });
 else if (sortBy === "mcap")
      r.sort((a, b) => (b.market_cap_yi ?? 0) - (a.market_cap_yi ?? 0));
 else if (sortBy === "name") r.sort((a, b) => a.name.localeCompare(b.name));

    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, aPanels, aPanelF, aMasterF, conceptSet, search, sortBy]);

  // /scan 只放个股;ETF 已拆到独立的 /etf 板块业绩页(2026-06-14)
  const usSecs: UsSec[] = useMemo(
    () => usStocks.map((s) => ({ ...s, type: "stock" as const })),
    [usStocks],
  );

  function toggle(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  }

  return (
    <>
      {/* 市场切换（默认美股） */}
 <div className="mb-2.5 inline-flex rounded-lg border border-line bg-surface p-0.5 text-sm">
        <button
          onClick={() => setMarket("us")}
          className={`rounded-md px-4 py-1.5 font-medium transition ${
 market === "us" ? "bg-surface-3 text-ink" : "text-muted hover:text-ink"
          }`}
        >
          {t("美股 · 全市场", "US · Full Market")} {usStocks.length > 0 ? usStocks.length : ""}
        </button>
        <button
          onClick={() => setMarket("a")}
          className={`rounded-md px-4 py-1.5 font-medium transition ${
 market === "a" ? "bg-surface-3 text-ink" : "text-muted hover:text-ink"
          }`}
        >
          {t("A 股 · 全市场", "A-Shares · Full Market")} {items.length > 0 ? items.length : ""}
        </button>
      </div>

      {loading && (
 <p className="mb-4 animate-pulse text-sm text-muted">{t("⏳ 全市场数据加载中…", "⏳ Loading full-market data…")}</p>
      )}

      {market === "us" ? (
        <UsScanView stocks={usSecs} flags={dilutionFlags} panels={usPanels} flash={priceFlash} />
      ) : (
      <>
      {/* 五方判读筛选(与美股 UsScanView 同一套)*/}
      {(() => {
        const covered = items.filter((i) => aPanels.stocks[i.code]).length;
        const high = items.filter((i) => (avgOf(aPanels.stocks[i.code]) ?? -1) >= 65).length;
        const consensus = items.filter((i) => { const p = aPanels.stocks[i.code]; return !!p && (avgOf(p) ?? -1) >= 60 && p.div <= 25; }).length;
        const diverge = items.filter((i) => (aPanels.stocks[i.code]?.div ?? 0) >= 40).length;
        const ord = aPanels.order.length ? aPanels.order : ["buffett", "duan", "serenity", "druckenmiller", "sentiment"];
        return covered > 0 ? (
          <div className="mb-4 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-accent">{t("⬡ 五方判读:", "⬡ Five-Master Panel:")}</span>
              {([["all", t("全部", "All")], ["covered", t(`已判读(${covered})`, `Covered (${covered})`)],
                 ["high", t(`高分 均≥65(${high})`, `High avg≥65 (${high})`)],
                 ["consensus", t(`共识好票(${consensus})`, `Consensus (${consensus})`)],
                 ["diverge", t(`分歧大(${diverge})`, `Divergence (${diverge})`)]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setAPanelF(k)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${aPanelF === k ? "bg-accent text-black" : "bg-surface-2 text-muted hover:bg-line"}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted">{t("谁看多 ≥70:", "Bullish per master ≥70:")}</span>
              {["all", ...ord].map((k) => (
                <button key={k} onClick={() => setAMasterF(k)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${aMasterF === k ? "bg-surface-3 text-ink" : "bg-surface-2 text-muted hover:bg-line"}`}>
                  {k === "all" ? t("不限", "Any") : masterLabel(k, lang)}
                </button>
              ))}
            </div>
          </div>
        ) : null;
      })()}

      {/* 筛选条 */}
 <div className="sticky top-2 z-10 mb-4 rounded-xl border border-line bg-surface/95 p-4 backdrop-blur">
 <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
 type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
 placeholder={t("搜代码 / 名称 / 板块…", "Search code / name / sector…")}
 className="flex-1 min-w-[180px] rounded-lg border border-line px-3 py-1.5 text-sm focus:border-faint focus:outline-none"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
 className="rounded-lg border border-line px-3 py-1.5 text-sm"
          >
 <option value="score">{t("按五方均分", "By 5-Master Avg")}</option>
 <option value="mcap">{t("按市值", "By Mkt Cap")}</option>
 <option value="name">{t("按名称", "By Name")}</option>
          </select>
          <button
            onClick={() => {
              setAPanelF("all");
              setAMasterF("all");
              setConceptSet(new Set());
 setSearch("");
            }}
 className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
          >
            {t("清除筛选", "Clear Filters")}
          </button>
        </div>

        {/* 概念筛选 — 热门优先 + 搜索 + 限高滚动(同花顺标准概念) */}
        {allConcepts.length > 0 && (
 <div>
 <div className="mb-1.5 flex items-center gap-2">
 <span className="shrink-0 text-xs text-muted">{t("概念", "Concepts")}</span>
              <input
                value={conceptSearch}
                onChange={(e) => setConceptSearch(e.target.value)}
                placeholder={t(`搜概念（共 ${allConcepts.length}）…`, `Search concepts (${allConcepts.length})…`)}
 className="w-40 rounded-md border border-line bg-base px-2 py-1 text-xs text-ink placeholder:text-faint focus:border-line-2 focus:outline-none"
              />
              {conceptSet.size > 0 && (
                <button
                  onClick={() => setConceptSet(new Set())}
 className="text-xs text-accent hover:underline"
                >
                  {t(`清除${conceptSet.size}`, `Clear ${conceptSet.size}`)}
                </button>
              )}
            </div>
 <div className="flex max-h-[76px] flex-wrap items-center gap-1.5 overflow-y-auto rounded-lg border border-line bg-base/40 p-1.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-line-2">
              {visibleConcepts.map((c) => {
                const active = conceptSet.has(c.name);
                return (
                  <button
                    key={c.name}
                    onClick={() => toggle(conceptSet, c.name, setConceptSet)}
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] transition ${
                      active
 ? "bg-accent text-black"
 : "bg-surface-2 text-muted hover:bg-line"
                    }`}
                  >
                    {c.name} <span className="tnum opacity-50">{c.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 结果统计 */}
 <p className="mb-3 text-xs text-muted">
 {t("显示", "Showing")} <span className="font-mono font-semibold text-ink">{filtered.length}</span> /{" "}
        {items.length}{t(" 只", "")}
      </p>

      {/* 列表 */}
 <div className="space-y-2">
        {filtered.slice(0, 200).map((i) => (
          <RowCard key={`${i.code}-${i.market}`} item={i} sum={aPanels.stocks[i.code]} order={aPanels.order} />
        ))}
        {filtered.length > 200 && (
 <p className="py-4 text-center text-xs text-faint">
            {t(`…还有 ${filtered.length - 200} 只未显示，请用筛选条件收紧范围`, `…${filtered.length - 200} more not shown — tighten filters to narrow down`)}
          </p>
        )}
        {filtered.length === 0 && (
 <p className="py-12 text-center text-sm text-faint">{t("没有符合条件的股票", "No stocks match your filters")}</p>
        )}
      </div>
      </>
      )}
    </>
  );
}

// ============================================================
// 美股全市场视图（市值 / 动量,不走 Serenity 评分）
// ============================================================

type UsSortCol = "name" | "price" | "pct" | "mcap" | "vol" | "div" | "avg";

// 五方均分:已判读股神的平均分;未覆盖 → null(排序时垫底)
function avgOf(sum?: { sc: (number | null)[] }): number | null {
  const xs = (sum?.sc ?? []).filter((x): x is number => typeof x === "number");
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
const US_PAGE_SIZE = 50;

const MASTER_NAME: Record<string, string> = Object.fromEntries(MASTERS.map((m) => [m.key, m.name]));
// 股神英文名(UI 框架层双语;MASTER_NAME 是中文规范名)
const MASTER_EN: Record<string, string> = {
  buffett: "Buffett",
  duan: "Duan Yongping",
  serenity: "Serenity",
  druckenmiller: "Druckenmiller",
  sentiment: "Sentiment",
};
const masterLabel = (k: string, lang: "zh" | "en") =>
  (lang === "zh" ? MASTER_NAME[k] : MASTER_EN[k] ?? MASTER_NAME[k]) ?? k;
// 五方迷你雷达:形状即分歧(饱满=共识,尖刺=打架,大=全员看好)。悬停看具体分。
function MasterDots({ sum, order }: { sum?: { sc: (number | null)[]; div: number }; order: string[] }) {
  const { t, lang } = useLang();
  if (!sum || !sum.sc?.some((x) => x != null)) return <span className="text-xs text-faint">—</span>;
  const sc = sum.sc;
  const N = sc.length, C = 13, R = 11;
  const pt = (f: number, i: number): [number, number] => {
    const a = ((i * 360) / N - 90) * (Math.PI / 180);
    return [C + R * f * Math.cos(a), C + R * f * Math.sin(a)];
  };
  const grid = sc.map((_, i) => pt(1, i).join(",")).join(" ");
  const poly = sc.map((s, i) => pt((s ?? 0) / 100, i).join(",")).join(" ");
  const tip = sc.map((s, i) => `${masterLabel(order[i], lang)} ${s ?? "—"}`).join(" · ") + ` · ${t("分歧", "Divergence")} ${sum.div}`;
  return (
    <svg viewBox="0 0 26 26" className="inline-block h-7 w-7 align-middle" aria-label={tip}>
      <title>{tip}</title>
      <polygon points={grid} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={0.5} />
      <polygon points={poly} fill="rgba(224,115,77,0.28)" stroke="#e0734d" strokeWidth={0.9} strokeLinejoin="round" />
    </svg>
  );
}

function fmtCap(b: number | null): string {
  if (b == null) return "—";
  if (b >= 1000) return `$${(b / 1000).toFixed(2)}T`;
  if (b >= 1) return `$${b.toFixed(1)}B`;
  return `$${(b * 1000).toFixed(0)}M`;
}
function fmtVol(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function UsScanView({ stocks, flags, panels, flash = {} }: { stocks: UsSec[]; flags: Record<string, DilutionFlag>; panels: UsPanelSummary; flash?: Record<string, "up" | "down"> }) {
  const router = useRouter();
  const { t, lang } = useLang();
  const { has, toggle } = useWatchlist();
  // /scan 只看个股;ETF 已独立到 /etf —— secType 恒为 stock(useState 保留联合类型,etf 分支不报错)
  const [secType] = useState<"stock" | "etf" | "all">("stock");
  // 筛选/排序均持久化:点进个股再返回,条件不丢
  const [search, setSearch] = usePersisted<string>("us:search", "");
  const [sectorSet, setSectorSet] = usePersisted<Set<string>>("us:sector", new Set());
  const [capTier, setCapTier] = usePersisted<"all" | "large" | "mid" | "small">("us:cap", "all");
  const [dilu, setDilu] = usePersisted<"all" | "only" | "hide">("us:dilu", "all");
  const [panelF, setPanelF] = usePersisted<"all" | "covered" | "diverge" | "high" | "consensus">("us:panel", "all");
  // 按单个股神筛"他看多(≥70)"的票;all = 不限
  const [masterF, setMasterF] = usePersisted<string>("us:master", "all");
  const [sortCol, setSortCol] = usePersisted<UsSortCol>("us:sortcol", "mcap");
  const [sortDir, setSortDir] = usePersisted<"asc" | "desc">("us:sortdir", "desc");
  const [page, setPage] = useState(0);
  // 移动端筛选 chips 默认收起(整卡占满首屏,内容全被挤到折叠线下,2026-06-12 抓包);桌面恒展开
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount =
    (sectorSet.size > 0 ? 1 : 0) + (capTier !== "all" ? 1 : 0) + (dilu !== "all" ? 1 : 0) +
    (panelF !== "all" ? 1 : 0) + (masterF !== "all" ? 1 : 0);

  const flagCount = Object.keys(flags).length;
  const order = panels.order.length ? panels.order : MASTERS.map((m) => m.key);
  const stockCount = useMemo(() => stocks.filter((s) => s.type !== "etf").length, [stocks]);
  const etfCount = useMemo(() => stocks.filter((s) => s.type === "etf").length, [stocks]);
  // 当前类型基集(涨跌统计用)
  const typeBase = useMemo(
    () => (secType === "all" ? stocks : stocks.filter((s) => (secType === "etf" ? s.type === "etf" : s.type !== "etf"))),
    [stocks, secType]
  );
  const coveredCount = useMemo(() => stocks.filter((s) => panels.stocks[s.sym]).length, [stocks, panels]);
  const divergeCount = useMemo(
    () => stocks.filter((s) => (panels.stocks[s.sym]?.div ?? 0) >= 40).length,
    [stocks, panels]
  );
  const highCount = useMemo(
    () => stocks.filter((s) => (avgOf(panels.stocks[s.sym]) ?? -1) >= 65).length,
    [stocks, panels]
  );
  const consensusCount = useMemo(
    () => stocks.filter((s) => {
      const p = panels.stocks[s.sym];
      return !!p && (avgOf(p) ?? -1) >= 60 && p.div <= 25;
    }).length,
    [stocks, panels]
  );

  // 任何筛选 / 排序变化 → 回第一页
  useEffect(() => { setPage(0); }, [secType, search, sectorSet, capTier, dilu, panelF, masterF, sortCol, sortDir]);

  const sectors = useMemo(() => {
    const freq = new Map<string, number>();
    stocks.forEach((s) => {
      if (s.sector) freq.set(s.sector, (freq.get(s.sector) || 0) + 1);
    });
    return Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
  }, [stocks]);

  const filtered = useMemo(() => {
    let r = stocks;
    if (secType === "stock") r = r.filter((s) => s.type !== "etf");
    else if (secType === "etf") r = r.filter((s) => s.type === "etf");
    // 以下筛选只对股票有意义(ETF 无行业/市值/印股票/五方),ETF 模式跳过
    if (secType !== "etf") {
      if (sectorSet.size > 0) r = r.filter((s) => sectorSet.has(s.sector));
      if (capTier !== "all") {
        r = r.filter((s) => {
          const c = s.mcapB ?? 0;
          if (capTier === "large") return c >= 10;
          if (capTier === "mid") return c >= 2 && c < 10;
          return c < 2;
        });
      }
      if (dilu === "only") r = r.filter((s) => flags[s.sym]);
      else if (dilu === "hide") r = r.filter((s) => !flags[s.sym]);
      if (panelF === "covered") r = r.filter((s) => panels.stocks[s.sym]);
      else if (panelF === "diverge") r = r.filter((s) => (panels.stocks[s.sym]?.div ?? 0) >= 40);
      else if (panelF === "high") r = r.filter((s) => (avgOf(panels.stocks[s.sym]) ?? -1) >= 65);
      else if (panelF === "consensus")
        r = r.filter((s) => {
          const p = panels.stocks[s.sym];
          return !!p && (avgOf(p) ?? -1) >= 60 && p.div <= 25;
        });
      if (masterF !== "all") {
        const mi = order.indexOf(masterF);
        if (mi >= 0) r = r.filter((s) => (panels.stocks[s.sym]?.sc[mi] ?? -1) >= 70);
      }
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter(
        (s) =>
          s.sym.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.industry.toLowerCase().includes(q)
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    const etfMode = secType === "etf";
    return [...r].sort((a, b) => {
      if (sortCol === "name") return a.name.localeCompare(b.name) * dir;
      if (sortCol === "div")
        return ((panels.stocks[a.sym]?.div ?? -1) - (panels.stocks[b.sym]?.div ?? -1)) * dir;
      if (sortCol === "avg")
        return ((avgOf(panels.stocks[a.sym]) ?? -1) - (avgOf(panels.stocks[b.sym]) ?? -1)) * dir;
      // ETF 模式下「市值」列改排「近1年回报」
      const pick = (x: UsSec) =>
        sortCol === "price" ? x.price : sortCol === "pct" ? x.pct : sortCol === "vol" ? x.vol : (etfMode ? (x.ret1y ?? null) : x.mcapB);
      return ((pick(a) ?? -Infinity) - (pick(b) ?? -Infinity)) * dir;
    });
  }, [stocks, secType, sectorSet, capTier, dilu, panelF, masterF, order, panels, flags, search, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / US_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * US_PAGE_SIZE, (safePage + 1) * US_PAGE_SIZE);

  const up = typeBase.filter((s) => (s.pct ?? 0) > 0).length;
  const down = typeBase.filter((s) => (s.pct ?? 0) < 0).length;

  function toggleSector(name: string) {
    const next = new Set(sectorSet);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSectorSet(next);
  }

  function sortClick(col: UsSortCol) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir(col === "name" ? "asc" : "desc"); }
  }
  function arrow(col: UsSortCol) {
    if (sortCol !== col) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  const CAP_TIERS: { key: typeof capTier; label: string }[] = [
    { key: "all", label: t("全部市值", "All Caps") },
    { key: "large", label: t("大盘 ≥$10B", "Large ≥$10B") },
    { key: "mid", label: t("中盘 $2–10B", "Mid $2–10B") },
    { key: "small", label: t("小盘 <$2B", "Small <$2B") },
  ];

  const Th = ({ col, label, className = "" }: { col: UsSortCol; label: string; className?: string }) => (
    <th className={`px-3 py-2 ${className}`}>
      <button
        onClick={() => sortClick(col)}
        className={`inline-flex items-center font-medium transition hover:text-ink ${
 sortCol === col ? "text-accent" : "text-muted"
        }`}
      >
        {label}<span className="tnum">{arrow(col)}</span>
      </button>
    </th>
  );

  return (
    <>
      {/* 个股 / ETF 分段 —— 股票留本页,ETF 跳独立的板块业绩页 */}
 <div className="mb-2.5 ml-2 inline-flex rounded-lg border border-line bg-surface p-0.5 text-sm">
        <span className="rounded-md bg-surface-3 px-3.5 py-1.5 font-medium text-ink">{t("个股", "Stocks")} {stockCount}</span>
        <Link href="/etf" className="rounded-md px-3.5 py-1.5 font-medium text-muted transition hover:text-ink">
          {t("ETF 板块业绩", "ETFs")} →
        </Link>
      </div>

      {/* 涨跌统计 */}
 <div className="mb-2.5 flex flex-wrap items-center gap-4 text-[13px]">
 <span className="text-muted">{secType === "etf" ? "ETF" : secType === "all" ? t("全市场", "All") : t("股票", "Stocks")} <span className="font-mono font-semibold text-ink">{typeBase.length}</span>{t(" 只", "")}</span>
 <span className="text-up">{t(`↑ ${up} 涨`, `↑ ${up} gainers`)}</span>
 <span className="text-down">{t(`↓ ${down} 跌`, `↓ ${down} losers`)}</span>
 <span className="text-faint">{secType === "etf" ? t("数据 = Nasdaq ETF 列表 · 默认按近1年回报排序 · 点列头排序", "Data = Nasdaq ETF list · sorted by 1Y return by default · click headers to sort") : t("数据 = Nasdaq 全市场快照 · 点列头排序", "Data = Nasdaq full-market snapshot · click headers to sort")}</span>
      </div>

      {/* 筛选条 */}
 <div className="mb-4 rounded-xl border border-line bg-surface p-4">
 <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
 type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
 placeholder={t("搜代码 / 公司 / 行业…", "Search ticker / company / industry…")}
 className="flex-1 min-w-[180px] rounded-lg border border-line px-3 py-1.5 text-sm focus:border-faint focus:outline-none"
          />
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition sm:hidden ${
              filtersOpen || activeFilterCount > 0
                ? "bg-accent text-black"
                : "border border-accent/30 bg-accent-soft text-accent"
            }`}
          >
            {t("筛选", "Filters")}{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""} {filtersOpen ? "▴" : "▾"}
          </button>
          {(sectorSet.size > 0 || capTier !== "all" || dilu !== "all" || panelF !== "all" || masterF !== "all" || search) && (
            <button
              onClick={() => { setSectorSet(new Set()); setCapTier("all"); setDilu("all"); setPanelF("all"); setMasterF("all"); setSearch(""); }}
 className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
            >
              {t("清除筛选", "Clear Filters")}
            </button>
          )}
        </div>

        {/* 以下三类筛选只对股票有意义,ETF 模式隐藏;移动端默认收起 */}
        {secType !== "etf" && (
        <div className={filtersOpen ? "block" : "hidden sm:block"}>
        {/* 印股票 / 稀释风险 */}
        {flagCount > 0 && (
 <div className="mb-2 flex flex-wrap items-center gap-1.5">
 <span className="mr-1 text-xs text-down">{t("⚠ 印股票风险:", "⚠ Dilution Risk:")}</span>
            {([["all", t("全部", "All")], ["only", t(`只看(${flagCount})`, `Flagged only (${flagCount})`)], ["hide", t("隐藏风险", "Hide flagged")]] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setDilu(k)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
 dilu === k ? "bg-down-soft text-down border border-down/40" : "bg-surface-2 text-muted hover:bg-line"
                }`}
              >
                {label}
              </button>
            ))}
 <span className="text-[10px] text-faint">{t("货架额度 ≫ 市值,可近乎无限增发(SEC EDGAR · 已排除大公司常规融资)", "Shelf capacity ≫ market cap — near-unlimited share issuance (SEC EDGAR · routine large-cap financing excluded)")}</span>
          </div>
        )}

        {/* 五方独立判读:覆盖 / 分歧 / 高分 / 共识 */}
        {coveredCount > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-accent">{t("⬡ 五方判读:", "⬡ Five-Master Panel:")}</span>
            {([
              ["all", t("全部", "All")],
              ["covered", t(`已判读(${coveredCount})`, `Covered (${coveredCount})`)],
              ["high", t(`高分 均≥65(${highCount})`, `High Score avg≥65 (${highCount})`)],
              ["consensus", t(`共识好票(${consensusCount})`, `Consensus Picks (${consensusCount})`)],
              ["diverge", t(`分歧大(${divergeCount})`, `High Divergence (${divergeCount})`)],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setPanelF(k)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
                  panelF === k ? "bg-accent text-black" : "bg-surface-2 text-muted hover:bg-line"
                }`}
              >
                {label}
              </button>
            ))}
            <span className="text-[10px] text-faint">{t("共识好票 = 均分≥60 且分歧≤25(五方都点头);分歧 = 评分极差,越大越有争议", "Consensus Picks = avg ≥60 & divergence ≤25 (all five agree); divergence = score range — higher means more contested")}</span>
          </div>
        )}

        {/* 按单个股神筛:他看多(该股神评分 ≥70) */}
        {coveredCount > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted">{t("谁看多 ≥70:", "Bullish per master ≥70:")}</span>
            {["all", ...order].map((k) => (
              <button
                key={k}
                onClick={() => setMasterF(k)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
                  masterF === k ? "bg-surface-3 text-ink" : "bg-surface-2 text-muted hover:bg-line"
                }`}
              >
                {k === "all" ? t("不限", "Any") : masterLabel(k, lang)}
              </button>
            ))}
            <span className="text-[10px] text-faint">{t("叠加生效:可先选「巴菲特」再排「均分」,找他重仓别人嫌弃的票", "Filters stack: pick Buffett then sort by Avg to find names he loves but others shun")}</span>
          </div>
        )}

        {/* 市值档 */}
 <div className="mb-2 flex flex-wrap items-center gap-1.5">
 <span className="mr-1 text-xs text-muted">{t("市值:", "Market Cap:")}</span>
          {CAP_TIERS.map((t) => (
            <button
              key={t.key}
              onClick={() => setCapTier(t.key)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
 capTier === t.key ? "bg-surface-3 text-ink" : "bg-surface-2 text-muted hover:bg-line"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 行业 */}
 <div className="flex max-h-[60px] flex-wrap items-center gap-1.5 overflow-y-auto">
 <span className="mr-1 text-xs text-muted">{t("行业:", "Sector:")}</span>
          {sectors.map(([name, count]) => {
            const active = sectorSet.has(name);
            return (
              <button
                key={name}
                onClick={() => toggleSector(name)}
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] transition ${
 active ? "bg-accent text-black" : "bg-surface-2 text-muted hover:bg-line"
                }`}
              >
                {name} <span className="tnum opacity-50">{count}</span>
              </button>
            );
          })}
        </div>
        </div>
        )}
      </div>

      {/* 移动端卡片列表(表格塞 375px 没法读;桌面保持表格) */}
      <div className="divide-y divide-line/60 rounded-xl border border-line bg-surface sm:hidden">
        {pageItems.map((s, idx) => {
          const rank = safePage * US_PAGE_SIZE + idx + 1;
          const inList = has(s.sym, "us");
          const isUp = (s.pct ?? 0) >= 0;
          const fl = flash[s.sym];
          const flCls = fl === "up" ? "bg-up-soft" : fl === "down" ? "bg-down-soft" : "";
          const a = s.type === "etf" ? null : avgOf(panels.stocks[s.sym]);
          return (
            <div key={s.sym} onClick={() => router.push(`/stock/${s.sym}?market=us`)}
                 className="flex cursor-pointer items-center gap-2 px-3 py-2.5">
              <span className="w-6 shrink-0 text-right font-mono text-[10px] tabular-nums text-faint">{rank}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[13px] font-semibold text-ink">{s.sym}</span>
                  {s.type === "etf" && <EtfBadge />}
                  {flags[s.sym] && <DilutionBadge flag={flags[s.sym]} />}
                  <span className="truncate text-[10px] text-muted">{s.name}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden font-mono text-[10px] tabular-nums text-faint">
                  <span className="shrink-0">{s.type === "etf" ? (s.ret1y != null ? `1Y ${s.ret1y >= 0 ? "+" : ""}${s.ret1y}%` : "—") : fmtCap(s.mcapB)}</span>
                  {a != null && (
                    <span className={`shrink-0 font-semibold ${a >= 65 ? "text-up" : a >= 50 ? "text-accent" : "text-muted"}`}>{t("均", "avg")} {Math.round(a)}</span>
                  )}
                  <span className="truncate">{s.industry || s.sector}</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className={`font-mono text-[13px] tabular-nums text-ink transition-colors duration-700 ${flCls}`}>
                  {s.price != null ? `$${s.price.toFixed(2)}` : "—"}
                </div>
                <div className={`font-mono text-[12px] font-semibold tabular-nums ${flCls || (isUp ? "text-up" : "text-down")}`}>
                  {s.pct != null ? `${isUp ? "+" : ""}${s.pct.toFixed(2)}%` : "—"}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggle({ code: s.sym, market: "us", name: s.name, sector: s.sector,
                           score: 0, verdict: "", verdict_label: "",
                           market_cap_yi: s.mcapB != null ? s.mcapB * 10 : null, layer: null, thesis: "" });
                }}
                className={`shrink-0 px-1 text-base ${inList ? "text-accent" : "text-faint"}`}
              >
                {inList ? "\u2605" : "\u2606"}
              </button>
            </div>
          );
        })}
        {pageItems.length === 0 && (
          <div className="py-10 text-center text-sm text-faint">{t("没有符合条件的股票", "No stocks match your filters")}</div>
        )}
      </div>

      {/* 表格(桌面) */}
 <div className="hidden overflow-x-auto rounded-xl border border-line sm:block">
 <table className="w-full text-sm">
 <thead className="border-b border-line bg-surface text-left text-xs">
            <tr>
 <th className="px-3 py-2 text-right font-medium text-muted">#</th>
              <Th col="name" label={t("代码 / 名称", "Ticker / Name")} />
 <Th col="price" label={t("价格", "Price")} className="text-right" />
 <Th col="pct" label={t("涨跌%", "Chg%")} className="text-right" />
 <Th col="mcap" label={secType === "etf" ? t("1年回报", "1Y Return") : secType === "all" ? t("市值 / 1Y", "Mkt Cap / 1Y") : t("市值", "Mkt Cap")} className="text-right" />
 <Th col="div" label={t("五方", "Panel")} className="text-center" />
 <Th col="avg" label={t("均分", "Avg")} className="text-right" />
 <Th col="vol" label={t("成交量", "Volume")} className="hidden text-right sm:table-cell" />
 <th className="hidden px-3 py-2 font-medium text-muted md:table-cell">{t("行业", "Industry")}</th>
 <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((s, idx) => {
              const rank = safePage * US_PAGE_SIZE + idx + 1;
              const inList = has(s.sym, "us");
              const isUp = (s.pct ?? 0) >= 0;
              const flag = flags[s.sym];
              const fl = flash[s.sym];
              const flCls = fl === "up" ? "bg-up-soft" : fl === "down" ? "bg-down-soft" : "";
              return (
                <tr
                  key={s.sym}
                  onClick={() => router.push(`/stock/${s.sym}?market=us`)}
 className="cursor-pointer border-b border-line/60 transition hover:bg-surface-2"
                >
 <td className="px-3 py-2 text-right font-mono text-xs text-faint tabular-nums">{rank}</td>
 <td className="px-3 py-2">
 <div className="flex items-baseline gap-2 max-w-[180px] sm:max-w-[340px]">
 <span className="shrink-0 font-mono font-semibold text-ink">{s.sym}</span>
                      {s.type === "etf" && <EtfBadge />}
                      {flag && <DilutionBadge flag={flag} />}
 <span className="truncate text-muted">{s.name || s.sym}</span>
                    </div>
                  </td>
 <td className={`px-3 py-2 text-right font-mono tabular-nums text-ink transition-colors duration-700 ${flCls}`}>
                    {s.price != null ? `$${s.price.toFixed(2)}` : "—"}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono font-semibold tabular-nums transition-colors duration-700 ${flCls || (isUp ? "text-up" : "text-down")}`}>
                    {s.pct != null ? `${isUp ? "+" : ""}${s.pct.toFixed(2)}%` : "—"}
                  </td>
 <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
                    {s.type === "etf"
                      ? (s.ret1y != null ? <span className={s.ret1y >= 0 ? "text-up" : "text-down"}>{s.ret1y >= 0 ? "+" : ""}{s.ret1y}%</span> : "—")
                      : fmtCap(s.mcapB)}
                  </td>
 <td className="px-3 py-2 text-center">{s.type === "etf" ? <span className="text-faint">—</span> : <MasterDots sum={panels.stocks[s.sym]} order={order} />}</td>
 <td className="px-3 py-2 text-right font-mono tabular-nums">{(() => {
                    if (s.type === "etf") return <span className="text-faint">—</span>;
                    const a = avgOf(panels.stocks[s.sym]);
                    if (a == null) return <span className="text-faint">—</span>;
                    return <span className={`font-semibold ${a >= 65 ? "text-up" : a >= 50 ? "text-accent" : "text-muted"}`}>{Math.round(a)}</span>;
                  })()}</td>
 <td className="hidden px-3 py-2 text-right font-mono tabular-nums text-muted sm:table-cell">{fmtVol(s.vol)}</td>
 <td className="hidden max-w-[200px] truncate px-3 py-2 text-xs text-muted md:table-cell">{s.industry || s.sector}</td>
 <td className="px-2 py-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle({
                          code: s.sym, market: "us", name: s.name, sector: s.sector,
                          score: 0, verdict: "", verdict_label: "",
                          market_cap_yi: s.mcapB != null ? s.mcapB * 10 : null, layer: null, thesis: "",
                        });
                      }}
 aria-label={inList ? t("从 watchlist 移除", "Remove from watchlist") : t("加入 watchlist", "Add to watchlist")}
                      className={`rounded px-1.5 text-base transition ${inList ? "text-accent" : "text-faint hover:text-accent"}`}
                    >
                      {inList ? "★" : "☆"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {pageItems.length === 0 && (
              <tr><td colSpan={10} className="py-12 text-center text-sm text-faint">{t("没有符合条件的股票", "No stocks match your filters")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
 <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
 <span className="text-xs text-muted">
          {filtered.length > 0
            ? t(
                `第 ${safePage * US_PAGE_SIZE + 1}–${Math.min((safePage + 1) * US_PAGE_SIZE, filtered.length)} 只 / 共 ${filtered.length} 只`,
                `Showing ${safePage * US_PAGE_SIZE + 1}–${Math.min((safePage + 1) * US_PAGE_SIZE, filtered.length)} of ${filtered.length}`
              )
            : t("无结果", "No results")}
        </span>
 <div className="flex items-center gap-1">
          <PageBtn label={t("« 首页", "« First")} disabled={safePage === 0} onClick={() => setPage(0)} />
          <PageBtn label={t("‹ 上一页", "‹ Prev")} disabled={safePage === 0} onClick={() => setPage(safePage - 1)} />
 <span className="px-2 font-mono text-xs text-muted">{safePage + 1} / {totalPages}</span>
          <PageBtn label={t("下一页 ›", "Next ›")} disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)} />
          <PageBtn label={t("末页 »", "Last »")} disabled={safePage >= totalPages - 1} onClick={() => setPage(totalPages - 1)} />
        </div>
      </div>
    </>
  );
}

function EtfBadge() {
  const { t } = useLang();
  return (
    <span
      title={t("ETF · 交易所交易基金(不是个股)", "ETF · Exchange-traded fund (not an individual stock)")}
      className="shrink-0 rounded border border-accent/30 bg-surface-2 px-1.5 text-[10px] font-medium text-accent"
    >
      ETF
    </span>
  );
}

export function DilutionBadge({ flag, big = false }: { flag: DilutionFlag; big?: boolean }) {
  const { t } = useLang();
  const tip = t(
    `印股票/稀释:${dilutionMagnitude(flag)}${flag.atm_1y ? ` · 近1年${flag.atm_1y}份424B5` : ""}${flag.foreign ? " · 外国发行人" : ""}`,
    `Dilution risk: ${dilutionMagnitude(flag)}${flag.atm_1y ? ` · ${flag.atm_1y} 424B5 filings in 1y` : ""}${flag.foreign ? " · foreign issuer" : ""}`
  );
  return (
    <span
      title={tip}
      className={`shrink-0 rounded border border-down/30 bg-down-soft font-medium text-down ${
        big ? "px-2 py-0.5 text-xs" : "px-1.5 text-[10px]"
      }`}
    >
      {t("印股票", "Dilution")}
    </span>
  );
}

function PageBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2.5 py-1 text-xs transition ${
        disabled
 ? "cursor-not-allowed border-line/50 text-faint/50"
 : "border-line text-muted hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function RowCard({ item: i, sum, order }: { item: AleabitManifestEntry; sum?: { sc: (number | null)[]; div: number }; order: string[] }) {
  const { t } = useLang();
  const avg = avgOf(sum);  // 五方均分(有判读才有)
 const marketLabel = i.market === "a" ? t("A股", "A-Share") : i.market === "hk" ? t("港股", "HK") : t("美股", "US");
  const marketColor =
 i.market === "a" ? "text-down" : i.market === "hk" ? "text-accent" : "text-accent";
  const { has, toggle } = useWatchlist();
  const inList = has(i.code, i.market);

  function handleStar(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    toggle({
      code: i.code,
      market: i.market,
      name: i.name,
      sector: i.sector,
      score: i.score,
      verdict: i.verdict,
      verdict_label: i.verdict_label,
      market_cap_yi: i.market_cap_yi,
      layer: i.layer,
      thesis: i.thesis,
    });
  }

  return (
 <div className="group flex items-center rounded-lg border border-line bg-surface transition hover:border-line-2 hover:">
      <Link
        href={`/stock/${i.code}?market=${i.market}`}
 className="block flex-1 min-w-0 px-4 py-2.5"
      >
 <div className="flex items-center gap-4">
          {/* 主信息 */}
 <div className="flex-1 min-w-0">
 <div className="flex items-baseline gap-2">
 <h3 className="text-sm font-semibold text-ink truncate">{i.name}</h3>
 <span className="font-mono text-xs text-faint">{i.code}</span>
              <span className={`text-[10px] font-medium ${marketColor}`}>{marketLabel}</span>
              {avg == null && i.layer && (
 <span className="text-[10px] text-muted">L{i.layer}</span>
              )}
            </div>
 <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
              {i.market_cap_yi && (
 <span className="font-mono">
                  {t(`${i.market_cap_yi.toFixed(0)} 亿`, `${(i.market_cap_yi / 10).toFixed(1)}B`)}
                </span>
              )}
              {avg == null && i.sector && (
                <>
 <span className="text-faint">·</span>
 <span className="truncate">{i.sector}</span>
                </>
              )}
 {avg == null && i.verdict_label && i.verdict !== "not_aleabit_territory" && (
                <>
 <span className="text-faint">·</span>
                  <span className={verdictColor(i.verdict)}>{i.verdict_label}</span>
                </>
              )}
            </div>
 {avg == null && i.thesis && i.verdict !== "not_aleabit_territory" && (
 <p className="mt-1 truncate text-[11px] text-muted group-hover:whitespace-normal group-hover:text-ink">
                {i.thesis}
              </p>
            )}
          </div>

          {/* 分数区 —— 有五方就显示五方雷达+均分(与美股一致);没有的小盘退回 Serenity 瓶颈分 */}
 <div className="flex shrink-0 items-center gap-3">
            {avg != null ? (
              <>
                <MasterDots sum={sum} order={order.length ? order : ["buffett", "duan", "serenity", "druckenmiller", "sentiment"]} />
                <div className="text-right">
                  <p className="text-[9px] uppercase tracking-wider text-faint">{t("五方均分", "Avg")}</p>
                  <p className={`font-mono text-lg font-semibold tabular-nums ${scoreColor(avg)}`}>{Math.round(avg)}</p>
                </div>
              </>
            ) : (
              <div className="text-right">
                <p className="text-[9px] uppercase tracking-wider text-accent">{t("瓶颈", "Bottleneck")}</p>
                <p className={`font-mono text-lg font-semibold tabular-nums ${scoreColor(i.score)}`}>{i.score}</p>
              </div>
            )}
          </div>
        </div>
      </Link>

      {/*  加入 watchlist 按钮 */}
      <button
        onClick={handleStar}
 aria-label={inList ? t("从 watchlist 移除", "Remove from watchlist") : t("加入 watchlist", "Add to watchlist")}
 title={inList ? t("从 watchlist 移除", "Remove from watchlist") : t("加入 watchlist", "Add to watchlist")}
        className={`shrink-0 px-3 py-2 mr-2 rounded transition text-lg ${
          inList
 ? "text-accent hover:text-accent hover:bg-accent-soft"
 : "text-faint hover:text-accent hover:bg-accent-soft"
        }`}
      >
 {inList ? "★" : "☆"}
      </button>
    </div>
  );
}

function scoreColor(score: number): string {
 if (score >= 75) return "text-accent";
 if (score >= 65) return "text-accent";
 if (score >= 50) return "text-accent";
 if (score >= 30) return "text-muted";
 return "text-faint";
}

function verdictColor(verdict: string): string {
  switch (verdict) {
 case "high_conviction":
 return "text-accent font-medium";
 case "aleabit_analogue":
 return "text-accent";
 case "worth_watching":
 return "text-accent";
 case "macro_tailwind":
 return "text-accent";
 case "crowded_but_valid":
 return "text-accent";
    default:
 return "text-faint";
  }
}
