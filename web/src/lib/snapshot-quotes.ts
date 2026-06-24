// CF 迁移 Phase 2 地基:客户端直读 data-live 快照(GitHub raw,免费 + 带 CORS),绕开 Vercel /api/market
// /api/a-market 函数 → 既砍 Vercel 账单(Observability/Origin Transfer/Fluid CPU 都按函数被打的次数走),
// 又是 CF 静态架构需要的"前端直取静态数据"形态(不是过渡白做)。
// 快照每 5 分钟由免费 GitHub Action 刷(两市交易时段)。新鲜(<15min)或本市场休市 → 用快照;
// 盘中且快照过旧(Action 可能挂了)→ 回退给定的 Vercel API(它会现拉实时)。任何失败也回退,绝不让行情空白。
import { marketStatus } from "./market-status";

const SNAP: Record<"us" | "a", string> = {
  us: "https://raw.githubusercontent.com/leslieshen1/leslie-stock/data-live/us-snapshot.json",
  a: "https://raw.githubusercontent.com/leslieshen1/leslie-stock/data-live/a-snapshot.json",
};

type Quote = { price: number | null; pct: number | null; mcapB?: number | null; vol?: number | null; mcapYi?: number | null; postPct?: number | null };
export type QuoteMap = Record<string, Quote>;

export async function fetchSnapshotQuotes(market: "us" | "a", apiFallback: string): Promise<{ quotes: QuoteMap; src: "snap" | "api" }> {
  try {
    const r = await fetch(SNAP[market], { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      const fresh = typeof j?.ts === "number" && Date.now() - j.ts < 15 * 60_000;
      const closed = marketStatus(new Date(), market).state === "closed";
      if (j?.quotes && Object.keys(j.quotes).length && (fresh || closed)) {
        return { quotes: j.quotes as QuoteMap, src: "snap" };
      }
    }
  } catch {
    /* 落到 API 兜底 */
  }
  try {
    const j = await (await fetch(apiFallback, { cache: "no-store" })).json();
    return { quotes: (j?.quotes ?? {}) as QuoteMap, src: "api" };
  } catch {
    return { quotes: {}, src: "api" };
  }
}
