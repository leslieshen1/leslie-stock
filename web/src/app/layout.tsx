import type { Metadata } from "next";
import "./globals.css";
import TopNav from "@/components/TopNav";
import { loadCoverage } from "@/lib/pulse-static";

export const metadata: Metadata = {
  title: "Leslie-stock · AI Pulse",
  description: "段永平 + 巴菲特方法论 · AI 产业链脉冲 + A/港/美股价值投资",
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
