import { redis, K, dayKey } from "@/lib/stats";

// 公开埋点入口(像任何分析 beacon)。匿名 ID 由前端 localStorage 生成,无 cookie / 无 PII。
// 没接存储 → 静默 204。任何异常都吞掉,埋点绝不影响站点。
export const dynamic = "force-dynamic";

const OK_EVENTS = new Set(["pageview", "click"]);

export async function POST(req: Request) {
  const r = redis();
  if (!r) return new Response(null, { status: 204 });

  let body: { aid?: unknown; event?: unknown; path?: unknown; label?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 204 });
  }

  const aid = typeof body.aid === "string" ? body.aid.slice(0, 64) : "";
  const event = typeof body.event === "string" ? body.event : "";
  if (!aid || !OK_EVENTS.has(event)) return new Response(null, { status: 204 });

  const path = typeof body.path === "string" ? body.path.slice(0, 120) : "";
  const label = typeof body.label === "string" ? body.label.replace(/\s+/g, " ").trim().slice(0, 48) : "";
  const d = dayKey();

  try {
    const isPv = event === "pageview";
    const p = r.pipeline();
    p.sadd(K.dau(d), aid);
    if (isPv) {
      p.incr(K.pv(d));
      if (path) p.zincrby(K.pvPages(d), 1, path);
    } else if (label) {
      p.zincrby(K.clicks(d), 1, label);
    }
    await p.exec();

    // 首访 cohort:只在 pageview 上判定(用户第一条事件几乎总是 PV)。SET NX 仅第一次成功 → 记入当日新用户集合。
    if (isPv) {
      const isNew = await r.set(K.first(aid), d, { nx: true });
      if (isNew) await r.sadd(K.cohort(d), aid);
    }
  } catch {
    /* 分析失败必须静默,绝不冒泡到用户 */
  }

  return new Response(null, { status: 204 });
}
