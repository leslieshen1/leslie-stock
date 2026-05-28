import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

type ManifestItem = {
  code: string;
  name: string;
  market: "a" | "hk" | "us";
  market_cap_yi: number | null;
  sector: string;
  layer: number | null;
  score: number;
  verdict: string;
  verdict_label: string;
  signals_hit: number;
  thesis: string;
};

// 缓存 manifest（mtime 失效）
let CACHE: { items: ManifestItem[]; mtime: number } | null = null;

function loadManifest(): ManifestItem[] {
  const candidates = [
    path.join(process.cwd(), "data", "aleabit_manifest.json"),
    path.join(process.cwd(), "public", "data", "aleabit_manifest.json"),
    path.resolve(process.cwd(), "..", "data", "aleabit_manifest.json"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const stat = fs.statSync(p);
    if (CACHE && CACHE.mtime === stat.mtimeMs) return CACHE.items;
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as ManifestItem[];
      CACHE = { items: raw, mtime: stat.mtimeMs };
      return raw;
    } catch {
      // try next path
    }
  }
  return [];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const limit = Number(url.searchParams.get("limit") || "12");

  if (!q || q.length < 1) {
    return NextResponse.json({ results: [] });
  }

  const items = loadManifest();
  if (items.length === 0) {
    return NextResponse.json({
      results: [],
      warning: "manifest 不存在；运行 uv run python -m scripts.export_manifests",
    });
  }

  // 评分优先级：
  // 1. code 完全匹配
  // 2. code 前缀匹配（大小写不敏感）
  // 3. 名称包含
  // 4. 板块包含
  // 5. thesis 包含
  type Result = ManifestItem & { _score: number };
  const matched: Result[] = [];

  for (const s of items) {
    const code = s.code.toLowerCase();
    const name = s.name.toLowerCase();
    const sector = (s.sector || "").toLowerCase();
    const thesis = (s.thesis || "").toLowerCase();

    let rank = 0;
    if (code === q) rank = 1000;
    else if (code.startsWith(q)) rank = 900;
    else if (code.includes(q)) rank = 700;
    else if (name === q) rank = 850;
    else if (name.includes(q)) rank = 600;
    else if (sector.includes(q)) rank = 400;
    else if (thesis.includes(q)) rank = 300;

    if (rank > 0) {
      matched.push({ ...s, _score: rank + s.score * 0.1 + (s.market_cap_yi || 0) * 0.001 });
    }
  }

  matched.sort((a, b) => b._score - a._score);
  const results = matched.slice(0, limit).map(({ _score, ...rest }) => rest);

  return NextResponse.json({ results });
}
