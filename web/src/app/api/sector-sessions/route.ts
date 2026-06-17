import { promises as fs } from "fs";
import path from "path";
import { redis } from "@/lib/stats";

// 板块·三段:今日(盘中)= us-stocks 按市值加权的板块涨跌(现成,日更);
// 盘前/盘后 = Upstash 里当天的快照(/api/cron/sector-snapshot 一天三次写),没拍到就 null。
export const dynamic = "force-dynamic";

type SectorRow = { sector: string; capB: number; mid: number; pre: number | null; post: number | null };

export async function GET() {
  try {
    const p = path.join(process.cwd(), "public", "data", "us-stocks.json");
    const all: Record<string, unknown>[] = JSON.parse(await fs.readFile(p, "utf-8")).stocks || [];
    const agg: Record<string, { cap: number; capPct: number }> = {};
    for (const s of all) {
      if (s.country !== "United States" || !s.sector || !(Number(s.mcapB) > 0) || s.pct == null) continue;
      const a = (agg[String(s.sector)] ||= { cap: 0, capPct: 0 });
      a.cap += Number(s.mcapB);
      a.capPct += Number(s.mcapB) * Number(s.pct);
    }

    // 盘前/盘后快照(Upstash,可选)
    let pre: Record<string, number> = {};
    let post: Record<string, number> = {};
    const r = redis();
    if (r) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const h = await r.hgetall<Record<string, string>>(`sg:sect:${today}`);
        if (h?.pre) pre = typeof h.pre === "string" ? JSON.parse(h.pre) : (h.pre as unknown as Record<string, number>);
        if (h?.post) post = typeof h.post === "string" ? JSON.parse(h.post) : (h.post as unknown as Record<string, number>);
      } catch {
        /* 没快照 → 空 */
      }
    }

    const sectors: SectorRow[] = Object.entries(agg)
      .map(([sector, a]) => ({
        sector,
        capB: Math.round(a.cap),
        mid: a.cap ? Math.round((a.capPct / a.cap) * 100) / 100 : 0,
        pre: pre[sector] != null ? Math.round(pre[sector] * 100) / 100 : null,
        post: post[sector] != null ? Math.round(post[sector] * 100) / 100 : null,
      }))
      .sort((x, y) => y.capB - x.capB);

    return Response.json({ sectors, ts: Date.now() }, { headers: { "cache-control": "s-maxage=120, stale-while-revalidate=600" } });
  } catch {
    return Response.json({ sectors: [] });
  }
}
