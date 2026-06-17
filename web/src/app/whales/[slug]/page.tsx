// 单个大佬的 13F 持仓详情页 —— /whales/howard-marks
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { promises as fs } from "fs";
import path from "path";
import { loadWhales } from "@/lib/whales";
import { T } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// 每个大佬页独立 title/description(否则 81+ 个页共用全站默认标题 → 长尾 SEO 作废)
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const inv = (loadWhales().investors || []).find((i) => i.slug === slug);
  if (!inv) return { title: "大佬持仓 · 我不是股神" };
  const n = (inv.holdings || []).length;
  const title = `${inv.name}${inv.entity ? `(${inv.entity})` : ""}的 13F 持仓 · 我不是股神`;
  const description = `${inv.name} 最新 13F 持仓(${inv.latest_period}):共 ${n} 只。季度披露、~45 天滞后,非实时,非投资建议。`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary", title, description },
  };
}

const CHANGE: Record<string, { zh: string; en: string; cls: string }> = {
  new: { zh: "新建仓", en: "NEW", cls: "bg-up-soft text-up border-up/30" },
  add: { zh: "加仓", en: "ADD", cls: "bg-up-soft text-up border-up/30" },
  trim: { zh: "减持", en: "TRIM", cls: "bg-down-soft text-down border-down/30" },
  exit: { zh: "清仓", en: "EXIT", cls: "bg-down-soft text-down border-down/30" },
  hold: { zh: "持有", en: "HOLD", cls: "bg-surface-2 text-muted border-line" },
};

async function loadAvgScores(): Promise<Record<string, number>> {
  try {
    const p = path.join(process.cwd(), "public", "data", "us-panel-summary.json");
    const j = JSON.parse(await fs.readFile(p, "utf-8")) as { stocks: Record<string, { sc: (number | null)[] }> };
    const out: Record<string, number> = {};
    for (const [sym, v] of Object.entries(j.stocks)) {
      const xs = (v.sc || []).filter((x): x is number => typeof x === "number");
      if (xs.length) out[sym] = Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
    }
    return out;
  } catch {
    return {};
  }
}

export default async function WhaleDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const whales = loadWhales();
  const inv = (whales.investors || []).find((i) => i.slug === slug);
  if (!inv) notFound();

  const avg = await loadAvgScores();
  const holdings = [...(inv.holdings || [])].sort(
    (a, b) => (b.pct_of_portfolio ?? 0) - (a.pct_of_portfolio ?? 0)
  );
  const maxPct = holdings[0]?.pct_of_portfolio || 1;
  const top10 = holdings.slice(0, 10).reduce((s, h) => s + (h.pct_of_portfolio || 0), 0);
  const moves = holdings.filter((h) => h.change_type === "new" || h.change_type === "add").length;
  const cuts = holdings.filter((h) => h.change_type === "trim" || h.change_type === "exit").length;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-12 pt-3 sm:px-6">
      <div className="mb-3 flex items-center gap-2 text-xs">
        <Link href="/whales" className="text-muted hover:text-ink"><T zh="聪明钱" en="Whales" /></Link>
        <span className="text-faint">/</span>
        <span className="text-muted">{inv.name}</span>
      </div>

      <header className="mb-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{inv.name}</h1>
          {inv.name_en && <span className="text-base text-muted">{inv.name_en}</span>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          {inv.entity && <span>{inv.entity}</span>}
          <span className="font-mono text-xs text-faint">13F · {inv.latest_period}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
            <T zh="持仓" en="Holdings" /> <b className="font-mono">{holdings.length}</b>
          </span>
          <span className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
            <T zh="前十集中度" en="Top-10 weight" /> <b className="font-mono">{top10.toFixed(0)}%</b>
          </span>
          <span className="rounded-lg border border-up/30 bg-up-soft px-2.5 py-1.5 text-up">
            <T zh="本季新建/加仓" en="New/Add" /> <b className="font-mono">{moves}</b>
          </span>
          <span className="rounded-lg border border-down/30 bg-down-soft px-2.5 py-1.5 text-down">
            <T zh="减持/清仓" en="Trim/Sold" /> <b className="font-mono">{cuts}</b>
          </span>
        </div>
      </header>

      <div className="divide-y divide-line/60 overflow-hidden rounded-xl border border-line bg-surface">
        {holdings.map((h, i) => {
          const a = h.market === "us" ? avg[h.ticker] : undefined;
          const ch = CHANGE[h.change_type || "hold"] ?? CHANGE.hold;
          return (
            <Link
              key={`${h.ticker}-${i}`}
              href={`/stock/${h.ticker}?market=${h.market || "us"}`}
              className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-surface-2 sm:px-4"
            >
              <span className="w-6 shrink-0 text-right font-mono text-[10px] tabular-nums text-faint">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[13px] font-semibold text-ink">{h.ticker}</span>
                  <span className="truncate text-xs text-muted">{h.stock_name}</span>
                  {a != null && (
                    <span className={`shrink-0 font-mono text-[10px] font-semibold ${a >= 65 ? "text-up" : a >= 50 ? "text-accent" : "text-muted"}`}>
                      <T zh="均" en="avg" /> {a}
                    </span>
                  )}
                </div>
                <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-accent/70"
                    style={{ width: `${Math.max(2, ((h.pct_of_portfolio || 0) / maxPct) * 100)}%` }}
                  />
                </div>
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-[13px] font-semibold tabular-nums text-ink">
                {h.pct_of_portfolio != null ? `${h.pct_of_portfolio.toFixed(1)}%` : "—"}
              </span>
              <span className={`w-14 shrink-0 rounded border px-1.5 py-0.5 text-center text-[10px] font-medium ${ch.cls}`}>
                <T zh={ch.zh} en={ch.en} />
              </span>
            </Link>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-faint">
        <T
          zh="数据 = Dataroma 13F(季度披露,有 ~45 天滞后);占比为组合权重,非实时。「均」= 五方均分。共识 ≠ 正确,大佬也会一起踏空 · 非投资建议。"
          en="Data = Dataroma 13F (quarterly, ~45-day lag); weights are portfolio %, not live. 'avg' = five-master panel average. Consensus ≠ correct · not financial advice."
        />
      </p>
    </main>
  );
}
