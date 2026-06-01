"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  type Investor, type Holding, type InvestorType,
  CHANGE_META, TYPE_META,
} from "@/lib/whales-types";

type Filter = "all" | InvestorType;

export default function WhalesClient({ investors }: { investors: Investor[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(
    () => (filter === "all" ? investors : investors.filter((i) => i.type === filter)),
    [investors, filter],
  );

  // 近期动作：所有 new / add，new 优先，再按占比
  const moves = useMemo(() => {
    const out: { inv: Investor; h: Holding }[] = [];
    for (const inv of investors)
      for (const h of inv.holdings)
        if (h.change_type === "new" || h.change_type === "add") out.push({ inv, h });
    return out
      .sort((a, b) => {
        if (a.h.change_type !== b.h.change_type) return a.h.change_type === "new" ? -1 : 1;
        return (b.h.pct_of_portfolio || 0) - (a.h.pct_of_portfolio || 0);
      })
      .slice(0, 12);
  }, [investors]);

  const types = useMemo(() => {
    const s = new Set(investors.map((i) => i.type));
    return (["superinvestor", "fund", "hot_money", "northbound"] as InvestorType[]).filter((t) => s.has(t));
  }, [investors]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">🐋 聪明钱</h1>
          <span className="text-sm text-zinc-400">名人持仓与交易变动 · {investors[0]?.latest_period || ""}</span>
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          看占比,不看名单 —— 段永平 0.1% 的 Circle 是试探仓,不是 conviction。
        </p>
      </header>

      {/* 筛选 */}
      <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-1">
        <FilterBtn active={filter === "all"} onClick={() => setFilter("all")}>全部</FilterBtn>
        {types.map((t) => (
          <FilterBtn key={t} active={filter === t} onClick={() => setFilter(t)}>
            {TYPE_META[t].emoji} {TYPE_META[t].label}
          </FilterBtn>
        ))}
      </div>

      {/* 近期动作 feed */}
      {moves.length > 0 && filter === "all" && (
        <section className="rounded-2xl border border-zinc-200 bg-gradient-to-br from-white to-violet-50/30 p-5">
          <h2 className="mb-3 text-sm font-semibold text-zinc-700">⚡ 近期动作</h2>
          <div className="flex flex-wrap gap-2">
            {moves.map(({ inv, h }, i) => {
              const cm = CHANGE_META[h.change_type || "hold"];
              return (
                <div key={i} className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm">
                  <span className="font-medium text-zinc-800">{inv.name}</span>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${cm.tone}`}>{cm.label}</span>
                  <span className="text-zinc-700">{h.stock_name}</span>
                  <span className="font-mono text-xs text-zinc-400">{h.pct_of_portfolio}%</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 投资者卡片 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {filtered.map((inv) => (
          <InvestorCard key={inv.slug} inv={inv} />
        ))}
      </div>

      <p className="text-center text-xs text-zinc-400">
        美股 13F 季度滞后 45 天 · A 股基金季报数据 · 仓位占比为披露时点 · 非投资建议
      </p>
    </div>
  );
}

function InvestorCard({ inv }: { inv: Investor }) {
  const maxPct = Math.max(...inv.holdings.map((h) => h.pct_of_portfolio || 0), 1);
  const tm = TYPE_META[inv.type];

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5">
      <header className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-zinc-900">{inv.name}</h3>
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
              {tm.emoji} {tm.label}
            </span>
          </div>
          {inv.entity && <p className="mt-0.5 text-xs text-zinc-500">{inv.entity}</p>}
        </div>
        <div className="text-right text-xs text-zinc-400">
          <div className="font-mono">{inv.latest_period}</div>
          {inv.aum_usd && <div className="mt-0.5">${(inv.aum_usd / 1e9).toFixed(1)}B</div>}
        </div>
      </header>

      {inv.notable_for && (
        <p className="mb-4 text-xs leading-relaxed text-zinc-500">{inv.notable_for}</p>
      )}

      <div className="space-y-1.5">
        {inv.holdings.slice(0, 10).map((h, i) => {
          const cm = CHANGE_META[h.change_type || "hold"];
          const barW = ((h.pct_of_portfolio || 0) / maxPct) * 100;
          const clickable = h.market === "a";
          const inner = (
            <div className="flex items-center gap-2.5">
              <span className="w-4 shrink-0 text-right font-mono text-[10px] text-zinc-300">{h.rank_in_portfolio}</span>
              <span className={`w-20 shrink-0 truncate text-sm ${clickable ? "text-zinc-800 group-hover:text-violet-700" : "text-zinc-700"}`}>
                {h.stock_name}
              </span>
              {/* 占比条 */}
              <div className="relative h-4 flex-1 overflow-hidden rounded bg-zinc-100">
                <div
                  className={`absolute inset-y-0 left-0 rounded ${
                    inv.type === "superinvestor" ? "bg-blue-400/70" : "bg-violet-400/70"
                  }`}
                  style={{ width: `${barW}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-right font-mono text-xs text-zinc-600">
                {h.pct_of_portfolio}%
              </span>
              {h.change_type && h.change_type !== "hold" && (
                <span className={`w-12 shrink-0 rounded border px-1 py-0.5 text-center text-[9px] font-medium ${cm.tone}`}>
                  {cm.label}
                </span>
              )}
              {(!h.change_type || h.change_type === "hold") && <span className="w-12 shrink-0" />}
            </div>
          );
          return clickable ? (
            <Link key={i} href={`/stock/${h.ticker}?market=a`} className="group block rounded px-1 py-0.5 transition hover:bg-zinc-50">
              {inner}
            </Link>
          ) : (
            <div key={i} className="px-1 py-0.5">{inner}</div>
          );
        })}
      </div>
    </section>
  );
}

function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50"
      }`}
    >
      {children}
    </button>
  );
}
