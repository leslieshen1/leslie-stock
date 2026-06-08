import type { OptionsGex } from "@/lib/options";

function fmt(v?: number | null): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

// 期权 Gamma 敞口 / GEX(Polygon)。只有高流动性标的有数据。
export default function OptionsGammaLine({ o }: { o: OptionsGex }) {
  const pos = (o.gex ?? 0) >= 0;
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-ink">期权 Gamma 敞口</span>
        <span className="text-[10px] text-faint">Polygon</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px]">
        <span className="text-faint">
          GEX{" "}
          <span className={`tnum font-semibold ${pos ? "text-up" : "text-down"}`}>
            {pos ? "+" : ""}{fmt(o.gex)}
          </span>
        </span>
        <span className="text-faint">看涨 γ <span className="tnum text-ink">{fmt(o.callGamma)}</span></span>
        <span className="text-faint">看跌 γ <span className="tnum text-ink">{fmt(o.putGamma)}</span></span>
        {o.spot != null && <span className="text-faint">现价 <span className="tnum text-ink">${o.spot}</span></span>}
        {o.contracts != null && <span className="text-faint">{o.contracts} 合约</span>}
      </div>
      <p className="mt-2 text-[11px] text-faint">
        GEX 正 = 做市商净多头 gamma,倾向压住波动;负 = 放大波动。
      </p>
    </div>
  );
}
