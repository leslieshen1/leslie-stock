import { promises as fs } from "fs";
import path from "path";
import { fetchWithTimeout } from "@/lib/api-guard";

// 实时宏观/指数(Yahoo v8 chart,免费无 key)。前端 MacroBar 轮询。
// fetch 带 revalidate=30 → 服务端 30s 缓存,不砸 Yahoo。失败回落静态 macro.json。
// 不 force-dynamic(它会废掉缓存):无 per-request 状态,响应边缘缓存(下方 s-maxage=60),命中不打函数。
// macro 是首页 MacroBar 一直在轮的高频接口:s-maxage + 内层 fetch revalidate 都 60s,砍 ISR Writes/函数/外部请求各一半(指数 60s 够新鲜)。

const SERIES = [
  { sym: "^TNX", name: "美债 10Y", kind: "rate" },
  { sym: "^IRX", name: "美债 13W", kind: "rate" },
  { sym: "^FVX", name: "美债 5Y", kind: "rate" },
  { sym: "^TYX", name: "美债 30Y", kind: "rate" },
  { sym: "^GSPC", name: "标普 500", kind: "index" },
  { sym: "^IXIC", name: "纳斯达克", kind: "index" },
  { sym: "^DJI", name: "道琼斯", kind: "index" },
  { sym: "^RUT", name: "罗素 2000", kind: "index" },
  { sym: "^VIX", name: "VIX 恐慌", kind: "vol" },
  { sym: "DX-Y.NYB", name: "美元指数", kind: "fx" },
  { sym: "GC=F", name: "黄金", kind: "commodity" },
  { sym: "CL=F", name: "原油 WTI", kind: "commodity" },
  { sym: "BTC-USD", name: "比特币", kind: "crypto" },
  { sym: "ETH-USD", name: "以太坊", kind: "crypto" },
];

async function liveOne(sym: string): Promise<{ price: number; pct: number | null } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=1d`;
    const r = await fetchWithTimeout(url, { headers: { "user-agent": "Mozilla/5.0" }, next: { revalidate: 120 } }, 6000);
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

export async function GET() {
  const live = await Promise.all(SERIES.map((s) => liveOne(s.sym)));
  let staticSeries: { sym: string; price: number; pct: number | null }[] = [];
  try {
    const p = path.join(process.cwd(), "public", "data", "macro.json");
    staticSeries = JSON.parse(await fs.readFile(p, "utf-8")).series || [];
  } catch {
    /* ignore */
  }
  const sm = new Map(staticSeries.map((s) => [s.sym, s]));
  const series = SERIES.map((s, i) => {
    const l = live[i];
    const st = sm.get(s.sym);
    return { ...s, price: l?.price ?? st?.price ?? null, pct: l?.pct ?? st?.pct ?? null };
  });
  return Response.json({ series, ts: Date.now() }, { headers: { "cache-control": "s-maxage=120, stale-while-revalidate=600" } });
}
