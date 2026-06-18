import Link from "next/link";
import { loadCoverage } from "@/lib/pulse-static";
import { COMPANIES } from "@/lib/supply-chain";
import { T } from "@/lib/i18n";

// 与 buildCoverageMatrix 输出兼容的本地 type
const FUND_FIELDS = [
 "trailingPE", "forwardPE", "priceToBook", "priceToSales",
 "roe", "roa", "profitMargin", "operatingMargin", "grossMargin",
 "fcfMargin", "revenueGrowth", "earningsGrowth", "debtToEquity",
] as const;
type FundField = (typeof FUND_FIELDS)[number];

interface CoverageRowVm {
  ticker: string;
  ok: number;
  error: string | null;
  hasMetrics: { valuation_pct: boolean; momentum_20d: boolean; rsi: boolean; sentiment: boolean };
  hasFundamentals: Record<FundField, boolean>;
  presentFields: number;
  totalFields: number;
}

export const metadata = {
 title: "数据覆盖矩阵 · AI 产业链脉冲",
};

const METRIC_KEYS = ["valuation_pct", "momentum_20d", "rsi", "sentiment"] as const;
const METRIC_LABELS: Record<(typeof METRIC_KEYS)[number], string> = {
 valuation_pct: "估值分位",
 momentum_20d: "20D 动量",
 rsi: "RSI",
 sentiment: "情绪",
};
const METRIC_LABELS_EN: Record<(typeof METRIC_KEYS)[number], string> = {
 valuation_pct: "Val. pctile",
 momentum_20d: "20D mom.",
 rsi: "RSI",
 sentiment: "Sentiment",
};

const FUND_LABELS: Record<FundField, string> = {
 trailingPE: "trail PE",
 forwardPE: "fwd PE",
 priceToBook: "P/B",
 priceToSales: "P/S",
 roe: "ROE",
 roa: "ROA",
 profitMargin: "净利率",
 operatingMargin: "经营利润率",
 grossMargin: "毛利率",
 fcfMargin: "FCF margin",
 revenueGrowth: "营收增速",
 earningsGrowth: "盈利增速",
 debtToEquity: "D/E",
};
const FUND_LABELS_EN: Record<FundField, string> = {
 trailingPE: "trail PE",
 forwardPE: "fwd PE",
 priceToBook: "P/B",
 priceToSales: "P/S",
 roe: "ROE",
 roa: "ROA",
 profitMargin: "Net margin",
 operatingMargin: "Op. margin",
 grossMargin: "Gross margin",
 fcfMargin: "FCF margin",
 revenueGrowth: "Rev. growth",
 earningsGrowth: "EPS growth",
 debtToEquity: "D/E",
};

function sortRows(rows: CoverageRowVm[]): CoverageRowVm[] {
  const order = new Map<string, number>();
  COMPANIES.forEach((c, i) => order.set(c.ticker, i));
  return [...rows].sort((a, b) => (order.get(a.ticker) ?? 999) - (order.get(b.ticker) ?? 999));
}

export default async function CoveragePage() {
  const cov = await loadCoverage();
  const date = cov.snapshot_date;

  // 把 JSON 行转成 VM（计算 presentFields）
  const rowsRaw: CoverageRowVm[] = cov.rows.map((r) => {
    const hasMetrics = {
      valuation_pct: !!r.metrics?.valuation_pct,
      momentum_20d:  !!r.metrics?.momentum_20d,
      rsi:           !!r.metrics?.rsi,
      sentiment:     !!r.metrics?.sentiment,
    };
    const hasFundamentals = Object.fromEntries(
      FUND_FIELDS.map((k) => [k, !!r.fundamentals?.[k]])
    ) as Record<FundField, boolean>;
    const present =
      Object.values(hasMetrics).filter(Boolean).length +
      Object.values(hasFundamentals).filter(Boolean).length;
    return {
      ticker: r.ticker,
      ok: r.ok,
      error: r.error,
      hasMetrics,
      hasFundamentals,
      presentFields: present,
      totalFields: 4 + FUND_FIELDS.length,
    };
  });
  const rows = sortRows(rowsRaw);
  const runs = cov.runs;

  // 聚合
  const total = rows.length;
  const fullOk = rows.filter((r) => r.ok === 1).length;
  const partial = rows.filter((r) => r.ok === 2).length;
  const failed = rows.filter((r) => r.ok === 0).length;

  // 每个字段的全样本覆盖率
  const fieldCoverage = (() => {
    const all: Record<string, { label: string; labelEn: string; count: number; pct: number }> = {};
    METRIC_KEYS.forEach((k) => {
      const c = rows.filter((r) => r.hasMetrics[k]).length;
      all[`m:${k}`] = { label: METRIC_LABELS[k], labelEn: METRIC_LABELS_EN[k], count: c, pct: total ? c / total : 0 };
    });
    FUND_FIELDS.forEach((k) => {
      const c = rows.filter((r) => r.hasFundamentals[k]).length;
      all[`f:${k}`] = { label: FUND_LABELS[k], labelEn: FUND_LABELS_EN[k], count: c, pct: total ? c / total : 0 };
    });
    return all;
  })();

  const tickerName = (tk: string) => COMPANIES.find((c) => c.ticker === tk)?.name ?? tk;
 const tickerLayer = (tk: string) => COMPANIES.find((c) => c.ticker === tk)?.layer ?? "?";
 const tickerRegion = (tk: string) => COMPANIES.find((c) => c.ticker === tk)?.region ?? "?";

  return (
 <main className="mx-auto max-w-[1480px] px-6 py-10">
 <header className="mb-6 border-b border-line pb-6">
 <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
 <h1 className="text-3xl font-semibold tracking-tight text-ink">
              <T zh="数据覆盖矩阵" en="Data Coverage Matrix" />
            </h1>
 <p className="mt-1 text-sm text-muted">
 <T zh="快照日期" en="Snapshot date" /> {date ?? "—"} · <T zh="每个 ticker × 每个字段一目了然" en="every ticker × every field at a glance" />
            </p>
          </div>
 <div className="flex items-center gap-3 text-xs">
 <span className="font-mono text-faint">SNAPSHOT</span>
 <span className="inline-flex items-center gap-1.5 rounded bg-up-soft text-up px-2.5 py-1 border border-up/30">
 <span className="h-1.5 w-1.5 rounded-full bg-up" />
              <T zh="完整" en="Full" /> {fullOk}
            </span>
 <span className="inline-flex items-center gap-1.5 rounded bg-accent-soft text-accent px-2.5 py-1 border border-accent/30">
              <T zh="部分" en="Partial" /> {partial}
            </span>
 <span className="inline-flex items-center gap-1.5 rounded bg-down-soft text-down px-2.5 py-1 border border-down/30">
              <T zh="失败" en="Failed" /> {failed}
            </span>
 <span className="font-mono text-faint">/ {total}</span>
          </div>
        </div>
      </header>

      {/* 最近 fetch_runs */}
 <section className="mb-8">
 <h2 className="text-sm font-semibold text-muted mb-2.5 font-mono uppercase tracking-wider">
          <T zh="最近抓取" en="Latest fetch" /> · Fetch Runs
        </h2>
 <div className="overflow-x-auto rounded-lg border border-line">
 <table className="w-full text-xs">
 <thead className="bg-surface text-muted">
              <tr>
 <th className="px-3 py-2 text-left font-medium"><T zh="日期" en="Date" /></th>
 <th className="px-3 py-2 text-left font-medium"><T zh="开始" en="Start" /></th>
 <th className="px-3 py-2 text-right font-medium"><T zh="总数" en="Total" /></th>
 <th className="px-3 py-2 text-right font-medium text-up"><T zh="完整" en="Full" /></th>
 <th className="px-3 py-2 text-right font-medium text-accent"><T zh="部分" en="Partial" /></th>
 <th className="px-3 py-2 text-right font-medium text-down"><T zh="失败" en="Failed" /></th>
 <th className="px-3 py-2 text-right font-medium"><T zh="耗时" en="Duration" /></th>
              </tr>
            </thead>
 <tbody className="bg-surface">
              {runs.map((r) => (
 <tr key={r.id} className="border-t border-line">
 <td className="px-3 py-2 font-mono">{r.run_date}</td>
 <td className="px-3 py-2 font-mono text-muted">{r.started_at.replace("T", " ").slice(0, 19)}</td>
 <td className="px-3 py-2 text-right tabular-nums">{r.total}</td>
 <td className="px-3 py-2 text-right tabular-nums text-up font-semibold">{r.ok_count}</td>
 <td className="px-3 py-2 text-right tabular-nums text-accent">{r.partial_count}</td>
 <td className="px-3 py-2 text-right tabular-nums text-down">{r.missing_count}</td>
 <td className="px-3 py-2 text-right font-mono text-muted">{r.duration_sec?.toFixed(1)}s</td>
                </tr>
              ))}
              {runs.length === 0 && (
 <tr><td colSpan={7} className="px-3 py-6 text-center text-faint"><T zh="还没有 fetch 记录" en="No fetch runs yet" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 字段覆盖率 */}
 <section className="mb-8">
 <h2 className="text-sm font-semibold text-muted mb-2.5 font-mono uppercase tracking-wider">
          <T zh="每字段覆盖率" en="Per-field coverage" />
        </h2>
 <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Object.entries(fieldCoverage).map(([k, v]) => {
            const pct = v.pct * 100;
 const color = pct >= 95 ? "bg-up" : pct >= 80 ? "bg-accent" : "bg-red-500";
 const txtColor = pct >= 95 ? "text-up" : pct >= 80 ? "text-accent" : "text-down";
            return (
 <div key={k} className="rounded-lg border border-line bg-surface p-3">
 <div className="flex items-baseline justify-between mb-1.5">
 <span className="text-xs text-muted truncate"><T zh={v.label} en={v.labelEn} /></span>
                  <span className={`font-mono text-xs font-semibold tabular-nums ${txtColor}`}>
                    {pct.toFixed(0)}%
                  </span>
                </div>
 <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                  <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                </div>
 <div className="mt-1 text-[10px] font-mono text-faint">{v.count}/{total}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 覆盖矩阵 */}
      <section>
 <h2 className="text-sm font-semibold text-muted mb-2.5 font-mono uppercase tracking-wider">
          Ticker × <T zh="字段 覆盖矩阵" en="field coverage matrix" />
        </h2>
 <div className="overflow-x-auto rounded-lg border border-line">
 <table className="w-full text-[11px] font-mono">
 <thead className="bg-surface text-muted sticky top-0">
              <tr>
 <th className="px-2 py-2 text-left font-medium min-w-[60px]">Ticker</th>
 <th className="px-2 py-2 text-left font-medium min-w-[120px]"><T zh="名称" en="Name" /></th>
 <th className="px-2 py-2 text-left font-medium">L</th>
 <th className="px-2 py-2 text-left font-medium"><T zh="区" en="Reg." /></th>
 <th className="px-2 py-2 text-center font-medium">ok</th>
                {METRIC_KEYS.map((k) => (
 <th key={k} className="px-1 py-2 text-center font-medium min-w-[40px]" title={METRIC_LABELS[k]}>
                    <T zh={METRIC_LABELS[k].slice(0, 4)} en={METRIC_LABELS_EN[k].slice(0, 4)} />
                  </th>
                ))}
                {FUND_FIELDS.map((k) => (
 <th key={k} className="px-1 py-2 text-center font-medium min-w-[40px]" title={FUND_LABELS[k]}>
                    <T zh={FUND_LABELS[k]} en={FUND_LABELS_EN[k]} />
                  </th>
                ))}
 <th className="px-2 py-2 text-right font-medium"><T zh="完整度" en="Coverage" /></th>
              </tr>
            </thead>
 <tbody className="bg-surface">
              {rows.map((r) => {
                const completeness = r.presentFields / r.totalFields;
                const completenessColor =
 completeness >= 0.9 ? "text-up" :
 completeness >= 0.7 ? "text-accent" : "text-down";
                return (
 <tr key={r.ticker} className="border-t border-line hover:bg-surface-2">
 <td className="px-2 py-1.5 font-semibold text-ink">{r.ticker}</td>
 <td className="px-2 py-1.5 text-muted truncate max-w-[140px]">{tickerName(r.ticker)}</td>
 <td className="px-2 py-1.5 text-faint">{tickerLayer(r.ticker)}</td>
 <td className="px-2 py-1.5 text-faint">{tickerRegion(r.ticker)}</td>
 <td className="px-2 py-1.5 text-center">
                      {r.ok === 1 ? <Cell good /> : r.ok === 2 ? <Cell partial /> : <Cell bad />}
                    </td>
                    {METRIC_KEYS.map((k) => (
 <td key={k} className="px-1 py-1.5 text-center">
                        {r.hasMetrics[k] ? <Cell good /> : <Cell missing />}
                      </td>
                    ))}
                    {FUND_FIELDS.map((k) => (
 <td key={k} className="px-1 py-1.5 text-center">
                        {r.hasFundamentals[k] ? <Cell good /> : <Cell missing />}
                      </td>
                    ))}
                    <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${completenessColor}`}>
                      {(completeness * 100).toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

 <footer className="mt-12 border-t border-line pt-6 text-center text-xs text-faint">
        <T zh="行情数据每日更新 · 缺 PE 多为亏损公司，缺其他字段需要 akshare 兜底" en="Market data refreshed daily · missing PE is usually loss-making firms; other gaps fall back to akshare" />
      </footer>
    </main>
  );
}

// ---- 单元格视觉 ----
function Cell({ good, partial, bad, missing }: { good?: boolean; partial?: boolean; bad?: boolean; missing?: boolean }) {
 if (good) return <span className="inline-block w-3 h-3 rounded-sm bg-up" />;
 if (partial) return <span className="inline-block w-3 h-3 rounded-sm bg-accent" />;
 if (bad) return <span className="inline-block w-3 h-3 rounded-sm bg-red-500" />;
 return <span className="inline-block w-3 h-3 rounded-sm bg-line" />;
}
