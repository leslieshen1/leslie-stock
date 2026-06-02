import type { Metadata } from "next";
import "./globals.css";
import TopNav from "@/components/TopNav";
import WatchlistSidebar from "@/components/WatchlistSidebar";
import { loadCoverage } from "@/lib/pulse-static";

export const metadata: Metadata = {
  title: "我不是股神 · Not a Stock Guru",
  description: "AI 驱动的全景股票可视化平台。你不是股神，但股神陪你一起看股票。段巴 + Serenity 三方框架 · A 股 / 港股 / 美股 / 加密。",
};

// 全局数据健康（读 coverage.json）
async function loadHealth() {
  try {
    const cov = await loadCoverage();
    if (!cov.rows.length) return undefined;
    const live = cov.rows.filter((r) => r.ok > 0).length;
    return {
      liveCount: live,
      total: cov.rows.length,
      generatedAt: cov.snapshot_date ? `${cov.snapshot_date}T18:00:00Z` : null,
      ok: live / cov.rows.length > 0.95,
    };
  } catch {
    return undefined;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const health = await loadHealth();
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full bg-zinc-50 text-zinc-900">
        <TopNav health={health} />
        <WatchlistSidebar />
        {children}
        {/* 全站合规声明 */}
        <footer className="mt-16 border-t border-zinc-200 bg-white">
          <div className="mx-auto max-w-[1480px] px-6 py-6 text-center text-[11px] leading-relaxed text-zinc-400">
            <p className="font-medium text-zinc-500">
              本站不面向中国大陆用户 · This site is not intended for users in mainland China.
            </p>
            <p className="mt-1.5">
              所有内容为信息整理与个人研究记录,<strong className="text-zinc-500">非投资建议</strong>,不构成对任何证券、平台或交易所的要约或背书。
              股票、加密货币、代币化资产均涉及重大风险,可能损失全部本金。<strong className="text-zinc-500">风险请自行分辨与承担。</strong>
              页面含邀请链接(含返佣)。交易前请自行研究并确认所在司法管辖区的合规性。
            </p>
            <p className="mt-2 text-zinc-300">
              我不是股神 · Not a Stock Guru · 你不是股神,但股神陪你一起看股票
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
