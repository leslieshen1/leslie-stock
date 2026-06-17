import type { AFund } from "@/lib/a-fundamentals";
import { T } from "@/lib/i18n";

// A 股盘面数据条 —— 与美股「真实基本面」同款排版,补上 PE/PB/换手/振幅/今日高低。
const f2 = (v: number | null, suffix = "") => (v == null ? "—" : v.toFixed(2) + suffix);

export default function AStatsStrip({ f }: { f: AFund }) {
  const cells: { zh: string; en: string; val: string }[] = [
    { zh: "市盈率 TTM", en: "P/E (TTM)", val: f2(f.pe) },
    { zh: "市净率", en: "P/B", val: f2(f.pb) },
    { zh: "换手率", en: "Turnover", val: f2(f.turnover, "%") },
    { zh: "振幅", en: "Range", val: f2(f.amplitude, "%") },
    { zh: "今日最高", en: "Day High", val: f2(f.hi) },
    { zh: "今日最低", en: "Day Low", val: f2(f.lo) },
  ].filter((c) => c.val !== "—");
  if (!cells.length) return null;

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-ink"><T zh="盘面数据" en="Market Stats" /></span>
        <span className="text-[10px] text-faint"><T zh="数据 腾讯行情 · 实时" en="Data: Tencent quotes · live" /></span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {cells.map((c) => (
          <div key={c.en} className="rounded-lg border border-line bg-surface-2 px-2.5 py-2">
            <div className="text-[10px] text-faint"><T zh={c.zh} en={c.en} /></div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-ink">{c.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
