// 轻量 API 护栏(零依赖、内存级)—— 放量前给直通第三方的行情路由兜底。
// Serverless 上每个实例内存独立,跨实例不共享:所以这不是"硬性全局限流",而是
//   ① 合并同一实例上的重复轮询(TTL 缓存)
//   ② 节流单个滥用者(同一热实例上的高频请求)
//   ③ 上游超时/挂掉时回退到"上次好值",避免整页价格变空白
// 要硬性跨实例限流/缓存,再上 Upstash Redis(需 key);当前零依赖、零配置。

export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "anon"
  );
}

// —— 滑动窗口限流 ——
const buckets = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  b.count++;
  if (b.count > limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((b.reset - now) / 1000)) };
  return { ok: true, retryAfter: 0 };
}

// 偶尔清理过期桶,避免内存无界增长
function sweep() {
  const now = Date.now();
  if (buckets.size > 5000) for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}

export function tooMany(retryAfter: number): Response {
  sweep();
  return Response.json(
    { error: "rate_limited", retryAfter },
    { status: 429, headers: { "retry-after": String(retryAfter), "cache-control": "no-store" } },
  );
}

// —— TTL 缓存 ——
const store = new Map<string, { v: unknown; exp: number }>();
export function cacheGet<T>(k: string): T | undefined {
  const e = store.get(k);
  if (!e) return undefined;
  if (Date.now() > e.exp) {
    store.delete(k);
    return undefined;
  }
  return e.v as T;
}
export function cacheSet(k: string, v: unknown, ttlMs: number): void {
  if (store.size > 20000) for (const [k2, e] of store) if (Date.now() > e.exp) store.delete(k2);
  store.set(k, { v, exp: Date.now() + ttlMs });
}

// —— 带超时的 fetch(上游慢时不挂住整个请求)——
export async function fetchWithTimeout(
  url: string,
  opts: RequestInit & { next?: { revalidate?: number } } = {},
  ms = 8000,
): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}
