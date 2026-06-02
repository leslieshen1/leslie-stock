"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Waves, ArrowUpRight, ArrowDownRight } from "lucide-react";
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
 return (["superinvestor", "fund", "politician", "hot_money", "northbound"] as InvestorType[]).filter((t) => s.has(t));
  }, [investors]);

  return (
 <div className="space-y-7">
      {/* Header */}
      <header>
 <div className="flex items-center gap-2.5">
 <Waves className="h-5 w-5 text-accent" strokeWidth={1.75} />
 <h1 className="text-[22px] font-semibold tracking-tight text-ink">聪明钱</h1>
 <span className="text-sm text-faint">Smart Money · {investors[0]?.latest_period || ""}</span>
        </div>
 <p className="mt-1.5 text-sm text-muted">
          看占比,不看名单 —— 段永平 0.1% 的 Circle 是试探仓,不是 conviction。
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

      {/* 近期动作 */}
 {moves.length > 0 && filter === "all" && (
 <section className="rounded-xl border border-line bg-surface p-5">
 <h2 className="mb-3 text-[13px] font-medium uppercase tracking-wider text-faint">近期动作</h2>
 <div className="flex flex-wrap gap-2">
            {moves.map(({ inv, h }, i) => {
 const buy = h.change_type === "add" || h.change_type === "new";
              return (
 <div key={i} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[13px]">
 {buy ? <ArrowUpRight className="h-3.5 w-3.5 text-up" /> : <ArrowDownRight className="h-3.5 w-3.5 text-down" />}
 <span className="font-medium text-ink">{inv.name}</span>
 <span className="text-muted">{h.stock_name}</span>
 <span className="tnum text-xs text-faint">
 {inv.type === "politician" ? h.amount_range : `${h.pct_of_portfolio}%`}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
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
 <h3 className="text-[15px] font-semibold text-ink">{inv.name}</h3>
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
