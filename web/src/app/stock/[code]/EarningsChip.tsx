import type { EarningsEvent } from "@/lib/earnings";

const HOUR: Record<string, string> = { bmo: "盘前", amc: "盘后", dmh: "盘中" };

// 下次财报(Finnhub)。小 chip,放详情页顶部。
export default function EarningsChip({ e }: { e: EarningsEvent }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px]">
      <span className="text-faint">📅 下次财报</span>
      <span className="tnum font-medium text-ink">{e.date}</span>
      {e.hour && HOUR[e.hour] && <span className="text-muted">{HOUR[e.hour]}</span>}
      {e.epsEst != null && (
        <span className="text-faint">
          EPS 预期 <span className="tnum text-muted">{e.epsEst}</span>
        </span>
      )}
    </span>
  );
}
