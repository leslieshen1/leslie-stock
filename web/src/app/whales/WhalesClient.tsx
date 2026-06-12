"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Waves } from "lucide-react";
import {
  type Investor, type Holding, type InvestorType,
  CHANGE_META, TYPE_META,
} from "@/lib/whales-types";
import { useLang } from "@/lib/i18n";

type Filter = "all" | InvestorType;

// 共识分析：把所有超级投资者的持仓按 ticker 聚合
type ConRow = {
  ticker: string; name: string; n: number; avgPct: number;
  buys: number; sells: number; net: number; holders: string[];
};
type Con = {
  nSuper: number; consensus3: number; netBuyCount: number; netSellCount: number;
  mostHeld: ConRow[]; netBuys: ConRow[]; netSells: ConRow[];
};

export default function WhalesClient({ investors }: { investors: Investor[] }) {
 const { t, lang } = useLang();
 const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(
 () => (filter === "all" ? investors : investors.filter((i) => i.type === filter)),
    [investors, filter],
  );

  const period = useMemo(
    () => investors.find((i) => i.type === "superinvestor")?.latest_period || "",
    [investors],
  );

  const con = useMemo<Con>(() => {
    const map = new Map<string, { ticker: string; name: string;
      holders: { name: string; pct: number | null; change: string | null }[] }>();
    let nSuper = 0;
    for (const inv of investors) {
      if (inv.type !== "superinvestor") continue;
      nSuper++;
      for (const h of inv.holdings) {
        if (!h.ticker) continue;
        const e = map.get(h.ticker) || { ticker: h.ticker, name: h.stock_name || h.ticker, holders: [] };
        e.holders.push({ name: inv.name, pct: h.pct_of_portfolio, change: h.change_type });
        if ((h.stock_name?.length || 0) > e.name.length) e.name = h.stock_name!;
        map.set(h.ticker, e);
      }
    }
    const rows: ConRow[] = [...map.values()].map((e) => {
      const n = e.holders.length;
      const avgPct = e.holders.reduce((s, x) => s + (x.pct || 0), 0) / n;
      const buys = e.holders.filter((x) => x.change === "new" || x.change === "add").length;
      const sells = e.holders.filter((x) => x.change === "trim" || x.change === "exit").length;
      return { ticker: e.ticker, name: e.name, n, avgPct, buys, sells, net: buys - sells,
        holders: e.holders.map((x) => x.name) };
    });
    return {
      nSuper,
      consensus3: rows.filter((r) => r.n >= 3).length,
      netBuyCount: rows.filter((r) => r.net > 0).length,
      netSellCount: rows.filter((r) => r.net < 0).length,
      mostHeld: [...rows].filter((r) => r.n >= 2).sort((a, b) => b.n - a.n || b.avgPct - a.avgPct).slice(0, 12),
      netBuys: [...rows].filter((r) => r.buys > 0).sort((a, b) => b.net - a.net || b.buys - a.buys).slice(0, 8),
      netSells: [...rows].filter((r) => r.sells > 0).sort((a, b) => a.net - b.net || b.sells - a.sells).slice(0, 8),
    };
  }, [investors]);

  const types = useMemo(() => {
    const s = new Set(investors.map((i) => i.type));
 return (["superinvestor", "fund", "politician", "hot_money", "northbound"] as InvestorType[]).filter((t) => s.has(t));
  }, [investors]);

  return (
 <div className="space-y-7">
      {/* Header */}
      <header>
 <div className="flex items-center gap-2.5">
 <Waves className="h-5 w-5 text-accent" strokeWidth={1.75} />
 <h1 className="text-[22px] font-semibold tracking-tight text-ink">{t("聪明钱", "Smart Money")}</h1>
 <span className="text-sm text-faint">{lang === "en" ? (investors[0]?.latest_period || "") : `Smart Money · ${investors[0]?.latest_period || ""}`}</span>
        </div>
 <p className="mt-1.5 text-sm text-muted">
          {t(
            "看仓位占比与变动,不只看谁持有 —— 重仓、试探、派发,是完全不同的信号。",
            "Watch position size and changes, not just who holds it — a core position, a starter stake and a distribution are very different signals.",
          )}
        </p>
      </header>

      {/* 筛选 */}
 <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
 <FilterBtn active={filter === "all"} onClick={() => setFilter("all")}>全部</FilterBtn>
        {types.map((t) => (
          <FilterBtn key={t} active={filter === t} onClick={() => setFilter(t)}>
            {TYPE_META[t].label}
          </FilterBtn>
        ))}
      </div>

      {/* 聪明钱共识分析 */}
      {(filter === "all" || filter === "superinvestor") && con.mostHeld.length > 0 && (
        <ConsensusPanel con={con} period={period} />
      )}

      {/* 投资者卡片 */}
 <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {filtered.map((inv) => <InvestorCard key={inv.slug} inv={inv} />)}
      </div>

 <p className="text-center text-xs text-faint">
        美股 13F 季度滞后 45 天 · A 股基金季报 · 议员交易 Capitol Trades · 仓位为披露时点 · 非投资建议
      </p>
    </div>
  );
}

function InvestorCard({ inv }: { inv: Investor }) {
  const maxPct = Math.max(...inv.holdings.map((h) => h.pct_of_portfolio || 0), 1);

  return (
 <section className="rounded-xl border border-line bg-surface p-5 transition hover:border-line-2">
 <header className="mb-4 flex items-start justify-between">
        <div>
 <div className="flex items-center gap-2">
 <Link href={`/whales/${inv.slug}`} className="hover:text-accent">
 <h3 className="text-[15px] font-semibold text-ink hover:text-accent">{inv.name}</h3>
 </Link>
 <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
              {TYPE_META[inv.type].label}
            </span>
          </div>
 {inv.entity && <p className="mt-1 text-xs text-faint">{inv.entity}</p>}
        </div>
 <div className="text-right">
 <div className="tnum text-xs text-faint">{inv.latest_period}</div>
 {inv.aum_usd && <div className="tnum mt-0.5 text-xs text-muted">${(inv.aum_usd / 1e9).toFixed(1)}B</div>}
        </div>
      </header>

      {inv.notable_for && (
 <p className="mb-4 text-xs leading-relaxed text-muted">{inv.notable_for}</p>
      )}

 <div className="space-y-1">
        {inv.holdings.slice(0, 10).map((h, i) => {
 const clickable = h.market === "a";
 const inner = inv.type === "politician"
            ? <TradeRow h={h} />
            : <HoldingBar h={h} maxPct={maxPct} clickable={clickable} />;
          return clickable ? (
 <Link key={i} href={`/stock/${h.ticker}?market=a`} className="group block rounded-md px-1.5 py-1 transition hover:bg-surface-2">
              {inner}
            </Link>
          ) : (
 <div key={i} className="px-1.5 py-1">{inner}</div>
          );
        })}
      </div>
      {inv.holdings.length > 0 && (
        <Link href={`/whales/${inv.slug}`}
          className="mt-3 inline-block text-xs font-medium text-accent hover:underline">
          完整持仓 {inv.holdings.length} 只 →
        </Link>
      )}
    </section>
  );
}

// 基金 / 13F:占比条
function HoldingBar({ h, maxPct, clickable }: { h: Holding; maxPct: number; clickable: boolean }) {
 const cm = CHANGE_META[h.change_type || "hold"];
  const barW = ((h.pct_of_portfolio || 0) / maxPct) * 100;
  return (
 <div className="flex items-center gap-2.5">
 <span className="tnum w-4 shrink-0 text-right text-[10px] text-faint">{h.rank_in_portfolio}</span>
 <span className={`w-20 shrink-0 truncate text-[13px] ${clickable ? "text-ink group-hover:text-accent" : "text-muted"}`}>
        {h.stock_name}
      </span>
 <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
 <div className="absolute inset-y-0 left-0 rounded-full bg-accent/70" style={{ width: `${barW}%` }} />
      </div>
 <span className="tnum w-12 shrink-0 text-right text-xs text-muted">{h.pct_of_portfolio}%</span>
 {h.change_type && h.change_type !== "hold" ? (
        <span className={`w-12 shrink-0 rounded border px-1 py-0.5 text-center text-[9px] font-medium ${cm.tone}`}>{cm.label}</span>
 ) : <span className="w-12 shrink-0" />}
    </div>
  );
}

// 议员:交易流水
function TradeRow({ h }: { h: Holding }) {
 const buy = h.change_type === "add" || h.change_type === "new";
 const sell = h.change_type === "trim" || h.change_type === "exit";
  return (
 <div className="flex items-center gap-2.5">
      <span className={`inline-flex w-11 shrink-0 items-center justify-center gap-0.5 rounded border px-1 py-0.5 text-[10px] font-medium ${
 buy ? "text-up border-up/25 bg-up-soft" : sell ? "text-down border-down/25 bg-down-soft" : "text-faint border-line bg-surface-2"}`}>
 {buy ? "买入" : sell ? "卖出" : "持有"}
      </span>
 <span className="flex-1 truncate text-[13px] text-ink">
 <span className="tnum text-xs text-faint">{h.ticker}</span> {h.stock_name}
      </span>
 <span className="tnum shrink-0 text-xs text-muted">{h.amount_range}</span>
 <span className="tnum w-16 shrink-0 text-right text-[10px] text-faint">{h.trade_date}</span>
    </div>
  );
}

function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
 active ? "bg-surface-3 text-ink" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

// ===== 聪明钱共识分析面板 =====
function ConsensusPanel({ con, period }: { con: Con; period: string }) {
  const maxN = con.mostHeld[0]?.n || 1;
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-[15px] font-semibold text-ink">聪明钱共识</h2>
        <span className="text-xs text-faint">
          {con.nSuper} 位价投大佬交叉持仓{period ? ` · ${period}` : ""} · 13F
        </span>
      </header>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="价投大佬" value={con.nSuper} />
        <Stat label="≥3 人共识" value={con.consensus3} />
        <Stat label="本季净加码" value={con.netBuyCount} tone="up" />
        <Stat label="本季净减持" value={con.netSellCount} tone="down" />
      </div>

      <h3 className="mb-1.5 mt-5 text-[12px] font-medium uppercase tracking-wider text-faint">
        最多大佬共同持有
      </h3>
      <div className="space-y-0.5">
        {con.mostHeld.map((r, i) => (
          <ConsensusRow key={r.ticker} r={r} rank={i + 1} maxN={maxN} />
        ))}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        <MoveCol title="本季加码最集中" tone="up" rows={con.netBuys} kind="buy" />
        <MoveCol title="本季减持最集中" tone="down" rows={con.netSells} kind="sell" />
      </div>

      <p className="mt-4 text-[11px] text-faint">
        共识 ≠ 正确 —— 大佬扎堆也可能一起踏空。看的是「谁在重仓、谁在加减」,自己判断。
      </p>

    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "up" | "down" }) {
  const c = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
      <div className="text-[10px] text-faint">{label}</div>
      <div className={`tnum mt-0.5 text-lg font-semibold ${c}`}>{value}</div>
    </div>
  );
}

function ConsensusRow({ r, rank, maxN }: { r: ConRow; rank: number; maxN: number }) {
  return (
    <Link
      href={`/stock/${r.ticker}?market=us`}
      title={r.holders.join("、")}
      className="group flex items-center gap-2 rounded-md px-1.5 py-1.5 transition hover:bg-surface-2"
    >
      <span className="tnum w-4 shrink-0 text-right text-[10px] text-faint">{rank}</span>
      <span className="tnum w-14 shrink-0 text-[12px] font-semibold text-ink group-hover:text-accent">{r.ticker}</span>
      <span className="hidden w-28 shrink-0 truncate text-[12px] text-muted sm:block">{r.name}</span>
      <span className="tnum shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">{r.n} 位</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent/70" style={{ width: `${(r.n / maxN) * 100}%` }} />
      </div>
      <span className="tnum w-16 shrink-0 text-right text-[11px] text-faint">均 {r.avgPct.toFixed(1)}%</span>
      {/* 恒占位:net=0 的行少这一列会比别人宽 8px,"均 x%" 整列错位(2026-06-12 抓包) */}
      <span className={`tnum w-8 shrink-0 text-right text-[11px] font-medium ${r.net > 0 ? "text-up" : r.net < 0 ? "text-down" : "text-faint"}`}>
        {r.net > 0 ? `+${r.net}` : r.net < 0 ? r.net : "\u00b7"}
      </span>
    </Link>
  );
}

function MoveCol({ title, tone, rows, kind }: {
  title: string; tone: "up" | "down"; rows: ConRow[]; kind: "buy" | "sell";
}) {
  return (
    <div>
      <h3 className="mb-1.5 text-[12px] font-medium uppercase tracking-wider text-faint">{title}</h3>
      <div className="space-y-0.5">
        {rows.length === 0 && <p className="px-1.5 text-xs text-faint">—</p>}
        {rows.map((r) => {
          const cnt = kind === "buy" ? r.buys : r.sells;
          return (
            <Link
              key={r.ticker}
              href={`/stock/${r.ticker}?market=us`}
              className="group flex items-center gap-2 rounded-md px-1.5 py-1 transition hover:bg-surface-2"
            >
              <span className="tnum w-12 shrink-0 text-[12px] font-semibold text-ink group-hover:text-accent">{r.ticker}</span>
              <span className="flex-1 truncate text-[12px] text-muted">{r.name}</span>
              <span className="tnum shrink-0 text-[10px] text-faint">{r.n}持</span>
              <span className={`tnum w-12 shrink-0 text-right text-[11px] font-medium ${tone === "up" ? "text-up" : "text-down"}`}>
                {tone === "up" ? "+" : "−"}{cnt} 位
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
