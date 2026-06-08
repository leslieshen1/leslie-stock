import type { Fundamentals } from "@/lib/fundamentals";
import type { StockTypeKey } from "@/lib/stock-types";

// 每类股"该重点看"的基本面 key（与 StockTypeCard 的 watch 呼应，这里给真值并高亮）
const HILITE: Partial<Record<StockTypeKey, string[]>> = {
  growth: ["ps", "revG", "gm"],
  value: ["pe", "pb", "divY"],
  moat: ["roe", "gm", "pe"],
  cyclical: ["evE", "pb", "ps"],
  defensive: ["divY", "pe", "pm"],
};

const pct = (v?: number) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const num = (v?: number) => (v == null ? "—" : v.toFixed(1));

type Cell = { key: string; label: string; val: string };

export default function FundamentalsStrip({
  f,
  types,
}: {
  f: Fundamentals;
  types: StockTypeKey[];
}) {
  const hi = new Set(HILITE[types[0]] || []);

  const cells: Cell[] = [
    { key: "pe", label: "PE", val: num(f.pe) },
    { key: "fpe", label: "前瞻PE", val: num(f.fpe) },
    { key: "ps", label: "PS", val: num(f.ps) },
    { key: "evE", label: "EV/EBITDA", val: num(f.evE) },
    { key: "peg", label: "PEG", val: num(f.peg) },
    { key: "pb", label: "PB", val: num(f.pb) },
    { key: "gm", label: "毛利率", val: pct(f.gm) },
    { key: "pm", label: "净利率", val: pct(f.pm) },
    { key: "roe", label: "ROE", val: pct(f.roe) },
    { key: "revG", label: "营收增速", val: pct(f.revG) },
    { key: "divY", label: "股息率", val: f.divY == null ? "—" : `${f.divY}%` },
    { key: "beta", label: "Beta", val: num(f.beta) },
  ].filter((c) => c.val !== "—");

  const upside =
    f.tgt && f.px ? Math.round(((f.tgt - f.px) / f.px) * 100) : null;
  const pos =
    f.px && f.wkHi && f.wkLo && f.wkHi > f.wkLo
      ? Math.max(0, Math.min(1, (f.px - f.wkLo) / (f.wkHi - f.wkLo)))
      : null;
  const RECO: Record<string, string> = {
    strong_buy: "强烈买入", buy: "买入", hold: "持有", sell: "卖出", strong_sell: "强烈卖出",
  };

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-ink">真实基本面</span>
        <span className="text-[10px] text-faint">高亮 = 这类股该重点看 · 数据 Yahoo</span>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {cells.map((c) => {
          const on = hi.has(c.key);
          return (
            <div
              key={c.key}
              className={`rounded-lg border px-2.5 py-2 ${
                on ? "border-accent/40 bg-accent/5" : "border-line bg-surface-2"
              }`}
            >
              <div className={`text-[10px] ${on ? "text-accent" : "text-faint"}`}>{c.label}</div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-ink">{c.val}</div>
            </div>
          );
        })}
      </div>

      {(upside != null || pos != null || f.reco) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          {upside != null && (
            <span className="text-muted">
              分析师目标 <span className="font-mono text-ink">${f.tgt}</span>{" "}
              <span className={upside >= 0 ? "text-up" : "text-down"}>
                ({upside >= 0 ? "+" : ""}
                {upside}%)
              </span>
            </span>
          )}
          {f.reco && RECO[f.reco] && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
              {RECO[f.reco]}
            </span>
          )}
          {pos != null && (
            <span className="flex items-center gap-2 text-faint">
              52周
              <span className="relative h-1.5 w-24 rounded-full bg-surface-2">
                <span
                  className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
                  style={{ left: `${pos * 100}%` }}
                />
              </span>
              <span className="font-mono text-ink">{Math.round(pos * 100)}%</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
