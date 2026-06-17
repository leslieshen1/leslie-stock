import { promises as fs } from "fs";
import path from "path";

// 方块热力图数据:服务端读 us-stocks.json(1.3MB),只吐前端要的精简字段(top N by 市值)。
// 不把全量塞给前端;pct = 最近刷新的当日涨跌(refresh-data 管线)。
export const dynamic = "force-dynamic";

type Slim = { sym: string; name: string; mcapB: number; pct: number; sector: string };

export async function GET(req: Request) {
  const n = Math.min(800, Math.max(50, Number(new URL(req.url).searchParams.get("n")) || 500));
  try {
    const p = path.join(process.cwd(), "public", "data", "us-stocks.json");
    const j = JSON.parse(await fs.readFile(p, "utf-8"));
    const all: Record<string, unknown>[] = j.stocks || [];
    const rows: Slim[] = all
      .filter((s) => s.country === "United States" && Number(s.mcapB) > 0 && s.sector && s.pct != null)
      .sort((a, b) => Number(b.mcapB) - Number(a.mcapB))
      .slice(0, n)
      .map((s) => ({
        sym: String(s.sym),
        name: String(s.name || s.sym),
        mcapB: Math.round(Number(s.mcapB) * 10) / 10,
        pct: Math.round(Number(s.pct) * 100) / 100,
        sector: String(s.sector),
      }));
    return Response.json({ stocks: rows, n: rows.length, updated: j.updated || j.generated_at || null }, {
      headers: { "cache-control": "s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    return Response.json({ stocks: [], n: 0 });
  }
}
