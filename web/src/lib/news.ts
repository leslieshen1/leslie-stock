import fs from "fs";
import path from "path";
import { safeCode, safeUnder } from "./sanitize";

export type NewsItem = { title: string; url: string; source: string; ts: string };

// 读 us-news/{sym}.json（按股切片，来自 fetchers/news_google.py · Google News）
export function loadNews(code: string): NewsItem[] {
  const c = safeCode(code);
  if (!c) return [];
  const base = path.join(process.cwd(), "public", "data", "us-news");
  for (const sym of [c, c.toUpperCase()]) {
    const p = safeUnder(base, `${sym}.json`);
    if (!p) continue;
    try {
      const items = JSON.parse(fs.readFileSync(p, "utf-8")) as NewsItem[];
      if (Array.isArray(items) && items.length) return items;
    } catch {
      /* next */
    }
  }
  return [];
}
