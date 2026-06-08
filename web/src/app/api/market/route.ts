// 全盘实时快照(Nasdaq screener,免费无 key,一次拉全)。热力图/列表轮询。
// fetch 带 revalidate=60 → 服务端 60s 缓存,无论多少客户端轮询都只打 Nasdaq 一次/分钟。
export const dynamic = "force-dynamic";

const URL_NASDAQ = "https://api.nasdaq.com/api/screener/stocks?tableonly=false&limit=10000&download=true";

function num(s: unknown): number | null {
  const v = parseFloat(String(s ?? "").replace(/[$,%]/g, ""));
  return Number.isFinite(v) ? v : null;
}

export async function GET() {
  try {
    const r = await fetch(URL_NASDAQ, {
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        accept: "application/json, text/plain, */*",
        origin: "https://www.nasdaq.com",
        referer: "https://www.nasdaq.com/",
      },
      next: { revalidate: 60 },
    });
    if (!r.ok) return Response.json({ quotes: {}, ts: Date.now(), error: r.status });
    const d = (await r.json())?.data;
    const rows = d?.rows || d?.table?.rows || [];
    const quotes: Record<string, { price: number | null; pct: number | null }> = {};
    for (const row of rows) {
      const sym = String(row.symbol || "").trim().toUpperCase();
      if (sym && !sym.includes("^") && !sym.includes("/")) {
        quotes[sym] = { price: num(row.lastsale), pct: num(row.pctchange) };
      }
    }
    return Response.json(
      { quotes, ts: Date.now(), count: Object.keys(quotes).length },
      { headers: { "cache-control": "s-maxage=60" } },
    );
  } catch {
    return Response.json({ quotes: {}, ts: Date.now() });
  }
}
