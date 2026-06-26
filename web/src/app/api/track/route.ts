import { redis, K, dayKey } from "@/lib/stats";

// 公开埋点入口(像任何分析 beacon)。匿名 ID 由前端 localStorage 生成,无 cookie / 无 PII。
// 没接存储 → 静默 204。任何异常都吞掉,埋点绝不影响站点。
export const dynamic = "force-dynamic";

const OK_EVENTS = new Set(["pageview", "click"]);

// 外部来源归一化:取 host;站内/空 → 不计(算"直接"),常见渠道合并成可读标签。
function refHost(ref: string): string {
  try {
    const h = new URL(ref).hostname.replace(/^www\./, "").toLowerCase();
    if (!h || h.endsWith("stockgod.xyz")) return "";
    if (h === "t.co" || h.endsWith("twitter.com") || h.endsWith("x.com")) return "X / Twitter";
    if (h.includes("google.")) return "Google";
    if (h.includes("bing.")) return "Bing";
    if (h.includes("baidu.")) return "百度";
    if (h.endsWith("facebook.com") || h === "fb.com") return "Facebook";
    if (h.endsWith("reddit.com")) return "Reddit";
    if (h.endsWith("youtube.com") || h === "youtu.be") return "YouTube";
    if (h === "t.me" || h.includes("telegram")) return "Telegram";
    return h.slice(0, 40);
  } catch {
    return "";
  }
}

// 服务端兜底过滤 bot(客户端已挡一层;双保险让 DAU ≈ 真人)
const BOT_RE =
  /bot|crawl|spider|slurp|mediapartners|bingpreview|facebookexternal|whatsapp|telegram|embedly|applebot|googlebot|bingbot|yandex|baidu|sogou|duckduck|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|statuscake|datadog|newrelic|scrapy|python-requests|axios|node-fetch|okhttp|curl|wget|semrush|ahrefs|mj12|petalbot|bytespider|gptbot|claudebot|ccbot|amazonbot|chatgpt|perplexity/i;

export async function POST(req: Request) {
  const r = redis();
  if (!r) return new Response(null, { status: 204 });
  if (BOT_RE.test(req.headers.get("user-agent") || "")) return new Response(null, { status: 204 });

  let body: { aid?: unknown; event?: unknown; path?: unknown; label?: unknown; ref?: unknown; dau?: unknown; new?: unknown };
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
  const ref = typeof body.ref === "string" ? refHost(body.ref) : "";
  const d = dayKey();

  // 前端去重标志:dau=当天首个事件(才 sadd DAU)、new=该设备首访(才判 cohort)。降低每事件的 Upstash 命令数。
  const dauFirst = body.dau === "1";
  const firstVisit = body.new === "1";

  try {
    const isPv = event === "pageview";
    const p = r.pipeline();
    if (dauFirst) p.sadd(K.dau(d), aid); // 客户端当天去重 → 仅当天首事件 sadd,省掉后续重复
    if (isPv) {
      p.incr(K.pv(d));
      if (path) p.zincrby(K.pvPages(d), 1, path);
      if (ref) p.zincrby(K.referrers(d), 1, ref);
    } else if (label) {
      p.zincrby(K.clicks(d), 1, label);
    }
    await p.exec();

    // 首访 cohort:前端 localStorage 判定(new=1)→ 省掉每个 PV 一条 NX set。NX 仍兜底:清缓存/多设备重复报 new 也只记一次。
    if (isPv && firstVisit) {
      const isNew = await r.set(K.first(aid), d, { nx: true });
      if (isNew) await r.sadd(K.cohort(d), aid);
    }
  } catch {
    /* 分析失败必须静默,绝不冒泡到用户 */
  }

  return new Response(null, { status: 204 });
}
