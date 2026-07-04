import HoldingsClient from "./HoldingsClient";

// Leslie 的私人持仓终端(不进导航、不收录):口令同 /stats,Finviz 式深色高密度,配色独立于站点主题。
// force-dynamic:私密页别被 CDN/浏览器缓存旧页面壳;「今日」日期也不被静态化冻结。
export const dynamic = "force-dynamic";
export const metadata = {
  title: "持仓",
  robots: { index: false, follow: false },
};

export default function LesliePage() {
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10); // 北京日
  return (
    <main className="mx-auto max-w-[1240px] px-2 pb-8 pt-2 sm:px-4">
      <div className="rounded-lg border border-[#262b35] bg-[#101216] p-3 shadow-2xl sm:p-4">
        <header className="mb-3 flex items-baseline justify-between border-b border-[#262b35] pb-2.5">
          <h1 className="text-[13px] font-semibold uppercase tracking-[0.3em] text-[#d6dbe4]">持仓 · Terminal</h1>
          <p className="font-mono text-[11px] tabular-nums text-[#5a6372]">{today}</p>
        </header>
        <HoldingsClient />
      </div>
    </main>
  );
}
