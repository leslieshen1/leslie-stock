import { promises as fs } from "fs";
import path from "path";
import { fetchWithTimeout } from "@/lib/api-guard";

// 板块热力(实时):跟着页面那条 /api/market 实时行情走 —— 市值加权算各板块当前涨跌。
// 不存快照、不靠 cron;你什么时候看就是什么时候的热力。带当前时段标签(盘前/盘中/盘后/休市)。
export const dynamic = "force-dynamic";

function etSession(): string {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return "休市";
  const m = et.getHours() * 60 + et.getMinutes();
  if (m >= 240 && m < 570) return "盘前";   // 04:00–09:30 ET
  if (m >= 570 && m < 960) return "盘中";    // 09:30–16:00
  if (m >= 960 && m < 1200) return "盘后";   // 16:00–20:00
  return "休市";
}

export async function GET(req: Request) {
  try {
    const p = path.join(process.cwd(), "public", "data", "us-stocks.json");
    const all: Record<string, unknown>[] = JSON.parse(await fs.readFile(p, "utf-8")).stocks || [];
    const sectorOf: Record<string, string> = {};
    for (const s of all) if (s.country === "United States" && s.sector) sectorOf[String(s.sym)] = String(s.sector);

    // 实时行情(同页面)。失败 → 用 us-stocks 静态 pct 兜底(标记 stale)。
    const origin = new URL(req.url).origin;
    const mkt = await fetchWithTimeout(`${origin}/api/market`, {}, 12000).then((x) => x.json()).catch(() => null);
    const live: Record<string, { pct: number | null; mcapB: number | null }> = mkt?.quotes || {};
    const haveLive = Object.keys(live).length > 0;

    const agg: Record<string, { cap: number; capPct: number }> = {};
    if (haveLive) {
      for (const [sym, q] of Object.entries(live)) {
        const sec = sectorOf[sym];
        if (!sec || q.pct == null || !(Number(q.mcapB) > 0)) continue;
        const a = (agg[sec] ||= { cap: 0, capPct: 0 });
        a.cap += Number(q.mcapB);
        a.capPct += Number(q.mcapB) * Number(q.pct);
      }
    } else {
      for (const s of all) {
        if (s.country !== "United States" || !s.sector || !(Number(s.mcapB) > 0) || s.pct == null) continue;
        const a = (agg[String(s.sector)] ||= { cap: 0, capPct: 0 });
        a.cap += Number(s.mcapB);
        a.capPct += Number(s.mcapB) * Number(s.pct);
      }
    }
    const sectors = Object.entries(agg)
      .map(([sector, a]) => ({ sector, capB: Math.round(a.cap), pct: a.cap ? Math.round((a.capPct / a.cap) * 100) / 100 : 0 }))
      .sort((x, y) => y.capB - x.capB);

    return Response.json(
      { sectors, session: etSession(), live: haveLive, ts: mkt?.ts || Date.now() },
      { headers: { "cache-control": "s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch {
    return Response.json({ sectors: [], session: "" });
  }
}
