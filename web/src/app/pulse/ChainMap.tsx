"use client";

import { useEffect, useState } from "react";
import type { ChainMapDef, CNode } from "@/lib/chain-maps";

// 通用「产业链关系图」(英伟达另用 NvidiaChain,带 ADR/海外标灰等特例)。
// A股节点涨跌走 /api/a-market(脉冲 items 里没有 A股);美股节点走 byTicker(脉冲 items)。
export default function ChainMap({
  def,
  byTicker,
  onOpenTicker,
  lang,
}: {
  def: ChainMapDef;
  byTicker: Map<string, { pct?: number | null }>;
  onOpenTicker: (ticker: string, region: string) => void;
  lang: string;
}) {
  const tt = (zh: string, en: string) => (lang === "en" ? en : zh);
  const [aPct, setAPct] = useState<Record<string, number | null>>({});

  useEffect(() => {
    let alive = true;
    fetch("/api/a-market")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const q = d?.quotes || {};
        const m: Record<string, number | null> = {};
        for (const k in q) m[k] = typeof q[k]?.pct === "number" ? q[k].pct : null;
        setAPct(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const pctOf = (n: CNode): number | null | undefined => (n.cn ? aPct[n.t] : byTicker.get(n.t)?.pct);

  const chip = (n: CNode) => {
    // 私有公司(如字节跳动):非可点标签,无涨跌
    if (n.label) {
      return (
        <span
          key={n.name}
          title="私有公司,未上市"
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-line px-2.5 py-1 text-xs font-semibold text-muted"
        >
          {n.name}
          <span className="text-[9px] font-normal text-faint">私有 · 未上市</span>
        </span>
      );
    }
    const pct = pctOf(n);
    return (
      <button
        key={n.t + n.name}
        onClick={() => onOpenTicker(n.t, n.cn ? "CN" : "US")}
        title={n.t}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs transition hover:border-accent/50 hover:bg-surface-3"
      >
        <span className="font-medium text-ink">{n.name}</span>
        {pct != null && (
          <span className={`font-mono text-[10px] ${pct >= 0 ? "text-up" : "text-down"}`}>
            {pct >= 0 ? "+" : ""}
            {pct.toFixed(1)}%
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-faint">{tt(def.flow, def.flowEn)}</div>
      {def.groups.map((g, i) => (
        <div key={g.tie}>
          <div
            className={`flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3 ${
              g.core ? "rounded-lg border border-accent/40 bg-accent-soft/20 p-2.5" : ""
            }`}
          >
            <div
              className={`shrink-0 border-l-2 pl-2 text-xs leading-snug sm:w-44 ${
                g.core ? "border-accent font-semibold text-ink" : "border-accent/30 text-muted"
              }`}
            >
              {g.core && <span className="text-accent">★ </span>}
              {tt(g.tie, g.tieEn)}
            </div>
            <div className="flex flex-wrap gap-1.5">{g.nodes.map(chip)}</div>
          </div>
          {i < def.groups.length - 1 && <div className="py-0.5 text-center font-mono text-[10px] text-faint">↓</div>}
        </div>
      ))}
      <div className="border-t border-line pt-2 text-[10px] leading-relaxed text-faint">
        {tt(
          "龙头按各链公开供应链结构手挑 · 点任一进详情 · A股实时涨跌",
          "Leaders curated from each chain's real structure · click for details · live % for A-shares",
        )}
      </div>
    </div>
  );
}
