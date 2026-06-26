import { redis, K, datesAsc, addDays } from "@/lib/stats";
import { safeEqual } from "@/lib/api-guard";
import type { Redis } from "@upstash/redis";

// 私密看板数据源。Bearer token(STATS_TOKEN)鉴权;没接存储 → {connected:false}。
export const dynamic = "force-dynamic";

function authed(req: Request): boolean {
  const want = process.env.STATS_TOKEN;
  if (!want) return false;
  const h = req.headers.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : new URL(req.url).searchParams.get("key") || "";
  return tok.length > 0 && safeEqual(tok, want);
}

// 多个每日 ZSET 聚合出 Top N(label→总次数)
async function aggTop(r: Redis, keys: string[], topN: number): Promise<{ label: string; n: number }[]> {
  const m = new Map<string, number>();
  await Promise.all(
    keys.map(async (k) => {
      const arr = (await r.zrange(k, 0, -1, { withScores: true })) as (string | number)[];
      for (let i = 0; i < arr.length; i += 2) {
        const label = String(arr[i]);
        const score = Number(arr[i + 1]) || 0;
        m.set(label, (m.get(label) || 0) + score);
      }
    })
  );
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([label, n]) => ({ label, n }));
}

export async function GET(req: Request) {
  // 无鉴权健康检查:分别探读/写并暴露上游错误,便于定位 rw 故障真因(只读 token / auth / url 不匹配 等)。
  if (new URL(req.url).searchParams.get("health") === "1") {
    const rh = redis();
    if (!rh) return Response.json({ connected: false });
    let read = false, write = false, err: string | null = null;
    try { await rh.get("sg:health"); read = true; } catch (e) { err = String((e as Error)?.message || e).slice(0, 240); }
    try {
      const tok = `ok-${Date.now()}`;
      await rh.set("sg:health", tok, { ex: 60 });
      write = (await rh.get<string>("sg:health")) === tok;
    } catch (e) { err = String((e as Error)?.message || e).slice(0, 240); }
    return Response.json({ connected: true, read, write, rw: read && write, err });
  }

  if (!authed(req)) return new Response("unauthorized", { status: 401 });
  const r = redis();
  if (!r) return Response.json({ connected: false });

  // 先探一次读:能读就放行显示(即便埋点写不进、数据断档,历史仍可看);彻底读不了才回 rw:false
  try {
    await r.get<string>("sg:health");
  } catch {
    return Response.json({ connected: true, rw: false });
  }

  try {
  const url = new URL(req.url);
  const days = Math.min(60, Math.max(7, Number(url.searchParams.get("days")) || 30));
  const asc = datesAsc(days); // 旧 → 新
  const today = asc[asc.length - 1];

  // 每日 DAU / 新用户 / PV(并行)
  const [dauCounts, newCounts, pvCounts] = await Promise.all([
    Promise.all(asc.map((d) => r.scard(K.dau(d)))),
    Promise.all(asc.map((d) => r.scard(K.cohort(d)))),
    Promise.all(asc.map((d) => r.get<number | string>(K.pv(d)))),
  ]);
  const series = asc.map((d, i) => ({
    date: d,
    dau: Number(dauCounts[i]) || 0,
    nw: Number(newCounts[i]) || 0,
    pv: Number(pvCounts[i]) || 0,
  }));

  // 留存三角:最近 14 个 cohort × Day 0..7
  const COHORTS = 14;
  const MAXN = 7;
  const cohortDates = asc.slice(-COHORTS);
  const retention = await Promise.all(
    cohortDates.map(async (c0) => {
      const members = await r.smembers(K.cohort(c0));
      const size = members.length;
      const row = await Promise.all(
        Array.from({ length: MAXN + 1 }, async (_, n) => {
          const dN = addDays(c0, n);
          if (dN > today || size === 0) return { dayN: n, pct: null as number | null, n: 0 };
          if (n === 0) return { dayN: 0, pct: 100, n: size };
          const flags = (await r.smismember(K.dau(dN), members)) as number[];
          const hit = flags.reduce((a, b) => a + (Number(b) ? 1 : 0), 0);
          return { dayN: n, pct: Math.round((hit / size) * 100), n: hit };
        })
      );
      return { cohort: c0, size, row };
    })
  );

  // 近 7 天 Top 页面 / Top 点击 / Top 来源
  const wk = asc.slice(-7);
  const [topPages, topClicks, topReferrers] = await Promise.all([
    aggTop(r, wk.map(K.pvPages), 12),
    aggTop(r, wk.map(K.clicks), 14),
    aggTop(r, wk.map(K.referrers), 12),
  ]);

  return Response.json({
    connected: true,
    days,
    series,
    retention,
    topPages,
    topClicks,
    topReferrers,
    generatedAt: Date.now(),
  });
  } catch {
    return Response.json({ error: true }, { status: 500 });
  }
}
