"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLang } from "@/lib/i18n";
import type { CongressTrade } from "@/lib/congress-types";

function TickerLogo({ sym }: { sym: string }) {
  const [bad, setBad] = useState(false);
  if (bad || !sym)
    return (
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[9px] font-bold text-accent">{sym[0]}</span>
    );
  return (
    <img src={`https://assets.parqet.com/logos/symbol/${sym}?format=png&size=36`} alt={sym}
      onError={() => setBad(true)} className="h-5 w-5 shrink-0 rounded-full border border-line bg-white object-cover" />
  );
}

function fmtDate(d: string) {
  const [y, mm, dd] = d.split("-");
  const mon = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+mm];
  return `${mon} ${+dd}, ${y}`;
}

type SideFilter = "all" | "buy" | "sell";

export default function CongressMemberDetail({ trades, avg }: { trades: CongressTrade[]; avg: Record<string, number> }) {
  const { t } = useLang();
  const [side, setSide] = useState<SideFilter>("all");

  const rows = useMemo(
    () => (side === "all" ? trades : trades.filter((x) => x.side === side)),
    [trades, side],
  );

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-ink">{t("交易流水", "Trade log")}</h2>
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          <Seg active={side === "all"} onClick={() => setSide("all")}>{t("全部", "All")}</Seg>
          <Seg active={side === "buy"} onClick={() => setSide("buy")}>{t("买入", "Buys")}</Seg>
          <Seg active={side === "sell"} onClick={() => setSide("sell")}>{t("卖出", "Sells")}</Seg>
        </div>
      </div>

      <div className="divide-y divide-line/60 overflow-hidden rounded-xl border border-line bg-surface">
        {rows.map((tr, i) => {
          const buy = tr.side === "buy";
          const a = avg[tr.ticker];
          return (
            <Link key={i} href={`/stock/${tr.ticker}?market=us`}
              className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-surface-2 sm:px-4">
              <span className={`inline-flex w-11 shrink-0 items-center justify-center rounded border px-1 py-0.5 text-[10px] font-semibold ${
                buy ? "border-up/25 bg-up-soft text-up" : tr.side === "sell" ? "border-down/25 bg-down-soft text-down" : "border-line bg-surface-2 text-muted"}`}>
                {buy ? t("买入", "BUY") : tr.side === "sell" ? t("卖出", "SELL") : t("交换", "EXCH")}
              </span>
              <TickerLogo sym={tr.ticker} />
              <span className="w-16 shrink-0 font-mono text-[13px] font-semibold text-ink">{tr.ticker}</span>
              {a != null && (
                <span className={`shrink-0 font-mono text-[10px] font-semibold ${a >= 65 ? "text-up" : a >= 50 ? "text-accent" : "text-muted"}`}>
                  {t("均", "avg")} {a}
                </span>
              )}
              <span className="flex-1" />
              <span className="shrink-0 font-mono text-[12px] text-muted">{tr.size}</span>
              <span className="w-24 shrink-0 text-right font-mono text-[11px] text-faint">{fmtDate(tr.date)}</span>
            </Link>
          );
        })}
        {rows.length === 0 && <p className="px-4 py-6 text-center text-xs text-faint">{t("无记录", "No trades")}</p>}
      </div>
    </section>
  );
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-md px-3 py-1 text-[12px] font-medium transition ${active ? "bg-surface-3 text-ink" : "text-muted hover:text-ink"}`}>
      {children}
    </button>
  );
}
