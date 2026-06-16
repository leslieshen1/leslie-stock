// 全盘实时快照(Nasdaq screener,免费无 key,一次拉全)。热力图/列表轮询。
// 缓存靠 CDN 的 s-maxage(force-dynamic 下 fetch 的 revalidate 不生效,别被旧注释骗);
// 上游超时/失败回退「上次好值」,避免整张热力图突然空白(还以 HTTP 200 掩盖故障)。
import { clientIp, rateLimit, tooMany, fetchWithTimeout } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

const URL_NASDAQ = "https://api.nasdaq.com/api/screener/stocks?tableonly=false&limit=10000&download=true";

// mcapB/vol 也一并回出:美股市值/成交量全站本来无实时通道(scan/热力图都吃构建期静态快照,
// NVDA 冻在 $5.14T、排序锚旧值)。Nasdaq screener 同一行本就带 marketCap+volume,顺手带上。
type Quotes = Record<string, { price: number | null; pct: number | null; mcapB?: number | null; vol?: number | null }>;
let MKT_LAST_GOOD: { quotes: Quotes; ts: number } | null = null;

function num(s: unknown): number | null {
  const v = parseFloat(String(s ?? "").replace(/[$,%]/g, ""));
  return Number.isFinite(v) ? v : null;
}

export async function GET(req: Request) {
  const rl = rateLimit(`mkt:${clientIp(req)}`, 60, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfter);

  try {
    const r = await fetchWithTimeout(
      URL_NASDAQ,
      {
        headers: {
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36",
          accept: "application/json, text/plain, */*",
          origin: "https://www.nasdaq.com",
          referer: "https://www.nasdaq.com/",
        },
      },
      10000,
    );
    if (!r.ok) throw new Error(`nasdaq ${r.status}`);
    const d = (await r.json())?.data;
    const rows = d?.rows || d?.table?.rows || [];
    const quotes: Quotes = {};
    for (const row of rows) {
      const sym = String(row.symbol || "").trim().toUpperCase();
      if (sym && !sym.includes("^") && !sym.includes("/")) {
        const mc = num(row.marketCap); // 原始美元市值,转 $B(2 位)
        quotes[sym] = {
          price: num(row.lastsale),
          pct: num(row.pctchange),
          mcapB: mc != null ? Math.round(mc / 1e7) / 100 : null,
          vol: num(row.volume),
        };
      }
    }
    if (Object.keys(quotes).length === 0) throw new Error("empty");
    MKT_LAST_GOOD = { quotes, ts: Date.now() };
    return Response.json(
      { quotes, ts: MKT_LAST_GOOD.ts, count: Object.keys(quotes).length },
      { headers: { "cache-control": "s-maxage=60, stale-while-revalidate=120" } },
    );
  } catch {
    // 降级:上游超时/失败/空 → 返回上次好值(带 stale),别让热力图变空白
    if (MKT_LAST_GOOD) {
      return Response.json(
        { quotes: MKT_LAST_GOOD.quotes, ts: MKT_LAST_GOOD.ts, count: Object.keys(MKT_LAST_GOOD.quotes).length, stale: true },
        { headers: { "cache-control": "s-maxage=30" } },
      );
    }
    return Response.json({ quotes: {}, ts: Date.now(), count: 0 });
  }
}
