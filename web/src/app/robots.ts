import type { MetadataRoute } from "next";

// 允许全站抓取(API 除外),指向 sitemap。
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    sitemap: "https://stockgod.xyz/sitemap.xml",
    host: "https://stockgod.xyz",
  };
}
