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

// 全市场覆盖:新浪美股批量(hq.sinajs.cn/list=gb_*)。与 A 股腾讯【同一套机制】——免 key、IP 无关、
// 从 Vercel 已证明稳,价格/涨跌与 Nasdaq 一字不差。一次拉 ~70 只,~85 批分波并发覆盖全 6000 只 price/pct,
// 治本 screener 长尾整天滞后(列表/热力图/板块逐只聚合随之全程准)。带点票(BRK.B 等)新浪格式不同 → 保留 screener。
async function overlaySina(quotes: Quotes): Promise<void> {
  const syms = Object.keys(quotes).filter((s) => /^[A-Z]{1,5}$/.test(s));
  const BATCH = 70, WAVE = 8;
  const batches: string[][] = [];
  for (let i = 0; i < syms.length; i += BATCH) batches.push(syms.slice(i, i + BATCH));
  for (let i = 0; i < batches.length; i += WAVE) {
    await Promise.all(batches.slice(i, i + WAVE).map(async (b) => {
      try {
        const list = b.map((s) => "gb_" + s.toLowerCase()).join(",");
        const res = await fetchWithTimeout(`https://hq.sinajs.cn/list=${list}`,
          { headers: { referer: "https://finance.sina.com.cn/", "user-agent": "Mozilla/5.0" } }, 8000);
        const txt = new TextDecoder("gbk").decode(await res.arrayBuffer());
        for (const line of txt.split(";")) {
          const m = line.match(/gb_([a-z0-9]+)="([^"]*)"/);
          if (!m || !m[2]) continue;
          const cur = quotes[m[1].toUpperCase()];
          if (!cur) continue;
          const p = m[2].split(",");
          const price = num(p[1]);
          if (price != null && price > 0) { cur.price = price; const pc = num(p[2]); if (pc != null) cur.pct = pc; }
        }
      } catch { /* 单批失败保留 screener 兜底 */ }
    }));
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
    // 治本:交易时段【全市场】用新浪批量(gb_*)覆盖 price/pct(免key、IP无关、与 Nasdaq 一致),长尾不再脏 → 列表/热力图/板块
    // 逐只聚合全程准;龙头随后再叠 /info(双保险:新浪盘中万一延迟,龙头照样秒级)。screener 仍供宇宙 + 市值 + 兜底。
    const session = etSession();
    if (session !== "closed") {
      try { await overlaySina(quotes); } catch { /* 失败保留 screener 兜底 */ }
      try { await overlayExtended(quotes, new URL(req.url).origin); } catch { /* 失败保留上一步值兜底 */ }
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
