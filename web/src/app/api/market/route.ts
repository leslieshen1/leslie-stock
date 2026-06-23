// 全盘实时快照(Nasdaq screener,免费无 key,一次拉全)。热力图/列表轮询。
// 缓存靠 CDN 的 s-maxage(force-dynamic 下 fetch 的 revalidate 不生效,别被旧注释骗);
// 上游超时/失败回退「上次好值」,避免整张热力图突然空白(还以 HTTP 200 掩盖故障)。
import { clientIp, rateLimit, tooMany, fetchWithTimeout } from "@/lib/api-guard";

// 注:不再 force-dynamic —— 它会让 Vercel 边缘完全不缓存(每个请求都打函数,X 尖峰主炸点)。
// 本接口读 req(限流/origin)本就是动态渲染,无需 force-dynamic;改用 Vercel-CDN-Cache-Control 让边缘缓存 55s,
// 多用户共享一份(函数每 ~55s 才真跑一次,盘前/盘后的 /info 覆盖也随之只算一次)。浏览器仍各自轮询取最新。

const URL_NASDAQ = "https://api.nasdaq.com/api/screener/stocks?tableonly=false&limit=10000&download=true";

// mcapB/vol 也一并回出:美股市值/成交量全站本来无实时通道(scan/热力图都吃构建期静态快照,
// NVDA 冻在 $5.14T、排序锚旧值)。Nasdaq screener 同一行本就带 marketCap+volume,顺手带上。
type Quotes = Record<string, { price: number | null; pct: number | null; mcapB?: number | null; vol?: number | null }>;
let MKT_LAST_GOOD: { quotes: Quotes; ts: number } | null = null;

function num(s: unknown): number | null {
  const v = parseFloat(String(s ?? "").replace(/[$,%]/g, ""));
  return Number.isFinite(v) ? v : null;
}

// 美东盘口时段。screener 只有常规时段;盘前/盘后要从 /info 端点补真价。
function etSession(): "pre" | "regular" | "post" | "closed" {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const wd = p.find((x) => x.type === "weekday")?.value;
  if (wd === "Sat" || wd === "Sun") return "closed";
  const m = (+(p.find((x) => x.type === "hour")?.value ?? "0") % 24) * 60 + +(p.find((x) => x.type === "minute")?.value ?? "0");
  if (m >= 240 && m < 570) return "pre";
  if (m >= 570 && m < 960) return "regular";
  if (m >= 960 && m < 1200) return "post";
  return "closed";
}

// 盘前/盘后:screener 的 pct 是上一常规收盘(冻住) → 用 /api/quote(Nasdaq /info,带真延伸时段价)覆盖市值 top-N 龙头的 price/pct。
// 只覆盖龙头(列表默认按市值排,这些就是可见行 + 大家关心的票),其余保留 screener 值;分批查、CDN 60s 缓存,载荷可控。
async function overlayExtended(quotes: Quotes, origin: string): Promise<void> {
  const top = Object.entries(quotes)
    .filter(([, q]) => (q.mcapB ?? 0) > 0)
    .sort((a, b) => (b[1].mcapB ?? 0) - (a[1].mcapB ?? 0))
    .slice(0, 100)
    .map(([s]) => s);
  for (let i = 0; i < top.length; i += 25) {
    const batch = top.slice(i, i + 25).join(",");
    const j = await fetchWithTimeout(`${origin}/api/quote?syms=${encodeURIComponent(batch)}`, {}, 10000)
      .then((x) => x.json()).catch(() => null);
    const qs = (j?.quotes || {}) as Record<string, { price: number | null; pct: number | null }>;
    for (const [sym, q] of Object.entries(qs)) {
      const cur = quotes[sym];
      if (cur && q.price != null) { cur.price = q.price; if (q.pct != null) cur.pct = q.pct; }
    }
  }
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
    // ⚠ Nasdaq bulk screener 整天滞后(常停在上一交易日收盘,实测开盘13min后 AVGO screener +4.7% 而 /info -2.2% 方向都反)。
    // 治标:交易时段把市值 top-100 龙头用 /info(真延伸时段价)覆盖 price/pct,可见行 + 大家关心的票实时;长尾仍吃 screener。
    // 注:新浪 gb_* 批量【从 Vercel 数据中心 IP 走不通】——每批 8s 超时、覆盖全空、/api/market 被拖到 69s,已撤(腾讯 A/HK 能用、新浪美股不能)。
    const session = etSession();
    if (session !== "closed") {
      try { await overlayExtended(quotes, new URL(req.url).origin); } catch { /* 失败保留 screener 兜底 */ }
    }
    MKT_LAST_GOOD = { quotes, ts: Date.now() };
    return Response.json(
      { quotes, ts: MKT_LAST_GOOD.ts, count: Object.keys(quotes).length, session },
      { headers: {
        "cache-control": "public, max-age=0, must-revalidate",            // 浏览器:每次轮询都问一下(拿最新)
        "Vercel-CDN-Cache-Control": "max-age=55, stale-while-revalidate=120", // Vercel 边缘:缓存 55s,多用户共享,函数少打
      } },
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
