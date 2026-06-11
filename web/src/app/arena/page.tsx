import { promises as fs } from "fs";
import path from "path";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Pos = {
  sym: string; name: string; shares: number; entry: number; price: number;
  pnlPct: number; dayPct: number | null; since: string; judgment: string;
};
type Trade = { date: string; side: "BUY" | "SELL"; sym: string; shares: number; price: number; reason: string; src?: string };
type Master = {
  key: string; name: string; school: string; cash: number; nav: number; retPct: number;
  positions: Pos[]; navHist: { date: string; nav: number }[]; trades: Trade[];
};
type Arena = { as_of: string; start_cash: number; masters: Master[] };

async function loadArena(): Promise<Arena | null> {
  try {
    const p = path.join(process.cwd(), "public", "data", "arena.json");
    return JSON.parse(await fs.readFile(p, "utf-8"));
  } catch {
    return null;
  }
}

function NavSpark({ hist, start }: { hist: { nav: number }[]; start: number }) {
  if (hist.length < 2)
    return <div className="h-[36px] text-[10px] text-faint flex items-end">首个交易日 · 曲线明天开始生长</div>;
  const vals = hist.map((h) => h.nav);
  const min = Math.min(...vals, start), max = Math.max(...vals, start);
  const span = max - min || 1;
  const W = 150, H = 36;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * W},${H - 3 - ((v - min) / span) * (H - 6)}`).join(" ");
  const up = vals[vals.length - 1] >= start;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[36px] w-full">
      <line x1="0" x2={W} y1={H - 3 - ((start - min) / span) * (H - 6)} y2={H - 3 - ((start - min) / span) * (H - 6)}
        stroke="currentColor" className="text-line" strokeDasharray="3 3" strokeWidth="1" />
      <polyline points={pts} fill="none" stroke={up ? "var(--color-up, #22c55e)" : "var(--color-down, #ef4444)"}
        strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const fmtUsd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export default async function ArenaPage() {
  const arena = await loadArena();
  if (!arena)
    return <main className="mx-auto max-w-5xl px-6 py-16 text-center text-muted">对决还没开赛 —— 等今晚收盘第一笔结账。</main>;

  const medals = ["🥇", "🥈", "🥉", "4th", "5th"];

  return (
    <main className="mx-auto max-w-6xl px-6 pb-12 pt-3">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">五神对决</h1>
        <p className="text-xs text-faint">
          每人 $1,000,000 虚拟资金 · 只买已判读股票池 · 每日收盘按各自纪律交易 · {arena.as_of} 结账 · 非投资建议
        </p>
      </header>

      {/* 排行榜 */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {arena.masters.map((m, i) => (
          <a key={m.key} href={`#${m.key}`}
            className="rounded-xl border border-line bg-surface p-4 transition hover:border-accent/40">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-faint">{medals[i]}</span>
              <span className="text-[10px] text-faint">{m.positions.length} 仓</span>
            </div>
            <div className="mt-1 text-[15px] font-semibold text-ink">{m.name}</div>
            <div className="text-[10px] text-muted">{m.school}</div>
            <div className="mt-2 font-mono text-lg font-semibold tabular-nums text-ink">{fmtUsd(m.nav)}</div>
            <div className={`font-mono text-sm font-semibold tabular-nums ${m.retPct >= 0 ? "text-up" : "text-down"}`}>
              {m.retPct >= 0 ? "+" : ""}{m.retPct.toFixed(2)}%
            </div>
            <div className="mt-2"><NavSpark hist={m.navHist} start={arena.start_cash} /></div>
          </a>
        ))}
      </div>

      {/* 每位股神的账本 */}
      <div className="space-y-8">
        {arena.masters.map((m, i) => (
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
                    <th className="px-3 py-2 text-right font-medium">盈亏</th>
                    <th className="hidden px-3 py-2 font-medium md:table-cell">他的判词</th>
                  </tr>
                </thead>
                <tbody>
                  {m.positions.map((p) => (
                    <tr key={p.sym} className="border-b border-line/60 hover:bg-surface-2">
                      <td className="px-3 py-2">
                        <Link href={`/stock/${p.sym}?market=us`} className="hover:text-accent">
                          <span className="font-mono font-semibold text-ink">{p.sym}</span>
                          <span className="ml-2 hidden text-xs text-muted sm:inline">{p.name.slice(0, 22)}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">{p.shares.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">${p.entry.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">${p.price.toFixed(2)}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${p.pnlPct >= 0 ? "text-up" : "text-down"}`}>
                        {p.pnlPct >= 0 ? "+" : ""}{p.pnlPct.toFixed(2)}%
                      </td>
                      <td className="hidden max-w-[380px] truncate px-3 py-2 text-xs text-muted md:table-cell" title={p.judgment}>
                        {p.judgment}
                      </td>
                    </tr>
                  ))}
                  {m.positions.length === 0 && (
                    <tr><td colSpan={6} className="py-6 text-center text-xs text-faint">空仓 —— 现金也是仓位</td></tr>
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
        巴菲特/段永平按评分长持几乎不动;Serenity 止损 -15%;德鲁肯米勒要求 20 日动量为正、止损 -10%;
        情绪资金面追当日强势、最长持 5 个交易日、止损 -7% 止盈 +15%。
        虚拟盘 · 教育用途 · 非投资建议 · 不面向中国大陆。
      </footer>
    </main>
  );
}
