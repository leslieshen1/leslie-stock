import type { Fundamentals } from "@/lib/fundamentals";
import type { StockTypeKey } from "@/lib/stock-types";
import LiveValuation from "./LiveValuation";
import { T } from "@/lib/i18n";

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

type Cell = { key: string; zh: string; en: string; val: string };

export default function FundamentalsStrip({
  f,
  types,
  code,
  market,
}: {
  f: Fundamentals;
  types: StockTypeKey[];
  code: string;
  market: "a" | "hk" | "us" | "kr";
}) {
  const hi = new Set(HILITE[types[0]] || []);

  const cells: Cell[] = [
    { key: "pe", zh: "PE", en: "P/E", val: num(f.pe) },
    { key: "fpe", zh: "前瞻PE", en: "Fwd P/E", val: num(f.fpe) },
    { key: "ps", zh: "PS", en: "P/S", val: num(f.ps) },
    { key: "evE", zh: "EV/EBITDA", en: "EV/EBITDA", val: num(f.evE) },
    { key: "peg", zh: "PEG", en: "PEG", val: num(f.peg) },
    { key: "pb", zh: "PB", en: "P/B", val: num(f.pb) },
    { key: "gm", zh: "毛利率", en: "Gross Margin", val: pct(f.gm) },
    { key: "pm", zh: "净利率", en: "Net Margin", val: pct(f.pm) },
    { key: "roe", zh: "ROE", en: "ROE", val: pct(f.roe) },
    { key: "revG", zh: "营收增速", en: "Rev Growth", val: pct(f.revG) },
    { key: "divY", zh: "股息率", en: "Div Yield", val: f.divY == null ? "—" : `${f.divY}%` },
    { key: "beta", zh: "Beta", en: "Beta", val: num(f.beta) },
  ].filter((c) => c.val !== "—");

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-ink"><T zh="真实基本面" en="Fundamentals" /></span>
        <span className="text-[10px] text-faint"><T zh="高亮 = 这类股该重点看 · 数据 Yahoo · 估值随实时价" en="Highlighted = key metrics for this type · Data: Yahoo · valuation tracks live price" /></span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {cells.map((c) => {
          const on = hi.has(c.key);
          return (
            <div
              key={c.key}
              className={`rounded-lg border px-2.5 py-2 ${
                on ? "border-accent/40 bg-accent/5" : "border-line bg-surface-2"
              }`}
            >
              <div className={`text-[10px] ${on ? "text-accent" : "text-faint"}`}><T zh={c.zh} en={c.en} /></div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-ink">{c.val}</div>
            </div>
          );
        })}
      </div>

      <LiveValuation tgt={f.tgt} px={f.px} wkHi={f.wkHi} wkLo={f.wkLo} reco={f.reco} code={code} market={market} />
    </div>
  );
}
