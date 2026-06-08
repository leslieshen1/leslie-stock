// 首页顶部宏观条：利率 / 三大指数 / VIX / 美元 / 油金 / BTC-ETH（数据 macro.json · Yahoo）
export type MacroSeries = {
  sym: string; name: string; kind: string; price: number; pct: number | null;
};

function fmtVal(s: MacroSeries): string {
  if (s.kind === "rate") return `${s.price.toFixed(2)}%`;
  if (s.price >= 1000) return Math.round(s.price).toLocaleString("en-US");
  return s.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MacroBar({ series }: { series: MacroSeries[] }) {
  if (!series?.length) return null;
  return (
    <div className="mb-7 overflow-x-auto rounded-xl border border-line bg-surface [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex items-center gap-x-4 whitespace-nowrap px-4 py-2.5 text-[12px]">
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-faint">宏观</span>
        {series.map((s) => {
          const up = (s.pct ?? 0) >= 0;
          return (
            <span key={s.sym} className="flex shrink-0 items-baseline gap-1.5 border-l border-line/50 pl-4 first:border-0 first:pl-0">
              <span className="text-muted">{s.name}</span>
              <span className="tnum font-medium text-ink">{fmtVal(s)}</span>
              {s.pct != null && (
                <span className={`tnum text-[11px] ${up ? "text-up" : "text-down"}`}>
                  {up ? "+" : ""}{s.pct.toFixed(2)}%
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
