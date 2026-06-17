import { promises as fs } from "fs";
import path from "path";

// 个股分类(AI 判读):sym → 大板块 seg / 主子板块 sub / 第二子板块 sub2(非主营,详情页打标签用)。
// 源 web/public/data/us-class.json(scripts/dedup_market_cap.py 产出)。模块级缓存,避免每次详情页解析。
export type UsClass = { seg?: string; sub?: string; sub2?: string | null };

let _cache: Record<string, UsClass> | null = null;

async function loadAll(): Promise<Record<string, UsClass>> {
  if (_cache) return _cache;
  try {
    const p = path.join(process.cwd(), "public", "data", "us-class.json");
    _cache = JSON.parse(await fs.readFile(p, "utf-8"));
  } catch {
    _cache = {};
  }
  return _cache!;
}

export async function loadUsClass(code: string): Promise<UsClass | null> {
  const all = await loadAll();
  return all[code.toUpperCase()] || null;
}
