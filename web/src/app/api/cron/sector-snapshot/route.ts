import { promises as fs } from "fs";
import path from "path";
import { redis } from "@/lib/stats";
import { fetchWithTimeout } from "@/lib/api-guard";

// 板块快照:cron-job.org 在 盘前/收盘/盘后 各打一次(?session=pre|mid|post),
// 算各板块市值加权涨跌(/api/market 实时 × us-stocks 板块),存 Upstash sg:sect:{美东日期}。
// 鉴权:Authorization: Bearer ${CRON_SECRET}(同其它 cron 路由)。
export const dynamic = "force-dynamic";

// 按美东日期归一(三段都落同一天的 key;盘后是 00:05 UTC 次日,但 ET 仍是同一交易日)
function etDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, error: "CRON_SECRET 未配置" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });

  const session = new URL(req.url).searchParams.get("session");
  if (session !== "pre" && session !== "mid" && session !== "post") {
    return Response.json({ ok: false, error: "session 必须是 pre|mid|post" }, { status: 400 });
  }
  const r = redis();
  if (!r) return Response.json({ ok: false, error: "Upstash 未接" }, { status: 503 });

  try {
    // 板块映射(us-stocks)
    const p = path.join(process.cwd(), "public", "data", "us-stocks.json");
    const all: Record<string, unknown>[] = JSON.parse(await fs.readFile(p, "utf-8")).stocks || [];
    const sectorOf: Record<string, string> = {};
    for (const s of all) {
      if (s.country === "United States" && s.sector) sectorOf[String(s.sym)] = String(s.sector);
    }

    // 实时报价(自家 /api/market,当下那一段)
    const origin = new URL(req.url).origin;
    const mkt = await fetchWithTimeout(`${origin}/api/market`, {}, 15000).then((x) => x.json()).catch(() => ({ quotes: {} }));
    const quotes: Record<string, { pct: number | null; mcapB: number | null }> = mkt.quotes || {};

    // 市值加权各板块涨跌
    const agg: Record<string, { cap: number; capPct: number }> = {};
    for (const [sym, q] of Object.entries(quotes)) {
      const sec = sectorOf[sym];
      if (!sec || q.pct == null || !(Number(q.mcapB) > 0)) continue;
      const a = (agg[sec] ||= { cap: 0, capPct: 0 });
      a.cap += Number(q.mcapB);
      a.capPct += Number(q.mcapB) * Number(q.pct);
    }
    const sectorPct: Record<string, number> = {};
    for (const [sec, a] of Object.entries(agg)) if (a.cap) sectorPct[sec] = Math.round((a.capPct / a.cap) * 100) / 100;

    if (Object.keys(sectorPct).length === 0) {
      return Response.json({ ok: false, error: "实时报价为空,未写入" }, { status: 502 });
    }
    const key = `sg:sect:${etDate()}`;
    await r.hset(key, { [session]: JSON.stringify(sectorPct) });
    await r.expire(key, 60 * 60 * 24 * 8);
    return Response.json({ ok: true, session, date: etDate(), sectors: Object.keys(sectorPct).length });
  } catch (e) {
    return Response.json({ ok: false, error: String(e).slice(0, 200) }, { status: 502 });
  }
}
