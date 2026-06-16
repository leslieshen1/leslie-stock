import type { Metadata } from "next";
import StatsClient from "./StatsClient";

// 私密看板:不进搜索引擎、不进 sitemap。鉴权在 /api/stats-data(Bearer STATS_TOKEN)。
export const metadata: Metadata = {
  title: "Stats · 私密看板",
  robots: { index: false, follow: false },
};

export default function StatsPage() {
  return <StatsClient />;
}
