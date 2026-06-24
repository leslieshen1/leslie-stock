// 自有产品分析存储(Upstash Redis,HTTP,serverless 友好)。
// 没配 env 时 redis() 返回 null → 埋点/看板全部优雅降级,绝不报错、不影响站点。
// 「天」边界用 UTC(全球中立);要换成美东可在 dayKey 里加偏移。
import { Redis } from "@upstash/redis";

let _redis: Redis | null | undefined;

/** 返回 Redis 客户端;未配置存储时返回 null。兼容 Upstash 原生与 Vercel KV 两套 env 名。 */
export function redis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  return _redis;
}

/** YYYY-MM-DD(UTC) */
export function dayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** c0 之后 n 天的日期串(UTC) */
export function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 最近 n 天日期,从旧到新 */
export function datesAsc(n: number, from: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// 键空间(全部 sg: 前缀,带 TTL 限制存储)
export const K = {
  dau: (d: string) => `sg:dau:${d}`,        // SET<aid> 当日活跃
  first: (aid: string) => `sg:first:${aid}`, // string 首次到访日(NX)
  cohort: (d: string) => `sg:cohort:${d}`,   // SET<aid> 当日新用户(留存 cohort)
  pvPages: (d: string) => `sg:pv:pages:${d}`, // ZSET path→次数
  clicks: (d: string) => `sg:clicks:${d}`,    // ZSET label→次数
  pv: (d: string) => `sg:pv:${d}`,            // string 当日 PV 计数
  ev: (d: string) => `sg:ev:${d}`,            // string 当日事件总数
  referrers: (d: string) => `sg:ref:${d}`,    // ZSET 来源 host→次数(外部 referrer,会话首访记一次;站内/直接不计)
};

export const TTL = 60 * 60 * 24 * 200; // 200 天后自动过期
