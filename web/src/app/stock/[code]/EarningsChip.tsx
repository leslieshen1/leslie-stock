import type { EarningsEvent } from "@/lib/earnings";
import { T } from "@/lib/i18n";

const HOUR: Record<string, { zh: string; en: string }> = {
  bmo: { zh: "盘前", en: "Pre-market" },
  amc: { zh: "盘后", en: "After-hours" },
  dmh: { zh: "盘中", en: "Mid-session" },
};

// 下次财报(Finnhub)。小 chip,放详情页顶部。
export default function EarningsChip({ e }: { e: EarningsEvent }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px]">
      <span className="text-faint">📅 <T zh="下次财报" en="Next Earnings" /></span>
      <span className="tnum font-medium text-ink">{e.date}</span>
      {e.hour && HOUR[e.hour] && <span className="text-muted"><T zh={HOUR[e.hour].zh} en={HOUR[e.hour].en} /></span>}
      {e.epsEst != null && (
        <span className="text-faint">
          <T zh="EPS 预期" en="EPS Est." /> <span className="tnum text-muted">{e.epsEst}</span>
        </span>
      )}
    </span>
  );
}
