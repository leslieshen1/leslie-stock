import type { Fundamentals } from "@/lib/fundamentals";
import type { StockTypeKey } from "@/lib/stock-types";
import LiveValuation from "./LiveValuation";

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
  code,
  market,
}: {
  f: Fundamentals;
  types: StockTypeKey[];
  code: string;
  market: "a" | "hk" | "us";
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

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-ink">真实基本面</span>
        <span className="text-[10px] text-faint">高亮 = 这类股该重点看 · 数据 Yahoo · 估值随实时价</span>
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

      <LiveValuation tgt={f.tgt} px={f.px} wkHi={f.wkHi} wkLo={f.wkLo} reco={f.reco} code={code} market={market} />
    </div>
  );
}
