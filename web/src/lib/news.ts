import fs from "fs";
import path from "path";

export type NewsItem = { title: string; url: string; source: string; ts: string };

// 读 us-news/{sym}.json（按股切片，来自 fetchers/news_google.py · Google News）
export function loadNews(code: string): NewsItem[] {
  for (const sym of [code, code.toUpperCase()]) {
    try {
      const p = path.join(process.cwd(), "public", "data", "us-news", `${sym}.json`);
      const items = JSON.parse(fs.readFileSync(p, "utf-8")) as NewsItem[];
      if (Array.isArray(items) && items.length) return items;
    } catch {
      /* next */
    }
  }
  return [];
}
