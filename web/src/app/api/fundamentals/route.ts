// 单只基本面(热力图详情面板按需拉)。原来全量 fundamentals 塞进首页 HTML 是 4.4MB 大头之一;
// 改成选中某粒子时才拉这一只(见审计 B2)。数据是静态文件,长缓存。
import { promises as fs } from "fs";
import path from "path";
import { clientIp, rateLimit, tooMany } from "@/lib/api-guard";
import { safeCode } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

type Compact = {
  pe?: number; fpe?: number; pb?: number; ps?: number; roe?: number; pm?: number;
  gm?: number; revG?: number; earnG?: number; de?: number; divY?: number; beta?: number;
};

let MAP: Record<string, Compact> | null = null;
async function load(): Promise<Record<string, Compact>> {
  if (MAP) return MAP;
  try {
    const p = path.join(process.cwd(), "public", "data", "us-fundamentals.json");
    MAP = (JSON.parse(await fs.readFile(p, "utf-8")).stocks || {}) as Record<string, Compact>;
  } catch {
    MAP = {};
  }
  return MAP;
}

// 与 page.tsx 的 mapFund 同款:紧凑 key → 详情面板用的字段(divY 还原成小数)
function mapFund(f: Compact) {
  return {
    trailingPE: f.pe, forwardPE: f.fpe, priceToBook: f.pb, priceToSales: f.ps,
    roe: f.roe, profitMargin: f.pm, grossMargin: f.gm,
    revenueGrowth: f.revG, earningsGrowth: f.earnG, debtToEquity: f.de,
    dividendYield: f.divY != null ? f.divY / 100 : undefined, beta: f.beta,
  };
}

export async function GET(req: Request) {
  const rl = rateLimit(`fund:${clientIp(req)}`, 240, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfter);

  const syms = (new URL(req.url).searchParams.get("syms") || "")
    .split(",")
    .map((s) => safeCode(s.trim()))
    .filter((s): s is string => !!s)
    .slice(0, 50);
  const map = await load();
  const out: Record<string, ReturnType<typeof mapFund>> = {};
  for (const s of syms) {
    const v = map[s] || map[s.toUpperCase()];
    if (v) out[s.toUpperCase()] = mapFund(v);
  }
  return Response.json(
    { fundamentals: out },
    // 源是日更静态文件:之前 1h/24h-SWR 让边缘最长服务 24h 陈旧 PE/PB。收紧到 5min,贴近日更节奏
    { headers: { "cache-control": "s-maxage=300, stale-while-revalidate=600" } },
  );
}
