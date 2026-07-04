import PortfolioTabs from "./PortfolioTabs";
import HoldingsClient from "./HoldingsClient";
import { T } from "@/lib/i18n";

export const metadata = {
  title: "我的组合 · 观察列表 + 私人持仓 · 我不是股神",
  description: "观察列表(本机)+ 私人持仓(口令保护):买卖记录、实时收益、AI 持仓日报与平仓复盘。非投资建议。",
};

export default function PortfolioPage() {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-6xl px-6 pb-10 pt-3">
      <header className="mb-8 flex items-baseline justify-between border-b border-line pb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink"><T zh="我的组合" en="My Portfolio" /></h1>
          <p className="mt-1 text-sm text-muted">
            <T
              zh="观察列表存在你这台浏览器;持仓是口令保护的私密数据(录买卖 · 实时收益 · AI 日报 · 平仓复盘)"
              en="Watchlist lives in this browser; holdings are token-protected (trades · live P&L · AI daily note · closed-trade reviews)"
            />
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wider text-faint"><T zh="今日" en="Today" /></p>
          <p className="text-lg font-medium text-muted">{today}</p>
        </div>
      </header>

      <PortfolioTabs holdings={<HoldingsClient />} />

      <footer className="mt-16 border-t border-line pt-6 text-center text-xs text-faint">
        <T zh="我不是股神 · 私人数据仅口令可见 · 非投资建议" en="Not a Stock God · Private data behind your token · Not financial advice" />
      </footer>
    </main>
  );
}
