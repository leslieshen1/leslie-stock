// 实时个股报价。美股走 Nasdaq(盘前/盘后/盘中都给真价 + session + 昨收),A股/港股走 Yahoo。
// /api/quote?syms=NVDA,AAPL,688017.SS —— US 传纯代码;A股带 .SS/.SZ,港股 .HK。
export const dynamic = "force-dynamic";

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
const isUS = (s: string) => !/\.(SS|SZ|HK)$/i.test(s);

// 美股:Nasdaq info。盘前 primaryData=盘前价(涨跌相对昨收),secondaryData=昨收。
// assetclass 必须匹配证券类型:对 ETF(SPY/QQQ…)用 stocks 会 400,所以失败时回退 etf。
async function usQuote(sym: string, assetclass: "stocks" | "etf" = "stocks"): Promise<Quote | null> {
  try {
    const r = await fetch(
      `https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/info?assetclass=${assetclass}`,
      { headers: NH, cache: "no-store" }
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
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, cache: "no-store" });
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

export async function GET(req: Request) {
  const syms = (new URL(req.url).searchParams.get("syms") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 25);
  const out: Record<string, Quote> = {};
  await Promise.all(
    syms.map(async (sym) => {
      const q = isUS(sym) ? await usQuote(sym) : await yahooQuote(sym);
      if (q) out[sym.toUpperCase()] = q;
    })
  );
  return Response.json({ quotes: out, ts: Date.now() }, { headers: { "cache-control": "no-store" } });
}
