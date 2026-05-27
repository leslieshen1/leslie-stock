import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { LESLIE_STOCK_ROOT } from "@/lib/data";

type StockBasic = {
  code: string;
  name: string;
  market: "a" | "hk";
  industry: string | null;
  market_cap: number | null;
};

// 缓存 universe，避免每次请求都重读
let UNIVERSE_CACHE: { stocks: StockBasic[]; mtime: number } | null = null;

function loadUniverseLight(): StockBasic[] {
  // universe.parquet 是 parquet 格式，Node 直接读比较麻烦
  // 简化方案：让 Python 在生成 rankings 时也同步导出 universe.json
  // 这里先 fallback 到读 rankings.json + portfolio.csv（已有的两个）
  const universeJsonPath = path.join(LESLIE_STOCK_ROOT, "data", "universe.json");
  if (fs.existsSync(universeJsonPath)) {
    const stat = fs.statSync(universeJsonPath);
    if (UNIVERSE_CACHE && UNIVERSE_CACHE.mtime === stat.mtimeMs) {
      return UNIVERSE_CACHE.stocks;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(universeJsonPath, "utf-8"));
      const stocks: StockBasic[] = raw.map((r: Record<string, unknown>) => ({
        code: String(r.code),
        name: String(r.name),
        market: String(r.market || "a").toLowerCase() as "a" | "hk",
        industry: (r.industry as string) || null,
        market_cap: (r.market_cap as number) || null,
      }));
      UNIVERSE_CACHE = { stocks, mtime: stat.mtimeMs };
      return stocks;
    } catch {
      return [];
    }
  }
  return [];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const limit = Number(url.searchParams.get("limit") || "10");

  if (!q || q.length < 1) {
    return NextResponse.json({ results: [] });
  }

  const stocks = loadUniverseLight();
  if (stocks.length === 0) {
    return NextResponse.json({
      results: [],
      warning: "universe.json 不存在，请跑 `uv run python -m fetchers.universe` 重新生成。",
    });
  }

  // 排序优先级：
  // 1. code 精确匹配
  // 2. code 前缀匹配
  // 3. name 包含
  // 4. industry 包含
  const exactCode: StockBasic[] = [];
  const codePrefix: StockBasic[] = [];
  const nameContains: StockBasic[] = [];
  const industryContains: StockBasic[] = [];

  for (const s of stocks) {
    const codeL = s.code.toLowerCase();
    const nameL = s.name.toLowerCase();
    const indL = (s.industry || "").toLowerCase();

    if (codeL === q) exactCode.push(s);
    else if (codeL.startsWith(q)) codePrefix.push(s);
    else if (nameL.includes(q)) nameContains.push(s);
    else if (indL.includes(q)) industryContains.push(s);
  }

  // 按市值排序每组
  const byCap = (a: StockBasic, b: StockBasic) =>
    (b.market_cap || 0) - (a.market_cap || 0);
  codePrefix.sort(byCap);
  nameContains.sort(byCap);
  industryContains.sort(byCap);

  const merged = [
    ...exactCode,
    ...codePrefix,
    ...nameContains,
    ...industryContains,
  ].slice(0, limit);

  return NextResponse.json({ results: merged });
}
