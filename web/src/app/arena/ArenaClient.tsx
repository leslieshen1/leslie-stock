"use client";

// 五神对决 — 客户端实时层:持仓现价/盈亏/NAV/排名 30s 轮询跳动(复用 /api/quote,和全站一致)。
// 结算口径不变:NAV 曲线、成本、交易流水都来自引擎(05:00 收盘结账);这里只是"此刻的活估值"。

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

export type Pos = {
  sym: string; name: string; shares: number; entry: number; price: number;
  pnlPct: number; dayPct: number | null; since: string; judgment: string;
};
export type Trade = { date: string; side: "BUY" | "SELL"; sym: string; shares: number; price: number; reason: string; src?: string };
export type Master = {
  key: string; name: string; school: string; cash: number; nav: number; retPct: number;
  positions: Pos[]; navHist: { date: string; nav: number }[]; trades: Trade[];
};
export type Arena = { as_of: string; start_cash: number; masters: Master[] };

type Quote = { price: number; pct: number | null; session?: string };

const SESSION_ZH: Record<string, string> = { pre: "盘前", regular: "盘中", post: "盘后", closed: "已收盘" };
const fmtUsd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

function NavSpark({ hist, start }: { hist: { nav: number }[]; start: number }) {
  if (hist.length < 2)
    return <div className="flex h-[36px] items-end text-[10px] text-faint">首个交易日 · 曲线明天开始生长</div>;
  const vals = hist.map((h) => h.nav);
  const min = Math.min(...vals, start), max = Math.max(...vals, start);
  const span = max - min || 1;
  const W = 150, H = 36;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * W},${H - 3 - ((v - min) / span) * (H - 6)}`).join(" ");
  const up = vals[vals.length - 1] >= start;
  const y0 = H - 3 - ((start - min) / span) * (H - 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[36px] w-full">
      <line x1="0" x2={W} y1={y0} y2={y0} stroke="currentColor" className="text-line" strokeDasharray="3 3" strokeWidth="1" />
      <polyline points={pts} fill="none" stroke={up ? "var(--color-up, #22c55e)" : "var(--color-down, #ef4444)"}
        strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function ArenaClient({ arena }: { arena: Arena }) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  const prev = useRef<Record<string, number>>({});

  const allSyms = useMemo(
    () => [...new Set(arena.masters.flatMap((m) => m.positions.map((p) => p.sym)))],
    [arena]
  );

  useEffect(() => {
    let stop = false;
    async function poll() {
      if (document.hidden || allSyms.length === 0) return;
      const chunks: string[][] = [];
      for (let i = 0; i < allSyms.length; i += 25) chunks.push(allSyms.slice(i, i + 25));
      const merged: Record<string, Quote> = {};
      await Promise.all(chunks.map(async (c) => {
        try {
          const r = await fetch(`/api/quote?syms=${c.join(",")}`, { cache: "no-store" });
          const j = await r.json();
          Object.assign(merged, j.quotes || {});
        } catch { /* 单批失败不阻塞 */ }
      }));
      if (stop || Object.keys(merged).length === 0) return;
      const fl: Record<string, "up" | "down"> = {};
      for (const [sym, q] of Object.entries(merged)) {
        const p0 = prev.current[sym];
        if (p0 != null && q.price !== p0) fl[sym] = q.price > p0 ? "up" : "down";
        prev.current[sym] = q.price;
      }
      setQuotes((old) => ({ ...old, ...merged }));
      if (Object.keys(fl).length) {
        setFlash(fl);
        setTimeout(() => setFlash({}), 1100);
      }
    }
    poll();
    const t = setInterval(poll, 30_000);
    return () => { stop = true; clearInterval(t); };
  }, [allSyms]);

  // 实时 NAV/收益/排名(拿不到活价的票回退结算价)
  const live = useMemo(() => {
    const rows = arena.masters.map((m) => {
      const liveNav = m.cash + m.positions.reduce(
        (s, p) => s + p.shares * (quotes[p.sym]?.price ?? p.price), 0);
      return { ...m, liveNav, liveRet: (liveNav / arena.start_cash - 1) * 100 };
    });
    rows.sort((a, b) => b.liveNav - a.liveNav);
    return rows;
  }, [arena, quotes]);

  const session = Object.values(quotes)[0]?.session;
  const liveOn = Object.keys(quotes).length > 0;
  const medals = ["🥇", "🥈", "🥉", "4th", "5th"];

  return (
    <main className="mx-auto max-w-6xl px-6 pb-12 pt-3">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">五神对决</h1>
        <p className="text-xs text-faint">
          每人 $1,000,000 虚拟资金 · 只买已判读股票池 · 收盘结账 {arena.as_of} · 非投资建议
        </p>
        {liveOn && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-up/30 bg-up-soft px-2 py-0.5 text-[10px] font-semibold text-up">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            实时估值{session ? ` · ${SESSION_ZH[session] ?? session}` : ""} · 30s
          </span>
        )}
      </header>

      {/* 排行榜(实时重排) */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {live.map((m, i) => (
          <a key={m.key} href={`#${m.key}`}
            className="rounded-xl border border-line bg-surface p-4 transition hover:border-accent/40">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] text-faint">{medals[i]}</span>
              <span className="text-[10px] text-faint">{m.positions.length} 仓</span>
            </div>
            <div className="mt-1 text-[15px] font-semibold text-ink">{m.name}</div>
            <div className="text-[10px] text-muted">{m.school}</div>
            <div className="mt-2 font-mono text-lg font-semibold tabular-nums text-ink">{fmtUsd(m.liveNav)}</div>
            <div className={`font-mono text-sm font-semibold tabular-nums ${m.liveRet >= 0 ? "text-up" : "text-down"}`}>
              {m.liveRet >= 0 ? "+" : ""}{m.liveRet.toFixed(2)}%
            </div>
            <div className="mt-2"><NavSpark hist={m.navHist} start={arena.start_cash} /></div>
          </a>
        ))}
      </div>

      {/* 每位股神的账本 */}
      <div className="space-y-8">
        {live.map((m, i) => (
          <section key={m.key} id={m.key} className="scroll-mt-20">
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-base font-semibold text-ink">{medals[i]} {m.name}</h2>
              <span className="text-xs text-muted">{m.school}</span>
              <span className="font-mono text-xs tabular-nums text-muted">
                持仓 {m.positions.length} · 现金 {fmtUsd(m.cash)}
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-surface text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">持仓</th>
                    <th className="px-3 py-2 text-right font-medium">股数</th>
                    <th className="px-3 py-2 text-right font-medium">成本</th>
                    <th className="px-3 py-2 text-right font-medium">现价</th>
                    <th className="px-3 py-2 text-right font-medium">今日</th>
                    <th className="px-3 py-2 text-right font-medium">盈亏</th>
                    <th className="hidden px-3 py-2 font-medium md:table-cell">他的判词</th>
                  </tr>
                </thead>
                <tbody>
                  {m.positions.map((p) => {
                    const q = quotes[p.sym];
                    const px = q?.price ?? p.price;
                    const pnl = (px / p.entry - 1) * 100;
                    const day = q?.pct ?? p.dayPct;
                    const fl = flash[p.sym];
                    const flCls = fl === "up" ? "bg-up-soft" : fl === "down" ? "bg-down-soft" : "";
                    return (
                      <tr key={p.sym} className="border-b border-line/60 hover:bg-surface-2">
                        <td className="px-3 py-2">
                          <Link href={`/stock/${p.sym}?market=us`} className="hover:text-accent">
                            <span className="font-mono font-semibold text-ink">{p.sym}</span>
                            <span className="ml-2 hidden text-xs text-muted sm:inline">{p.name.slice(0, 22)}</span>
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">{p.shares.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">${p.entry.toFixed(2)}</td>
                        <td className={`px-3 py-2 text-right font-mono tabular-nums text-ink transition-colors duration-700 ${flCls}`}>
                          ${px.toFixed(2)}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono tabular-nums ${day == null ? "text-faint" : day >= 0 ? "text-up" : "text-down"}`}>
                          {day == null ? "—" : `${day >= 0 ? "+" : ""}${day.toFixed(2)}%`}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${pnl >= 0 ? "text-up" : "text-down"}`}>
                          {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                        </td>
                        <td className="hidden max-w-[340px] truncate px-3 py-2 text-xs text-muted md:table-cell" title={p.judgment}>
                          {p.judgment}
                        </td>
                      </tr>
                    );
                  })}
                  {m.positions.length === 0 && (
                    <tr><td colSpan={7} className="py-6 text-center text-xs text-faint">空仓 —— 现金也是仓位</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {m.trades.length > 0 && (
              <div className="mt-2 space-y-1">
                {m.trades.slice(0, 6).map((t, j) => (
                  <div key={j} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="font-mono text-faint">{t.date}</span>
                    <span className={`font-mono font-semibold ${t.side === "BUY" ? "text-up" : "text-down"}`}>
                      {t.side === "BUY" ? "买入" : "卖出"}
                    </span>
                    {t.src === "ai" && (
                      <span title="开盘前 AI 亲自决策(gpt-5.5),非规则引擎" className="rounded border border-accent/40 bg-accent-soft px-1 font-mono text-[9px] font-bold text-accent">AI</span>
                    )}
                    <span className="font-mono font-semibold text-ink">{t.sym}</span>
                    <span className="font-mono tabular-nums text-muted">{t.shares.toLocaleString()} 股 @ ${t.price.toFixed(2)}</span>
                    <span className="text-muted">— {t.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      <footer className="mt-12 border-t border-line pt-4 text-xs leading-relaxed text-faint">
        规则 V1:股票池 = 已判读 + 价格≥$2 + 市值≥$2 亿;收盘价成交、整股、不计费用滑点、现金不计息。
        开盘前 AI 决策(带 AI 徽章)+ 机械纪律兜底:巴菲特/段永平长持;Serenity 止损 -15%;
        德鲁肯米勒动量 + 止损 -10%;情绪资金面最长持 5 日、止损 -7% 止盈 +15%。
        表内现价为实时估值(30s 轮询),收盘结账以引擎为准。虚拟盘 · 教育用途 · 非投资建议 · 不面向中国大陆。
      </footer>
    </main>
  );
}
