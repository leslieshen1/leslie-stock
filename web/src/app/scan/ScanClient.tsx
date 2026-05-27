"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AleabitManifestEntry } from "@/lib/data";

const VERDICTS = [
  { key: "high_conviction", label: "🎯 High Conviction", short: "H. Conv." },
  { key: "aleabit_analogue", label: "🪞 Aleabit Analogue", short: "Analogue" },
  { key: "worth_watching", label: "💎 Worth Watching", short: "Watching" },
  { key: "macro_tailwind", label: "🌊 Macro Tailwind", short: "Tailwind" },
  { key: "crowded_but_valid", label: "🚦 Crowded but Valid", short: "Crowded" },
  { key: "not_aleabit_territory", label: "❌ Not in Territory", short: "Not in" },
] as const;

const SCORE_BUCKETS = [
  { key: "70+", min: 70, max: 999, label: "🎯 70+", default: true },
  { key: "60-69", min: 60, max: 69, label: "💎 60-69", default: true },
  { key: "40-59", min: 40, max: 59, label: "🟡 40-59", default: false },
  { key: "20-39", min: 20, max: 39, label: "🟠 20-39", default: false },
  { key: "<20", min: 0, max: 19, label: "❌ <20（批量预标）", default: false },
] as const;

type SortKey = "score" | "mcap" | "name";

export default function ScanClient({ items }: { items: AleabitManifestEntry[] }) {
  // 默认筛选：score >= 60，隐藏批量预标的
  const [scoreBuckets, setScoreBuckets] = useState<Set<string>>(
    new Set(SCORE_BUCKETS.filter((b) => b.default).map((b) => b.key))
  );
  const [verdictSet, setVerdictSet] = useState<Set<string>>(new Set());
  const [layerSet, setLayerSet] = useState<Set<string>>(new Set());
  const [sectorSet, setSectorSet] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortKey>("score");
  const [search, setSearch] = useState("");

  // 提取 sector 列表
  const allSectors = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => {
      if (i.sector) set.add(i.sector);
    });
    return Array.from(set).sort();
  }, [items]);

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
    if (sectorSet.size > 0) {
      r = r.filter((i) => sectorSet.has(i.sector));
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter(
        (i) =>
          i.code.toLowerCase().includes(q) ||
          i.name.toLowerCase().includes(q) ||
          i.sector.toLowerCase().includes(q)
      );
    }

    r = [...r];
    if (sortBy === "score") r.sort((a, b) => b.score - a.score);
    else if (sortBy === "mcap")
      r.sort((a, b) => (b.market_cap_yi ?? 0) - (a.market_cap_yi ?? 0));
    else if (sortBy === "name") r.sort((a, b) => a.name.localeCompare(b.name));

    return r;
  }, [items, scoreBuckets, verdictSet, layerSet, sectorSet, search, sortBy]);

  function toggle(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  }

  return (
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
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400"
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
      <div className="sticky top-2 z-10 mb-4 rounded-xl border border-zinc-200 bg-white/95 p-4 backdrop-blur">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜代码 / 名称 / 板块…"
            className="flex-1 min-w-[180px] rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:border-zinc-400 focus:outline-none"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm"
          >
            <option value="score">按 Score</option>
            <option value="mcap">按市值</option>
            <option value="name">按名称</option>
          </select>
          <button
            onClick={() => {
              setVerdictSet(new Set());
              setLayerSet(new Set());
              setSectorSet(new Set());
              setSearch("");
            }}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            清除筛选
          </button>
        </div>

        {/* Verdict 筛选 */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-zinc-500">Verdict:</span>
          {VERDICTS.map((v) => {
            const active = verdictSet.has(v.key);
            return (
              <button
                key={v.key}
                onClick={() => toggle(verdictSet, v.key, setVerdictSet)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
                  active
                    ? "bg-zinc-900 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                {v.short}
              </button>
            );
          })}
        </div>

        {/* Layer 筛选 */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-zinc-500">Layer:</span>
          {["1", "2", "3", "4", "null"].map((l) => {
            const active = layerSet.has(l);
            return (
              <button
                key={l}
                onClick={() => toggle(layerSet, l, setLayerSet)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
                  active
                    ? "bg-zinc-900 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                {l === "null" ? "N/A" : `L${l}`}
              </button>
            );
          })}
        </div>

        {/* Sector 筛选 */}
        {allSectors.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-zinc-500">板块:</span>
            {allSectors.map((s) => {
              const active = sectorSet.has(s);
              const display = s.length > 24 ? s.slice(0, 22) + "…" : s;
              return (
                <button
                  key={s}
                  onClick={() => toggle(sectorSet, s, setSectorSet)}
                  title={s}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
                    active
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  {display}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 结果统计 */}
      <p className="mb-3 text-xs text-zinc-500">
        显示 <span className="font-mono font-semibold text-zinc-800">{filtered.length}</span> /{" "}
        {items.length} 只
      </p>

      {/* 列表 */}
      <div className="space-y-2">
        {filtered.slice(0, 200).map((i) => (
          <RowCard key={`${i.code}-${i.market}`} item={i} />
        ))}
        {filtered.length > 200 && (
          <p className="py-4 text-center text-xs text-zinc-400">
            …还有 {filtered.length - 200} 只未显示，请用筛选条件收紧范围
          </p>
        )}
        {filtered.length === 0 && (
          <p className="py-12 text-center text-sm text-zinc-400">没有符合条件的股票</p>
        )}
      </div>
    </>
  );
}

function RowCard({ item: i }: { item: AleabitManifestEntry }) {
  const marketLabel = i.market === "a" ? "A股" : i.market === "hk" ? "港股" : "美股";
  const marketColor =
    i.market === "a" ? "text-red-600" : i.market === "hk" ? "text-blue-600" : "text-violet-600";

  return (
    <Link
      href={`/stock/${i.code}?market=${i.market}`}
      className="group block rounded-lg border border-zinc-200 bg-white px-4 py-2.5 transition hover:border-zinc-300 hover:shadow-sm"
    >
      <div className="flex items-center gap-4">
        {/* 主信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold text-zinc-900 truncate">{i.name}</h3>
            <span className="font-mono text-xs text-zinc-400">{i.code}</span>
            <span className={`text-[10px] font-medium ${marketColor}`}>{marketLabel}</span>
            {i.layer && (
              <span className="text-[10px] text-zinc-500">L{i.layer}</span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
            {i.market_cap_yi && (
              <span className="font-mono">
                {i.market_cap_yi.toFixed(0)} 亿
              </span>
            )}
            {i.sector && (
              <>
                <span className="text-zinc-300">·</span>
                <span className="truncate">{i.sector}</span>
              </>
            )}
            {i.verdict_label && i.verdict !== "not_aleabit_territory" && (
              <>
                <span className="text-zinc-300">·</span>
                <span className={verdictColor(i.verdict)}>{i.verdict_label}</span>
              </>
            )}
          </div>
          {i.thesis && i.verdict !== "not_aleabit_territory" && (
            <p className="mt-1 truncate text-[11px] text-zinc-500 group-hover:whitespace-normal group-hover:text-zinc-700">
              {i.thesis}
            </p>
          )}
        </div>

        {/* 分数区 */}
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <p className="text-[9px] uppercase tracking-wider text-zinc-400">信号</p>
            <p className="font-mono text-xs text-zinc-700">{i.signals_hit}/7</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] uppercase tracking-wider text-violet-400">瓶颈</p>
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
  );
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-violet-700";
  if (score >= 65) return "text-violet-600";
  if (score >= 50) return "text-amber-600";
  if (score >= 30) return "text-zinc-500";
  return "text-zinc-300";
}

function verdictColor(verdict: string): string {
  switch (verdict) {
    case "high_conviction":
      return "text-violet-700 font-medium";
    case "aleabit_analogue":
      return "text-fuchsia-600";
    case "worth_watching":
      return "text-violet-600";
    case "macro_tailwind":
      return "text-sky-600";
    case "crowded_but_valid":
      return "text-amber-600";
    default:
      return "text-zinc-400";
  }
}
