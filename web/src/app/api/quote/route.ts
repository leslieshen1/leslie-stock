// 实时个股报价。美股走 Nasdaq(盘前/盘后/盘中都给真价 + session + 昨收),A股/港股走 Yahoo。
// /api/quote?syms=NVDA,AAPL,688017.SS —— US 传纯代码;A股带 .SS/.SZ,港股 .HK。
// 放量护栏:每 IP 限流 + 每代码 12s 合并缓存 + 上游超时 + 失败回退"上次好值"(见 api-guard)。
import { clientIp, rateLimit, tooMany, cacheGet, cacheSet, fetchWithTimeout } from "@/lib/api-guard";
import { marketStatus } from "@/lib/market-status";

// 不 force-dynamic(它让边缘完全不缓存)。本接口按 ?syms 取价、读 req 本就动态;
// 改用 Vercel-CDN-Cache-Control 让边缘按 URL(含 syms)缓存 6s —— 同一只票多人同看时共享一份,函数少打。

type Quote = {
  price: number;
  pct: number | null;
  session?: "pre" | "regular" | "post" | "closed";
  prevClose?: number | null;
};

const NH = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  accept: "application/json",
  origin: "https://www.nasdaq.com",
  referer: "https://www.nasdaq.com/",
};

const r2 = (n: number) => Math.round(n * 100) / 100;
function num(s: unknown): number | null {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}
// 带交易所后缀的走 Yahoo;其余(裸代码)按美股走 Nasdaq。台股 .TW / 韩股 .KS 也归 Yahoo(热力图港台韩节点用)
const isUS = (s: string) => !/\.(SS|SZ|HK|TW|KS)$/i.test(s);

// 高频 ETF 直通:assetclass 一次到位,免 stocks→400→etf 两连击(QQQ 实测省一半延迟)
const KNOWN_ETFS = new Set(["QQQ", "SPY", "DIA", "IWM", "GLD", "SLV", "TLT", "HYG", "XLK", "XLF", "XLE", "SMH", "SOXX", "ARKK", "IBIT", "VTI", "VOO"]);

// 美股:Nasdaq info。盘前 primaryData=盘前价(涨跌相对昨收),secondaryData=昨收。
// assetclass 必须匹配证券类型:对 ETF(SPY/QQQ…)用 stocks 会 400,所以失败时回退 etf。
async function usQuote(sym: string, assetclass: "stocks" | "etf" = "stocks"): Promise<Quote | null> {
  try {
    const r = await fetchWithTimeout(
      `https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/info?assetclass=${assetclass}`,
      { headers: NH, cache: "no-store" },
      7000,
    );
    if (!r.ok) return assetclass === "stocks" ? usQuote(sym, "etf") : null;
    const d = (await r.json())?.data;
    if (!d) return assetclass === "stocks" ? usQuote(sym, "etf") : null;
    const p = d.primaryData || {};
    const s = d.secondaryData || {};
    const price = num(p.lastSalePrice);
    if (price == null) return null;
    const pct = num(p.percentageChange);
    const ms = String(d.marketStatus || "").toLowerCase();
    const session: Quote["session"] = ms.includes("pre")
      ? "pre"
      : ms.includes("after") || ms.includes("post")
      ? "post"
      : ms.includes("open")
      ? "regular"
      : "closed";
    return { price: r2(price), pct: pct == null ? null : r2(pct), session, prevClose: num(s.lastSalePrice) };
  } catch {
    return null;
  }
}

// A股/港股:Yahoo v8 chart。
async function yahooQuote(sym: string): Promise<Quote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=1d`;
    const r = await fetchWithTimeout(url, { headers: { "user-agent": "Mozilla/5.0" }, cache: "no-store" }, 7000);
    if (!r.ok) return null;
    const m = (await r.json())?.chart?.result?.[0]?.meta;
    const price = m?.regularMarketPrice;
    if (price == null) return null;
    const prev = m.chartPreviousClose ?? m.previousClose;
    const pct = prev ? ((price - prev) / prev) * 100 : null;
    return { price: r2(price), pct: pct == null ? null : r2(pct), session: "regular", prevClose: prev ?? null };
  } catch {
    return null;
  }
}

// A股/港股:腾讯实时(qt.gtimg.cn) —— 与列表 /api/a-market 同源,详情与列表锁步、无 Yahoo ~15min 滞后。
// Yahoo 符号 → 腾讯:600519.SS→sh600519、000858.SZ→sz000858、430139.BJ→bj430139、0700.HK→r_hk00700(港股补 5 位)。
function qqFromYahoo(sym: string): string | null {
  const a = sym.match(/^(\d{6})\.(SS|SZ|BJ)$/i);
  if (a) return ({ SS: "sh", SZ: "sz", BJ: "bj" }[a[2].toUpperCase()] ?? "") + a[1];
  const hk = sym.match(/^(\d+)\.HK$/i);
  if (hk) return "r_hk" + hk[1].padStart(5, "0");
  return null;
}
async function tencentQuote(qq: string): Promise<Quote | null> {
  try {
    const r = await fetchWithTimeout(
      `https://qt.gtimg.cn/q=${qq}`,
      { headers: { referer: "https://gu.qq.com/", "user-agent": "Mozilla/5.0" }, cache: "no-store" },
      7000,
    );
    if (!r.ok) return null;
    // GBK 解码(同 a-market);字段 [3]现价 [4]昨收 [32]涨跌%
    const txt = new TextDecoder("gbk").decode(await r.arrayBuffer());
    const m = txt.match(/="([^"]*)"/);
    if (!m) return null;
    const p = m[1].split("~");
    const price = num(p[3]);
    if (price == null || price === 0) return null;
    const pct = num(p[32]);
    return { price: r2(price), pct: pct == null ? null : r2(pct), session: "regular", prevClose: num(p[4]) };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  // 限流:每 IP 200 次/分钟。正常单页轮询 ~3-9 次/分,留足余量,只挡机器人/爬虫。
  const rl = rateLimit(`quote:${clientIp(req)}`, 200, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfter);

  const syms = (new URL(req.url).searchParams.get("syms") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 25);
  const out: Record<string, Quote> = {};
  await Promise.all(
    syms.map(async (sym) => {
      const up = sym.toUpperCase();
      // 12s 合并缓存:多客户端/快速轮询同一代码时,不重复打上游
      const hit = cacheGet<Quote>(`q:${up}`);
      if (hit) {
        out[up] = hit;
        return;
      }
      const qq = qqFromYahoo(sym);
      let q: Quote | null;
      if (qq) {
        // A股/港股:腾讯(与列表 /api/a-market 同源 → 详情与列表锁步、无 Yahoo 滞后);挂了回退 Yahoo
        q = await tencentQuote(qq);
        if (!q) q = await yahooQuote(sym);
      } else if (isUS(sym)) {
        // 美股:Nasdaq /info;Nasdaq 间歇性拒绝 Vercel 数据中心 IP(源头正常、Vercel 调就空)→ 回退 Yahoo,免详情页卡旧种子
        q = await usQuote(sym, KNOWN_ETFS.has(up) ? "etf" : "stocks");
        if (!q) q = await yahooQuote(sym);
      } else {
        // 台股(.TW)/韩股(.KS):Yahoo
        q = await yahooQuote(sym);
      }
      if (q) {
        out[up] = q;
        cacheSet(`q:${up}`, q, 12_000); // 短缓存:合并轮询
        cacheSet(`good:${up}`, q, 30 * 60_000); // 上次好值:上游挂了用它兜底
      } else {
        // 降级:上游超时/失败 → 返回最近一次好值,避免价格变空白
        const good = cacheGet<Quote>(`good:${up}`);
        if (good) out[up] = good;
      }
    })
  );
  // 全部符号都没拿到价(上游集体失败)→ 不缓存这个"空响应",否则边缘会把空缓存喂给所有人、价格集体卡死。
  const allEmpty = Object.keys(out).length === 0;
  // 边缘缓存按时段:任一市场(美/A/港/韩)开盘=行情在动→短缓存 20s;全休市=行情不变→长缓存 600s。
  // 关键是拉长 stale-while-revalidate —— 轮询在 SWR 窗口内大量命中边缘、只偶尔后台回源,大削 Vercel 函数调用 + Origin Transfer。
  const anyOpen = (["us", "a", "hk", "kr"] as const).some((m) => marketStatus(new Date(), m).state !== "closed");
  const cdn = anyOpen ? "max-age=20, stale-while-revalidate=600" : "max-age=600, stale-while-revalidate=1800";
  return Response.json(
    { quotes: out, ts: Date.now() },
    { headers: allEmpty
      ? { "cache-control": "no-store" }
      : {
          "cache-control": "public, max-age=0, must-revalidate",
          "Vercel-CDN-Cache-Control": cdn,
        } },
  );
}
