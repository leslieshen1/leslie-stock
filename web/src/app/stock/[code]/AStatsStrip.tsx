import type { AFund } from "@/lib/a-fundamentals";

// A 股盘面数据条 —— 与美股「真实基本面」同款排版,补上 PE/PB/换手/振幅/今日高低。
const f2 = (v: number | null, suffix = "") => (v == null ? "—" : v.toFixed(2) + suffix);

export default function AStatsStrip({ f }: { f: AFund }) {
  const cells = [
    { label: "市盈率 TTM", val: f2(f.pe) },
    { label: "市净率", val: f2(f.pb) },
    { label: "换手率", val: f2(f.turnover, "%") },
    { label: "振幅", val: f2(f.amplitude, "%") },
    { label: "今日最高", val: f2(f.hi) },
    { label: "今日最低", val: f2(f.lo) },
  ].filter((c) => c.val !== "—");
  if (!cells.length) return null;

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-ink">盘面数据</span>
        <span className="text-[10px] text-faint">数据 腾讯行情 · 实时</span>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {cells.map((c) => (
          <div key={c.label} className="rounded-lg border border-line bg-surface-2 px-2.5 py-2">
            <div className="text-[10px] text-faint">{c.label}</div>
            <div className="mt-0.5 font-mono text-sm font-semibold text-ink">{c.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
