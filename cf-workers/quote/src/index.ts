// stockgod-quote · Cloudflare Worker
// 把 Vercel /api/quote(个股实时报价)搬到 CF,省 Vercel 函数调用 / Origin Transfer / CPU。
// 逻辑与 web/src/app/api/quote/route.ts 对齐:美股→Nasdaq /info;A股/港股→腾讯;腾讯挂→Yahoo。
//
// 两个 CF 特有处理:
//  1) workerd 的 TextDecoder 不支持 GBK,而腾讯行情是 GBK 编码 —— 改用 latin1 逐字节解码,
//     只取 split("~") 后的数字字段([3]现价/[4]昨收/[32]涨跌%),中文名乱码但我们不用名。
//  2) 边缘缓存用 caches.default(Cache API)按时段:任一市场开盘 20s、全休市 600s(+长 SWR)。
//     workers.dev 子域 Cache API 可用;挂自定义域(CF zone)缓存更稳,见 README。

export interface Env {}

type Quote = { price: number; pct: number | null; session?: string; prevClose?: number | null };

const r2 = (n: number) => Math.round(n * 100) / 100;
function num(s: unknown): number | null {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// 美股 Nasdaq /info 请求头(与 Vercel 版同源,带 referer/UA 过反爬)
const NH: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  accept: "application/json",
  origin: "https://www.nasdaq.com",
  referer: "https://www.nasdaq.com/",
};
const KNOWN_ETFS = new Set(["QQQ", "SPY", "DIA", "IWM", "GLD", "SLV", "TLT", "HYG", "XLK", "XLF", "XLE", "SMH", "SOXX", "ARKK", "IBIT", "VTI", "VOO"]);

// 带交易所后缀的走腾讯/Yahoo;裸代码按美股走 Nasdaq
const isUS = (s: string) => !/\.(SS|SZ|HK|TW|KS)$/i.test(s);

async function fetchT(url: string, init: RequestInit, ms: number): Promise<Response | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function usQuote(sym: string, assetclass: "stocks" | "etf" = "stocks"): Promise<Quote | null> {
  const r = await fetchT(`https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/info?assetclass=${assetclass}`, { headers: NH }, 7000);
  if (!r || !r.ok) return assetclass === "stocks" ? usQuote(sym, "etf") : null;
  const d = (await r.json().catch(() => null) as any)?.data;
  if (!d) return assetclass === "stocks" ? usQuote(sym, "etf") : null;
  const p = d.primaryData || {};
  const s = d.secondaryData || {};
  const price = num(p.lastSalePrice);
  if (price == null) return null;
  const pct = num(p.percentageChange);
  const ms = String(d.marketStatus || "").toLowerCase();
  const session = ms.includes("pre") ? "pre" : ms.includes("after") || ms.includes("post") ? "post" : ms.includes("open") ? "regular" : "closed";
  return { price: r2(price), pct: pct == null ? null : r2(pct), session, prevClose: num(s.lastSalePrice) };
}

async function yahooQuote(sym: string): Promise<Quote | null> {
  const r = await fetchT(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=1d`, { headers: { "user-agent": "Mozilla/5.0" } }, 7000);
  if (!r || !r.ok) return null;
  const m = ((await r.json().catch(() => null)) as any)?.chart?.result?.[0]?.meta;
  const price = m?.regularMarketPrice;
  if (price == null) return null;
  const prev = m.chartPreviousClose ?? m.previousClose;
  const pct = prev ? ((price - prev) / prev) * 100 : null;
  return { price: r2(price), pct: pct == null ? null : r2(pct), session: "regular", prevClose: prev ?? null };
}

// Yahoo 符号 → 腾讯码:600519.SS→sh600519、000858.SZ→sz000858、920394.BJ→bj920394、0700.HK→r_hk00700
function qqFromYahoo(sym: string): string | null {
  const a = sym.match(/^(\d{6})\.(SS|SZ|BJ)$/i);
  if (a) return ({ SS: "sh", SZ: "sz", BJ: "bj" }[a[2].toUpperCase()] ?? "") + a[1];
  const hk = sym.match(/^(\d+)\.HK$/i);
  if (hk) return "r_hk" + hk[1].padStart(5, "0");
  return null;
}

async function tencentQuote(qq: string): Promise<Quote | null> {
  const r = await fetchT(`https://qt.gtimg.cn/q=${qq}`, { headers: { referer: "https://gu.qq.com/", "user-agent": "Mozilla/5.0" } }, 7000);
  if (!r || !r.ok) return null;
  // GBK → latin1 逐字节(workerd 不支持 gbk);只取数字字段,中文名乱码无所谓
  const buf = new Uint8Array(await r.arrayBuffer());
  let txt = "";
  for (let i = 0; i < buf.length; i++) txt += String.fromCharCode(buf[i]);
  const m = txt.match(/="([^"]*)"/);
  if (!m) return null;
  const p = m[1].split("~");
  const price = num(p[3]);
  if (price == null || price === 0) return null;
  const pct = num(p[32]);
  return { price: r2(price), pct: pct == null ? null : r2(pct), session: "regular", prevClose: num(p[4]) };
}

async function oneQuote(sym: string): Promise<Quote | null> {
  const qq = qqFromYahoo(sym);
  if (qq) return (await tencentQuote(qq)) || (await yahooQuote(sym)); // A/港股:腾讯优先,挂了回退 Yahoo
  if (!isUS(sym)) return await yahooQuote(sym); // .TW/.KS 等
  return await usQuote(sym); // 美股
}

// 缓存 TTL 粗判:任一市场(美/A·港/韩)在交易时段→开盘短缓存,全休市→长缓存。
// 用 UTC 近似(不含节假日/夏令时边界,误差只影响 TTL 长短几分钟,无害)。
function anyMarketOpen(now: Date): boolean {
  const wd = now.getUTCDay();
  if (wd === 0 || wd === 6) return false; // 周末
  const hm = now.getUTCHours() * 60 + now.getUTCMinutes();
  const us = hm >= 13 * 60 + 30 && hm < 20 * 60; // 美股 ~9:30-16:00 ET(EDT)
  const cn = hm >= 1 * 60 + 30 && hm < 8 * 60; // A股+港股 ~9:30-16:00 北京
  const kr = hm >= 0 && hm < 6 * 60 + 30; // 韩股 ~9:00-15:30 首尔
  return us || cn || kr;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(req: Request, _env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const syms = (url.searchParams.get("syms") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 25);
    const jhead = { ...CORS, "content-type": "application/json" };
    if (!syms.length) return new Response(JSON.stringify({ quotes: {}, ts: Date.now() }), { headers: jhead });

    // 边缘缓存命中直接返回(不抓上游)
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const out: Record<string, Quote> = {};
    await Promise.all(
      syms.map(async (sym) => {
        const q = await oneQuote(sym);
        if (q) out[sym.toUpperCase()] = q;
      }),
    );

    const allEmpty = Object.keys(out).length === 0;
    const open = anyMarketOpen(new Date());
    const ttl = allEmpty ? 0 : open ? 20 : 600;
    const swr = open ? 600 : 1800;
    const resp = new Response(JSON.stringify({ quotes: out, ts: Date.now() }), {
      headers: {
        ...jhead,
        "cache-control": ttl ? `public, max-age=${ttl}, stale-while-revalidate=${swr}` : "no-store",
      },
    });
    if (ttl) ctx.waitUntil(cache.put(cacheKey, resp.clone())); // 异步写边缘缓存,不阻塞响应
    return resp;
  },
};
