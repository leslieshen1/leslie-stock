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
type Quotes = Record<string, { price: number | null; pct: number | null; mcapB?: number | null; vol?: number | null; postPct?: number | null }>;
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

// 全市场覆盖:腾讯美股批量(qt.gtimg.cn/q=usAAPL,usNVDA,...)。与 A 股/港股【同一个 host qt.gtimg.cn】——
// 免 key、从 Vercel 已证明能用(A/HK 实时就靠它)。字段:[3]现价(交易时段实时/否则收盘)、[32]涨跌%、[9]盘后价。
// 一次拉 240 只(实测 2.7s),分波并发覆盖全宇宙 → 治本 screener 长尾整天滞后 + 给板块「盘后」列供逐只 postPct。
// 探针先打 1 批,不通即整体放弃(返回 false 让上层退回 /info 龙头;新浪那条就是 host hq.sinajs.cn 被 Vercel 挡)。点票(BRK.B)跳过。
async function overlayTencentUS(quotes: Quotes): Promise<boolean> {
  const syms = Object.keys(quotes).filter((s) => /^[A-Z]{1,5}$/.test(s));
  if (!syms.length) return false;
  const BATCH = 240;
  const batches: string[][] = [];
  for (let i = 0; i < syms.length; i += BATCH) batches.push(syms.slice(i, i + BATCH));
  const apply = (txt: string) => {
    for (const line of txt.split(";")) {
      const m = line.match(/v_us([A-Za-z]+)="([^"]*)"/); // v_usAAPL="200~苹果~AAPL.OQ~297.01~..."
      if (!m || !m[2]) continue;
      const cur = quotes[m[1].toUpperCase()];
      if (!cur) continue;
      const f = m[2].split("~");
      const price = num(f[3]);
      if (price == null || !(price > 0)) continue;
      cur.price = price;
      const pct = num(f[32]); if (pct != null) cur.pct = pct;
      const post = num(f[9]); // [9]=盘后价 → 盘后% 相对收盘;盘后未发生时常为 0/失真,板块盘后列只在盘后/休市才用它
      if (post != null && post > 0) cur.postPct = Math.round((post / price - 1) * 1000) / 10;
    }
  };
  const fetchBatch = async (b: string[]): Promise<string | null> => {
    try {
      const res = await fetchWithTimeout(`https://qt.gtimg.cn/q=${b.map((s) => "us" + s).join(",")}`, {}, 6000);
      return new TextDecoder("gbk").decode(await res.arrayBuffer());
    } catch { return null; }
  };
  const probe = await fetchBatch(batches[0]); // 探针
  if (probe == null) return false;            // 腾讯美股不通 → 放弃,上层退回 /info
  apply(probe);
  const rest = batches.slice(1), WAVE = 10;
  for (let i = 0; i < rest.length; i += WAVE) {
    const txts = await Promise.all(rest.slice(i, i + WAVE).map(fetchBatch));
    for (const t of txts) if (t) apply(t);
  }
  return true;
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
    // 治本:腾讯美股批量(qt.gtimg.cn,与 A/HK 同 host、Vercel 已证明能用)覆盖全宇宙 price/pct + 盘后 postPct【总是跑】
    // (休市也要 postPct 给板块「盘后」列逐只聚合)。腾讯探针不通(理论上不会)才退回 /info 龙头。
    // 新浪 hq.sinajs.cn 是另一个 host、从 Vercel 被挡(实测 69s 全超时),已弃。
    const session = etSession();
    let tencentOK = false;
    try { tencentOK = await overlayTencentUS(quotes); } catch { /* 保留 screener 兜底 */ }
    if (!tencentOK && session !== "closed") {
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
