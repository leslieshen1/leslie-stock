import type { MetadataRoute } from "next";
import { promises as fs } from "fs";
import path from "path";

// 全站 sitemap —— 静态页 + 全量个股(A 股 / 美股五方 / ETF)。上千个股页是长尾 SEO 主体。
// 注:个股详情页 bare /stock/{code} 默认按 A 股渲染,美股/ETF 必须带 ?market=us。
const BASE = "https://stockgod.xyz";

async function readData(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), "public", "data", file), "utf-8"));
  } catch {
    return null;
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticPaths = [
    "", "/scan", "/etf", "/whales", "/arena", "/reports", "/track-record",
    "/portfolio", "/watchlist", "/how-to-buy",
    "/about", "/terms", "/privacy",
    // 注:/pulse 已 307 跳转到首页,不收进 sitemap(避免喂搜索引擎自跳转 URL)
  ];
  const out: MetadataRoute.Sitemap = staticPaths.map((p) => ({
    url: BASE + p,
    lastModified: now,
    changeFrequency: p === "" ? "hourly" : "daily",
    priority: p === "" ? 1 : 0.7,
  }));

  // A 股(腾讯 manifest 全量)
  const aman = await readData("aleabit_manifest.json");
  if (Array.isArray(aman)) {
    for (const s of aman as { code?: string }[]) {
      if (s.code) out.push({ url: `${BASE}/stock/${s.code}`, lastModified: now, changeFrequency: "daily", priority: 0.5 });
    }
  }

  // 美股(五方已覆盖)
  const us = (await readData("us-panel-summary.json")) as { stocks?: Record<string, unknown> } | null;
  for (const code of us?.stocks ? Object.keys(us.stocks) : []) {
    out.push({ url: `${BASE}/stock/${encodeURIComponent(code)}?market=us`, lastModified: now, changeFrequency: "daily", priority: 0.5 });
  }

  // ETF
  const etf = (await readData("etf-analyses.json")) as { etfs?: { sym?: string }[] } | null;
  for (const e of etf?.etfs ?? []) {
    if (e.sym) out.push({ url: `${BASE}/stock/${encodeURIComponent(e.sym)}?market=us`, lastModified: now, changeFrequency: "weekly", priority: 0.4 });
  }

  return out;
}
