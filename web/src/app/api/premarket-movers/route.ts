// 盘前/盘后异动条数据源。盘前时段拉一批流动性大票的 Nasdaq 盘前价,返回涨跌前几名。
// 整盘 screener 盘前只给收盘价,所以这里逐只拉(固定 ~40 只)+ 60s 内存缓存,避免打爆。
export const dynamic = "force-dynamic";

const NH = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  accept: "application/json",
  origin: "https://www.nasdaq.com",
  referer: "https://www.nasdaq.com/",
};

// 流动性大票池(够代表盘前情绪,又不至于太多请求)
const POOL = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "TSLA", "NFLX", "ORCL",
  "AMD", "MU", "TSM", "ARM", "SMCI", "QCOM", "MRVL", "PLTR", "COIN", "MSTR",
  "JPM", "XOM", "LLY", "COST", "WMT", "NBIS", "ASTS", "LUNR", "ACMR", "AXTI",
  "AAOI", "ENPH", "INTC", "BAC", "DELL", "MMM", "UNH", "HD", "NKE", "BA",
];

type Mover = { sym: string; price: number | null; pct: number | null; prevPct: number | null };
type Payload = { session: string; label: string; gainers: Mover[]; losers: Mover[]; ts: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
function num(s: unknown): number | null {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function one(sym: string): Promise<{ m: Mover; status: string } | null> {
  try {
    const r = await fetch(
      `https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/info?assetclass=stocks`,
      { headers: NH, cache: "no-store" }
    );
    if (!r.ok) return null;
    const d = (await r.json())?.data;
    if (!d) return null;
    const p = d.primaryData || {};
    const s = d.secondaryData || {};
    const price = num(p.lastSalePrice);
    const pct = num(p.percentageChange);
    if (price == null || pct == null) return null;
    return {
      m: { sym, price: r2(price), pct: r2(pct), prevPct: num(s.percentageChange) },
      status: String(d.marketStatus || ""),
    };
  } catch {
    return null;
  }
}

let cache: Payload | null = null;

export async function GET() {
  if (cache && Date.now() - cache.ts < 60_000) {
    return Response.json(cache, { headers: { "cache-control": "no-store" } });
  }
  const settled = await Promise.all(POOL.map(one));
  const rows = settled.filter(Boolean) as { m: Mover; status: string }[];
  const statusRaw = (rows[0]?.status || "").toLowerCase();
  const session = statusRaw.includes("pre")
    ? "pre"
    : statusRaw.includes("after") || statusRaw.includes("post")
    ? "post"
    : statusRaw.includes("open")
    ? "regular"
    : "closed";
  const label = session === "pre" ? "盘前异动" : session === "post" ? "盘后异动" : session === "regular" ? "盘中异动" : "";
  const movers = rows.map((r) => r.m).sort((a, b) => (b.pct ?? -999) - (a.pct ?? -999));
  const payload: Payload = {
    session,
    label,
    gainers: movers.slice(0, 6),
    losers: movers.slice(-6).reverse(),
    ts: Date.now(),
  };
  cache = payload;
  return Response.json(payload, { headers: { "cache-control": "no-store" } });
}
