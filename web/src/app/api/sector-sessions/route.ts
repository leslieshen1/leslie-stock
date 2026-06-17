import { promises as fs } from "fs";
import path from "path";
import { redis } from "@/lib/stats";

// 板块·三段读取:有当天快照 → 盘前/盘中/盘后(Upstash,美东日期);
// 完全没快照 → 只回退一列「最近收盘」(us-stocks 市值加权),不冒充。
export const dynamic = "force-dynamic";

type SectorRow = { sector: string; capB: number; mid: number | null; pre: number | null; post: number | null };

function etDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

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
    const usWeighted: Record<string, number> = {};
    for (const [sec, a] of Object.entries(agg)) if (a.cap) usWeighted[sec] = Math.round((a.capPct / a.cap) * 100) / 100;

    let pre: Record<string, number> | null = null;
    let midSnap: Record<string, number> | null = null;
    let post: Record<string, number> | null = null;
    const r = redis();
    if (r) {
      try {
        const h = await r.hgetall<Record<string, unknown>>(`sg:sect:${etDate()}`);
        const parse = (v: unknown): Record<string, number> | null =>
          typeof v === "string" ? JSON.parse(v) : v && typeof v === "object" ? (v as Record<string, number>) : null;
        if (h) {
          pre = parse(h.pre);
          midSnap = parse(h.mid);
          post = parse(h.post);
        }
      } catch {
        /* 没快照 */
      }
    }
    const anySnap = !!(pre || midSnap || post);

    const sectors: SectorRow[] = Object.entries(agg)
      .map(([sector, a]) => ({
        sector,
        capB: Math.round(a.cap),
        mid: anySnap ? (midSnap?.[sector] ?? null) : (usWeighted[sector] ?? null),
        pre: pre?.[sector] ?? null,
        post: post?.[sector] ?? null,
      }))
      .sort((x, y) => y.capB - x.capB);

    return Response.json({ sectors, anySnap, ts: Date.now() }, { headers: { "cache-control": "s-maxage=120, stale-while-revalidate=600" } });
  } catch {
    return Response.json({ sectors: [] });
  }
}
