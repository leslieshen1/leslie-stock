import type { Metadata } from "next";
import "./globals.css";
import TopNav from "@/components/TopNav";
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
        {children}
      </body>
    </html>
  );
}
