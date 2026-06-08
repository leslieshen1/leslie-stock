// 实时个股报价(Yahoo v8 chart,免费无 key)。详情页 LivePrice 轮询。
// /api/quote?syms=NVDA,AAPL,688017.SS —— 客户端传 Yahoo 符号(A股带 .SS/.SZ,港股 .HK)。
export const dynamic = "force-dynamic";

async function one(sym: string): Promise<{ price: number; pct: number | null } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=1d`;
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, next: { revalidate: 15 } });
    if (!r.ok) return null;
    const m = (await r.json())?.chart?.result?.[0]?.meta;
    const price = m?.regularMarketPrice;
    if (price == null) return null;
    const prev = m.chartPreviousClose ?? m.previousClose;
    const pct = prev ? ((price - prev) / prev) * 100 : null;
    return { price: Math.round(price * 100) / 100, pct: pct == null ? null : Math.round(pct * 100) / 100 };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const syms = (new URL(req.url).searchParams.get("syms") || "")
    .split(",").map((s) => s.trim()).filter(Boolean).slice(0, 25);
  const out: Record<string, { price: number; pct: number | null }> = {};
  await Promise.all(syms.map(async (sym) => {
    const q = await one(sym);
    if (q) out[sym.toUpperCase()] = q;
  }));
  return Response.json({ quotes: out, ts: Date.now() }, { headers: { "cache-control": "s-maxage=15" } });
}
