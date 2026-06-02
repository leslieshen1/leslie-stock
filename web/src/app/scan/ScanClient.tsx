"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AleabitManifestEntry } from "@/lib/data";
import { useWatchlist } from "@/lib/useWatchlist";

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

export default function ScanClient({
  items,
  usStocks = [],
}: {
  items: AleabitManifestEntry[];
  usStocks?: UsStock[];
}) {
  const [market, setMarket] = useState<"a" | "us">("us");
  // 默认筛选：score >= 60，隐藏批量预标的
  const [scoreBuckets, setScoreBuckets] = useState<Set<string>>(
    new Set(SCORE_BUCKETS.filter((b) => b.default).map((b) => b.key))
  );
  const [verdictSet, setVerdictSet] = useState<Set<string>>(new Set());
  const [layerSet, setLayerSet] = useState<Set<string>>(new Set());
  const [conceptSet, setConceptSet] = useState<Set<string>>(new Set());
 const [sortBy, setSortBy] = useState<SortKey>("score");
 const [search, setSearch] = useState("");
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

  const filtered = useMemo(() => {
    let r = items;

    // 分数桶
    if (scoreBuckets.size > 0) {
      r = r.filter((i) =>
        SCORE_BUCKETS.some(
          (b) => scoreBuckets.has(b.key) && i.score >= b.min && i.score <= b.max
        )
      );
    }

    if (verdictSet.size > 0) {
      r = r.filter((i) => verdictSet.has(i.verdict));
    }
    if (layerSet.size > 0) {
 r = r.filter((i) => layerSet.has(String(i.layer ?? "null")));
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
 if (sortBy === "score") r.sort((a, b) => b.score - a.score);
 else if (sortBy === "mcap")
      r.sort((a, b) => (b.market_cap_yi ?? 0) - (a.market_cap_yi ?? 0));
 else if (sortBy === "name") r.sort((a, b) => a.name.localeCompare(b.name));

    return r;
  }, [items, scoreBuckets, verdictSet, layerSet, conceptSet, search, sortBy]);

  function toggle(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  }

  return (
    <>
      {/* 市场切换（默认美股） */}
 <div className="mb-5 inline-flex rounded-lg border border-line bg-surface p-1 text-sm">
        <button
          onClick={() => setMarket("us")}
          className={`rounded-md px-4 py-1.5 font-medium transition ${
 market === "us" ? "bg-surface-3 text-white" : "text-muted hover:text-ink"
          }`}
        >
          美股 · 全市场 {usStocks.length > 0 ? usStocks.length : ""}
        </button>
        <button
          onClick={() => setMarket("a")}
          className={`rounded-md px-4 py-1.5 font-medium transition ${
 market === "a" ? "bg-surface-3 text-white" : "text-muted hover:text-ink"
          }`}
        >
          A 股 · 瓶颈狙击
        </button>
      </div>

      {market === "us" ? (
        <UsScanView stocks={usStocks} />
      ) : (
      <>
      {/* 顶部统计 */}
 <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-6">
        {SCORE_BUCKETS.map((b) => {
          const count = items.filter(
            (i) => i.score >= b.min && i.score <= b.max
          ).length;
          const active = scoreBuckets.has(b.key);
          return (
            <button
              key={b.key}
              onClick={() => toggle(scoreBuckets, b.key, setScoreBuckets)}
              className={`rounded-lg border px-3 py-2.5 text-left transition ${
                active
 ? "border-surface-3 bg-surface-3 text-white"
 : "border-line bg-surface text-muted hover:border-line-2"
              }`}
            >
 <p className="text-[11px] uppercase tracking-wider opacity-70">
                {b.label}
              </p>
 <p className="mt-0.5 font-mono text-xl font-semibold">{count}</p>
            </button>
          );
        })}
      </div>

      {/* 筛选条 */}
 <div className="sticky top-2 z-10 mb-4 rounded-xl border border-line bg-surface/95 p-4 backdrop-blur">
 <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
 type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
 placeholder="搜代码 / 名称 / 板块…"
 className="flex-1 min-w-[180px] rounded-lg border border-line px-3 py-1.5 text-sm focus:border-faint focus:outline-none"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
 className="rounded-lg border border-line px-3 py-1.5 text-sm"
          >
 <option value="score">按 Score</option>
 <option value="mcap">按市值</option>
 <option value="name">按名称</option>
          </select>
          <button
            onClick={() => {
              setVerdictSet(new Set());
              setLayerSet(new Set());
              setConceptSet(new Set());
 setSearch("");
            }}
 className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
          >
            清除筛选
          </button>
        </div>

        {/* Verdict 筛选 */}
 <div className="mb-2 flex flex-wrap items-center gap-1.5">
 <span className="mr-1 text-xs text-muted">Verdict:</span>
          {VERDICTS.map((v) => {
            const active = verdictSet.has(v.key);
            return (
              <button
                key={v.key}
                onClick={() => toggle(verdictSet, v.key, setVerdictSet)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
                  active
 ? "bg-surface-3 text-white"
 : "bg-surface-2 text-muted hover:bg-line"
                }`}
              >
                {v.short}
              </button>
            );
          })}
        </div>

        {/* Layer 筛选 */}
 <div className="mb-2 flex flex-wrap items-center gap-1.5">
 <span className="mr-1 text-xs text-muted">Layer:</span>
 {["1", "2", "3", "4", "null"].map((l) => {
            const active = layerSet.has(l);
            return (
              <button
                key={l}
                onClick={() => toggle(layerSet, l, setLayerSet)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
                  active
 ? "bg-surface-3 text-white"
 : "bg-surface-2 text-muted hover:bg-line"
                }`}
              >
 {l === "null" ? "N/A" : `L${l}`}
              </button>
            );
          })}
        </div>

        {/* 概念筛选 — 热门优先 + 搜索 + 限高滚动(同花顺标准概念) */}
        {allConcepts.length > 0 && (
 <div>
 <div className="mb-1.5 flex items-center gap-2">
 <span className="shrink-0 text-xs text-muted">概念</span>
              <input
                value={conceptSearch}
                onChange={(e) => setConceptSearch(e.target.value)}
                placeholder={`搜概念（共 ${allConcepts.length}）…`}
 className="w-40 rounded-md border border-line bg-base px-2 py-1 text-xs text-ink placeholder:text-faint focus:border-line-2 focus:outline-none"
              />
              {conceptSet.size > 0 && (
                <button
                  onClick={() => setConceptSet(new Set())}
 className="text-xs text-accent hover:underline"
                >
                  清除{conceptSet.size}
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
 显示 <span className="font-mono font-semibold text-ink">{filtered.length}</span> /{" "}
        {items.length} 只
      </p>

      {/* 列表 */}
 <div className="space-y-2">
        {filtered.slice(0, 200).map((i) => (
          <RowCard key={`${i.code}-${i.market}`} item={i} />
        ))}
        {filtered.length > 200 && (
 <p className="py-4 text-center text-xs text-faint">
            …还有 {filtered.length - 200} 只未显示，请用筛选条件收紧范围
          </p>
        )}
        {filtered.length === 0 && (
 <p className="py-12 text-center text-sm text-faint">没有符合条件的股票</p>
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

type UsSortCol = "name" | "price" | "pct" | "mcap" | "vol";
const US_PAGE_SIZE = 50;

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

function UsScanView({ stocks }: { stocks: UsStock[] }) {
  const router = useRouter();
  const { has, toggle } = useWatchlist();
  const [search, setSearch] = useState("");
  const [sectorSet, setSectorSet] = useState<Set<string>>(new Set());
  const [capTier, setCapTier] = useState<"all" | "large" | "mid" | "small">("all");
  const [sortCol, setSortCol] = useState<UsSortCol>("mcap");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  // 任何筛选 / 排序变化 → 回第一页
  useEffect(() => { setPage(0); }, [search, sectorSet, capTier, sortCol, sortDir]);

  const sectors = useMemo(() => {
    const freq = new Map<string, number>();
    stocks.forEach((s) => {
      if (s.sector) freq.set(s.sector, (freq.get(s.sector) || 0) + 1);
    });
    return Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
  }, [stocks]);

  const filtered = useMemo(() => {
    let r = stocks;
    if (sectorSet.size > 0) r = r.filter((s) => sectorSet.has(s.sector));
    if (capTier !== "all") {
      r = r.filter((s) => {
        const c = s.mcapB ?? 0;
        if (capTier === "large") return c >= 10;
        if (capTier === "mid") return c >= 2 && c < 10;
        return c < 2;
      });
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
    return [...r].sort((a, b) => {
      if (sortCol === "name") return a.name.localeCompare(b.name) * dir;
      const av = sortCol === "price" ? a.price : sortCol === "pct" ? a.pct : sortCol === "vol" ? a.vol : a.mcapB;
      const bv = sortCol === "price" ? b.price : sortCol === "pct" ? b.pct : sortCol === "vol" ? b.vol : b.mcapB;
      return ((av ?? -Infinity) - (bv ?? -Infinity)) * dir;
    });
  }, [stocks, sectorSet, capTier, search, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / US_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * US_PAGE_SIZE, (safePage + 1) * US_PAGE_SIZE);

  const up = stocks.filter((s) => (s.pct ?? 0) > 0).length;
  const down = stocks.filter((s) => (s.pct ?? 0) < 0).length;

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
    { key: "all", label: "全部市值" },
    { key: "large", label: "大盘 ≥$10B" },
    { key: "mid", label: "中盘 $2–10B" },
    { key: "small", label: "小盘 <$2B" },
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
      {/* 涨跌统计 */}
 <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
 <span className="text-muted">全市场 <span className="font-mono font-semibold text-ink">{stocks.length}</span> 只</span>
 <span className="text-up">↑ {up} 涨</span>
 <span className="text-down">↓ {down} 跌</span>
 <span className="text-faint">数据 = Nasdaq 全市场快照（与币安美股同源 Alpaca 池）· 点列头排序</span>
      </div>

      {/* 筛选条 */}
 <div className="mb-4 rounded-xl border border-line bg-surface p-4">
 <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
 type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
 placeholder="搜代码 / 公司 / 行业…"
 className="flex-1 min-w-[180px] rounded-lg border border-line px-3 py-1.5 text-sm focus:border-faint focus:outline-none"
          />
          {(sectorSet.size > 0 || capTier !== "all" || search) && (
            <button
              onClick={() => { setSectorSet(new Set()); setCapTier("all"); setSearch(""); }}
 className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
            >
              清除筛选
            </button>
          )}
        </div>

        {/* 市值档 */}
 <div className="mb-2 flex flex-wrap items-center gap-1.5">
 <span className="mr-1 text-xs text-muted">市值:</span>
          {CAP_TIERS.map((t) => (
            <button
              key={t.key}
              onClick={() => setCapTier(t.key)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
 capTier === t.key ? "bg-surface-3 text-white" : "bg-surface-2 text-muted hover:bg-line"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 行业 */}
 <div className="flex max-h-[60px] flex-wrap items-center gap-1.5 overflow-y-auto">
 <span className="mr-1 text-xs text-muted">行业:</span>
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

      {/* 表格 */}
 <div className="overflow-x-auto rounded-xl border border-line">
 <table className="w-full text-sm">
 <thead className="border-b border-line bg-surface text-left text-xs">
            <tr>
 <th className="px-3 py-2 text-right font-medium text-muted">#</th>
              <Th col="name" label="代码 / 名称" />
 <Th col="price" label="价格" className="text-right" />
 <Th col="pct" label="涨跌%" className="text-right" />
 <Th col="mcap" label="市值" className="text-right" />
 <Th col="vol" label="成交量" className="hidden text-right sm:table-cell" />
 <th className="hidden px-3 py-2 font-medium text-muted md:table-cell">行业</th>
 <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((s, idx) => {
              const rank = safePage * US_PAGE_SIZE + idx + 1;
              const inList = has(s.sym, "us");
              const isUp = (s.pct ?? 0) >= 0;
              return (
                <tr
                  key={s.sym}
                  onClick={() => router.push(`/stock/${s.sym}?market=us`)}
 className="cursor-pointer border-b border-line/60 transition hover:bg-surface-2"
                >
 <td className="px-3 py-2 text-right font-mono text-xs text-faint tabular-nums">{rank}</td>
 <td className="px-3 py-2">
 <div className="flex items-baseline gap-2 max-w-[170px] sm:max-w-[300px]">
 <span className="shrink-0 font-mono font-semibold text-ink">{s.sym}</span>
 <span className="truncate text-muted">{s.name || s.sym}</span>
                    </div>
                  </td>
 <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                    {s.price != null ? `$${s.price.toFixed(2)}` : "—"}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${isUp ? "text-up" : "text-down"}`}>
                    {s.pct != null ? `${isUp ? "+" : ""}${s.pct.toFixed(2)}%` : "—"}
                  </td>
 <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">{fmtCap(s.mcapB)}</td>
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
 aria-label={inList ? "从 watchlist 移除" : "加入 watchlist"}
                      className={`rounded px-1.5 text-base transition ${inList ? "text-accent" : "text-faint hover:text-accent"}`}
                    >
                      {inList ? "★" : "☆"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {pageItems.length === 0 && (
              <tr><td colSpan={8} className="py-12 text-center text-sm text-faint">没有符合条件的股票</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
 <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
 <span className="text-xs text-muted">
          {filtered.length > 0
            ? `第 ${safePage * US_PAGE_SIZE + 1}–${Math.min((safePage + 1) * US_PAGE_SIZE, filtered.length)} 只 / 共 ${filtered.length} 只`
            : "无结果"}
        </span>
 <div className="flex items-center gap-1">
          <PageBtn label="« 首页" disabled={safePage === 0} onClick={() => setPage(0)} />
          <PageBtn label="‹ 上一页" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} />
 <span className="px-2 font-mono text-xs text-muted">{safePage + 1} / {totalPages}</span>
          <PageBtn label="下一页 ›" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)} />
          <PageBtn label="末页 »" disabled={safePage >= totalPages - 1} onClick={() => setPage(totalPages - 1)} />
        </div>
      </div>
    </>
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

function RowCard({ item: i }: { item: AleabitManifestEntry }) {
 const marketLabel = i.market === "a" ? "A股" : i.market === "hk" ? "港股" : "美股";
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
              {i.layer && (
 <span className="text-[10px] text-muted">L{i.layer}</span>
              )}
            </div>
 <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
              {i.market_cap_yi && (
 <span className="font-mono">
                  {i.market_cap_yi.toFixed(0)} 亿
                </span>
              )}
              {i.sector && (
                <>
 <span className="text-faint">·</span>
 <span className="truncate">{i.sector}</span>
                </>
              )}
 {i.verdict_label && i.verdict !== "not_aleabit_territory" && (
                <>
 <span className="text-faint">·</span>
                  <span className={verdictColor(i.verdict)}>{i.verdict_label}</span>
                </>
              )}
            </div>
 {i.thesis && i.verdict !== "not_aleabit_territory" && (
 <p className="mt-1 truncate text-[11px] text-muted group-hover:whitespace-normal group-hover:text-ink">
                {i.thesis}
              </p>
            )}
          </div>

          {/* 分数区 */}
 <div className="flex shrink-0 items-center gap-3">
 <div className="text-right">
 <p className="text-[9px] uppercase tracking-wider text-faint">信号</p>
 <p className="font-mono text-xs text-muted">{i.signals_hit}/7</p>
            </div>
 <div className="text-right">
 <p className="text-[9px] uppercase tracking-wider text-accent">瓶颈</p>
              <p
                className={`font-mono text-lg font-semibold tabular-nums ${scoreColor(
                  i.score
                )}`}
              >
                {i.score}
              </p>
            </div>
          </div>
        </div>
      </Link>

      {/*  加入 watchlist 按钮 */}
      <button
        onClick={handleStar}
 aria-label={inList ? "从 watchlist 移除" : "加入 watchlist"}
 title={inList ? "从 watchlist 移除" : "加入 watchlist"}
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
