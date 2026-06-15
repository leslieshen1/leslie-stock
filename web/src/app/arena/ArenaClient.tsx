"use client";

// 五神对决 — 客户端实时层:持仓现价/盈亏/NAV/排名 30s 轮询跳动(复用 /api/quote,和全站一致)。
// 结算口径不变:NAV 曲线、成本、交易流水都来自引擎(05:00 收盘结账);这里只是"此刻的活估值"。

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";

// 展示层 EN 映射(数据仍是中文 SoT)
const MASTER_EN: Record<string, { name: string; school: string }> = {
  buffett: { name: "Buffett", school: "Value · Moat · Long-hold" },
  duan: { name: "Duan Yongping", school: "Discipline · Concentration" },
  serenity: { name: "Serenity", school: "Bottleneck sniper · Stops" },
  druckenmiller: { name: "Druckenmiller", school: "Macro trend · Momentum" },
  sentiment: { name: "Sentiment", school: "Tape rotation · Fast in/out" },
};

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

function NavSpark({ hist, start, emptyLabel }: { hist: { nav: number }[]; start: number; emptyLabel: string }) {
  if (hist.length < 2)
    return <div className="flex h-[36px] items-end text-[10px] text-faint">{emptyLabel}</div>;
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
  const { t, lang } = useLang();
  const mName = (m: Master) => (lang === "en" ? MASTER_EN[m.key]?.name ?? m.name : m.name);
  const mSchool = (m: Master) => (lang === "en" ? MASTER_EN[m.key]?.school ?? m.school : m.school);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [openTrades, setOpenTrades] = useState<Record<string, boolean>>({});
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
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{t("五神对决", "Five-Master Arena")}</h1>
        <p className="text-xs text-faint">
          {t(`每人 $1,000,000 虚拟资金 · 只买已判读股票池 · 收盘结账 ${arena.as_of} · 非投资建议`,
             `$1,000,000 paper money each · covered-stocks universe only · settled at close ${arena.as_of} · not financial advice`)}
        </p>
        {liveOn && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-up/30 bg-up-soft px-2 py-0.5 text-[10px] font-semibold text-up">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            {t("实时估值", "Live marks")}{session ? ` · ${lang === "zh" ? SESSION_ZH[session] ?? session : session}` : ""} · 30s
          </span>
        )}
      </header>

      {/* 法务标注:选手是 AI 按公开方法论的模拟,非本人真实业绩/持仓 */}
      <p className="mb-4 rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-[11px] leading-relaxed text-muted">
        <span className="font-semibold text-faint">{t("AI 方法论模拟", "AI methodology simulation")}</span>{" "}
        {t("—— 五位选手是依据各投资人公开方法论运行的 AI 智能体,其虚拟盘业绩、持仓与决策均由 AI 生成,并非本人真实业绩、持仓或操作。虚拟盘 · 教育用途 · 非投资建议。",
           "— the five contestants are AI agents run on each investor's publicly known methodology. Their paper-trading performance, holdings, and decisions are AI-generated and are NOT the real person's actual track record, holdings, or actions. Paper trading · educational · not financial advice.")}
      </p>

      {/* 排行榜 · 移动端紧凑行(5 行一屏看完,不滚长卡) */}
      <div className="mb-4 space-y-1.5 sm:hidden">
        {live.map((m, i) => (
          <a key={m.key} href={`#${m.key}`}
            className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2">
            <span className="w-7 shrink-0 text-center font-mono text-[12px]">{medals[i]}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold leading-tight text-ink">{mName(m)}</div>
              <div className="truncate text-[10px] text-muted">{mSchool(m)} · {m.positions.length} {t("仓", "pos")}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-mono text-[13px] font-semibold tabular-nums text-ink">{fmtUsd(m.liveNav)}</div>
              <div className={`font-mono text-[11px] font-semibold tabular-nums ${m.liveRet >= 0 ? "text-up" : "text-down"}`}>
                {m.liveRet >= 0 ? "+" : ""}{m.liveRet.toFixed(2)}%
              </div>
            </div>
          </a>
        ))}
      </div>

      {/* 排行榜 · 桌面卡片(实时重排) */}
      <div className="mb-6 hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-5">
        {live.map((m, i) => (
          <a key={m.key} href={`#${m.key}`}
            className="rounded-xl border border-line bg-surface p-4 transition hover:border-accent/40">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] text-faint">{medals[i]}</span>
              <span className="text-[10px] text-faint">{m.positions.length} {t("仓", "pos")}</span>
            </div>
            <div className="mt-1 text-[15px] font-semibold text-ink">{mName(m)}</div>
            <div className="text-[10px] text-muted">{mSchool(m)}</div>
            <div className="mt-2 font-mono text-lg font-semibold tabular-nums text-ink">{fmtUsd(m.liveNav)}</div>
            <div className={`font-mono text-sm font-semibold tabular-nums ${m.liveRet >= 0 ? "text-up" : "text-down"}`}>
              {m.liveRet >= 0 ? "+" : ""}{m.liveRet.toFixed(2)}%
            </div>
            <div className="mt-2"><NavSpark hist={m.navHist} start={arena.start_cash} emptyLabel={t("首个交易日 · 曲线明天开始生长", "Day one · curve starts tomorrow")} /></div>
          </a>
        ))}
      </div>

      {/* 每位股神的账本 */}
      <div className="space-y-8">
        {live.map((m, i) => (
          <section key={m.key} id={m.key} className="scroll-mt-20">
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-base font-semibold text-ink">{medals[i]} {mName(m)}</h2>
              <span className="text-xs text-muted">{mSchool(m)}</span>
              <span className="font-mono text-xs tabular-nums text-muted">
                {t("持仓", "Positions")} {m.positions.length} · {t("现金", "Cash")} {fmtUsd(m.cash)}
              </span>
            </div>

            {/* 持仓 · 移动端双行卡(表格塞 375px 没法读) */}
            <div className="divide-y divide-line/60 rounded-xl border border-line bg-surface sm:hidden">
              {m.positions.map((p) => {
                const q = quotes[p.sym];
                const px = q?.price ?? p.price;
                const pnl = (px / p.entry - 1) * 100;
                const day = q?.pct ?? p.dayPct;
                const fl = flash[p.sym];
                const flCls = fl === "up" ? "bg-up-soft" : fl === "down" ? "bg-down-soft" : "";
                return (
                  <Link key={p.sym} href={`/stock/${p.sym}?market=us`}
                    className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-mono text-[13px] font-semibold text-ink">{p.sym}</span>
                        <span className="truncate text-[10px] text-muted">{p.name.slice(0, 16)}</span>
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] tabular-nums text-faint">
                        {p.shares.toLocaleString()} {t("股", "sh")} @ ${p.entry.toFixed(2)}
                        {day != null && (
                          <span className={day >= 0 ? "text-up" : "text-down"}> · {t("今日", "today")} {day >= 0 ? "+" : ""}{day.toFixed(2)}%</span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={`font-mono text-[13px] tabular-nums text-ink transition-colors duration-700 ${flCls}`}>${px.toFixed(2)}</div>
                      <div className={`font-mono text-[12px] font-semibold tabular-nums ${pnl >= 0 ? "text-up" : "text-down"}`}>
                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                      </div>
                    </div>
                  </Link>
                );
              })}
              {m.positions.length === 0 && (
                <div className="py-5 text-center text-xs text-faint">{t("空仓 —— 现金也是仓位", "All cash — cash is a position too")}</div>
              )}
            </div>

            {/* 持仓 · 桌面表格 */}
            <div className="hidden overflow-x-auto rounded-xl border border-line sm:block">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-surface text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("持仓", "Holding")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("股数", "Shares")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("成本", "Cost")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("现价", "Price")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("今日", "Today")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("盈亏", "P&L")}</th>
                    <th className="hidden px-3 py-2 font-medium md:table-cell">{t("他的判词", "Their take")}</th>
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
                    <tr><td colSpan={7} className="py-6 text-center text-xs text-faint">{t("空仓 —— 现金也是仓位", "All cash — cash is a position too")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {m.trades.length > 0 && (
              <div className="mt-2 space-y-1">
                {(openTrades[m.key] ? m.trades : m.trades.slice(0, 6)).map((tr, j) => (
                  <div key={j} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="font-mono text-faint">{tr.date}</span>
                    <span className={`font-mono font-semibold ${tr.side === "BUY" ? "text-up" : "text-down"}`}>
                      {tr.side === "BUY" ? t("买入", "BUY") : t("卖出", "SELL")}
                    </span>
                    {tr.src === "ai" && (
                      <span title={t("开盘前 AI 亲自决策(gpt-5.5),非规则引擎", "Decided pre-open by the AI itself (gpt-5.5), not the rule engine")} className="rounded border border-accent/40 bg-accent-soft px-1 font-mono text-[9px] font-bold text-accent">AI</span>
                    )}
                    <span className="font-mono font-semibold text-ink">{tr.sym}</span>
                    <span className="font-mono tabular-nums text-muted">{tr.shares.toLocaleString()} {t("股", "sh")} @ ${tr.price.toFixed(2)}</span>
                    <span className="text-muted">— {tr.reason}</span>
                  </div>
                ))}
                {m.trades.length > 6 && (
                  <button
                    onClick={() => setOpenTrades((o) => ({ ...o, [m.key]: !o[m.key] }))}
                    className="mt-1 w-full rounded-lg border border-dashed border-line py-1.5 text-[11px] text-muted transition hover:border-faint hover:text-ink"
                  >
                    {openTrades[m.key]
                      ? t("收起,只看最近 6 笔", "Collapse to latest 6")
                      : t(`展开全部 ${m.trades.length} 笔`, `Show all ${m.trades.length} trades`)}
                  </button>
                )}
              </div>
            )}
          </section>
        ))}
      </div>

      <footer className="mt-12 border-t border-line pt-4 text-xs leading-relaxed text-faint">
        {t(
          "规则 V1:股票池 = 已判读 + 价格≥$2 + 市值≥$2 亿;收盘价成交、整股、不计费用滑点、现金不计息。开盘前 AI 决策(带 AI 徽章)+ 机械纪律兜底:巴菲特/段永平长持;Serenity 止损 -15%;德鲁肯米勒动量 + 止损 -10%;情绪资金面最长持 5 日、止损 -7% 止盈 +15%。表内现价为实时估值(30s 轮询),收盘结账以引擎为准。虚拟盘 · 教育用途 · 非投资建议 · 不面向中国大陆。",
          "Rules V1: universe = covered stocks, price ≥ $2, market cap ≥ $0.2B; fills at close, whole shares, no fees/slippage, no interest on cash. Pre-open AI decisions (AI badge) with mechanical discipline underneath: Buffett/Duan hold long; Serenity stop -15%; Druckenmiller momentum + stop -10%; Sentiment max 5-day hold, stop -7%, take-profit +15%. Table prices are live marks (30s polling); official accounting settles at close. Paper trading · educational · not financial advice · not intended for users in mainland China."
        )}
      </footer>
    </main>
  );
}
