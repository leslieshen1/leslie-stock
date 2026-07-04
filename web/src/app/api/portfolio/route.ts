// 个人持仓 API(私密:Bearer STATS_TOKEN,同 /stats 口令)。
// GET  → 全量:流水/持仓聚合/平仓段/日报/复盘/NAV(现价由前端拉 QUOTE_URL 自算,这里不打行情)
// POST → {action:"trade", trade} 录一笔 | {action:"deleteTrade", id} 删一笔(录错撤销)
//        | {action:"nav", date, slices} 前端每日回传市值快照(拿到实时价后打点)
// 存储 Upstash(redis(),env 已有);未接存储 → {connected:false} 优雅降级。
import { redis } from "@/lib/stats";
import { statsAuthed as authed } from "@/lib/api-guard";
import { PF, aggregate, validateTrade, type Trade } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

async function readJson<T>(r: NonNullable<ReturnType<typeof redis>>, key: string, fallback: T): Promise<T> {
  try {
    const v = await r.get<string | T>(key);
    if (v == null) return fallback;
    return typeof v === "string" ? (JSON.parse(v) as T) : (v as T);
  } catch {
    return fallback;
  }
}

export async function GET(req: Request) {
  if (!authed(req)) return new Response("unauthorized", { status: 401 });
  const r = redis();
  if (!r) return Response.json({ connected: false });
  try {
    const [trades, daily, reviews, nav] = await Promise.all([
      readJson<Trade[]>(r, PF.trades, []),
      readJson<unknown[]>(r, PF.daily, []),
      readJson<unknown[]>(r, PF.reviews, []),
      readJson<unknown[]>(r, PF.nav, []),
    ]);
    const { positions, lots } = aggregate(trades);
    return Response.json({
      connected: true,
      trades: [...trades].sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts),
      positions, lots, daily, reviews, nav,
      aiReady: !!(process.env.NDT_CLAUDE_KEY || process.env.NDT_API_KEY),
      generatedAt: Date.now(),
    });
  } catch {
    return Response.json({ error: true }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!authed(req)) return new Response("unauthorized", { status: 401 });
  const r = redis();
  if (!r) return Response.json({ connected: false }, { status: 503 });

  let body: { action?: string; trade?: Partial<Trade>; id?: string; date?: string; slices?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  try {
    const trades = await readJson<Trade[]>(r, PF.trades, []);

    if (body.action === "trade" && body.trade) {
      const t = body.trade;
      const err = validateTrade(t, trades);
      if (err) return Response.json({ error: err }, { status: 400 });
      const rec: Trade = {
        id: "t" + Date.now().toString(36),
        market: t.market!, sym: String(t.sym).toUpperCase().trim(),
        name: (t.name || "").slice(0, 40) || undefined,
        side: t.side!, price: t.price!, qty: t.qty!,
        date: t.date!, reason: (t.reason || "").slice(0, 400) || undefined,
        ts: Date.now(),
      };
      trades.push(rec);
      await r.set(PF.trades, JSON.stringify(trades));
      // 平仓检测:这笔 SELL 是否清零了该标的 → 返回 lot,前端据此自动触发复盘生成
      const { lots } = aggregate(trades);
      const closed = rec.side === "SELL" ? lots.find((l) => l.lotId === rec.id) || null : null;
      return Response.json({ ok: true, trade: rec, closedLot: closed });
    }

    if (body.action === "deleteTrade" && body.id) {
      const next = trades.filter((t) => t.id !== body.id);
      if (next.length === trades.length) return Response.json({ error: "not found" }, { status: 404 });
      await r.set(PF.trades, JSON.stringify(next));
      return Response.json({ ok: true });
    }

    if (body.action === "nav" && body.date && body.slices) {
      const nav = await readJson<{ date: string; slices: unknown }[]>(r, PF.nav, []);
      const i = nav.findIndex((x) => x.date === body.date);
      const rec = { date: body.date, slices: body.slices };
      if (i >= 0) nav[i] = rec; else nav.push(rec);
      nav.sort((a, b) => a.date.localeCompare(b.date));
      await r.set(PF.nav, JSON.stringify(nav.slice(-370))); // 留约一年
      return Response.json({ ok: true });
    }

    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch {
    return Response.json({ error: true }, { status: 500 });
  }
}
