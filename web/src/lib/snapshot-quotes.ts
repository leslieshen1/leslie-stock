// CF 迁移 Phase 2 地基:客户端直读 data-live 快照(GitHub raw,免费 + 带 CORS),绕开 Vercel /api/market
// /api/a-market 函数 → 既砍 Vercel 账单(Observability/Origin Transfer/Fluid CPU 都按函数被打的次数走),
// 又是 CF 静态架构需要的"前端直取静态数据"形态(不是过渡白做)。
// 快照每 5 分钟由免费 GitHub Action 刷(腾讯 US/A 批量)。**只在「盘中(且新鲜)」或「休市」用快照**:
// 腾讯 [3] 盘中=实时常规价、休市=收盘价(都对),但【盘前/盘后停在收盘、不跟延伸时段】——那两段必须
// 回退 API(它用 Nasdaq /info 覆盖龙头真盘前/盘后价),否则列表盘前价格冻住。盘中快照过旧/失败也回退。
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
      const st = marketStatus(new Date(), market).state; // pre | open | post | closed
      const fresh = typeof j?.ts === "number" && Date.now() - j.ts < 15 * 60_000;
      // 只 open(且新鲜)或 closed 用快照;pre/post 回退 API 取真延伸时段价(腾讯 [3] 那两段冻在收盘)
      if (j?.quotes && Object.keys(j.quotes).length && ((st === "open" && fresh) || st === "closed")) {
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
