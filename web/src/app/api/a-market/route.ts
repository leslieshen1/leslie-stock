// A 股全盘实时快照(腾讯行情,免费无 key,批量拉)。列表轮询用,字段对齐美股 /api/market。
// 腾讯 q=sh600519,sz000858… 一次最多 ~80 只;5510 只分批并发 → 服务端 60s 缓存。
import { promises as fs } from "fs";
import path from "path";
import { clientIp, rateLimit, tooMany, fetchWithTimeout } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

// 上次成功的全盘快照 —— 腾讯整体抽风/被限时,serve 上次好值,避免列表价格全空白。
type AQuote = { price: number | null; pct: number | null; vol: number | null; mcapYi: number | null };
let A_LAST_GOOD: { quotes: Record<string, AQuote>; ts: number } | null = null;

function tencentSym(code: string): string | null {
  if (/^6/.test(code)) return "sh" + code;          // 沪市主板/科创板(688)
  if (/^[03]/.test(code)) return "sz" + code;        // 深市主板/创业板(300)
  if (/^[48]/.test(code)) return "bj" + code;        // 北交所
  return null;
}

function num(s: string | undefined): number | null {
  const v = parseFloat(s ?? "");
  return Number.isFinite(v) ? v : null;
}

let CODES: string[] | null = null;
async function allCodes(): Promise<string[]> {
  if (CODES) return CODES;
  try {
    const p = path.join(process.cwd(), "public", "data", "aleabit_manifest.json");
    const man = JSON.parse(await fs.readFile(p, "utf-8")) as { code: string }[];
    CODES = man.map((x) => x.code).filter(Boolean);
  } catch {
    CODES = [];
  }
  return CODES;
}

export async function GET(req: Request) {
  // 限流:整盘快照较重,每 IP 30 次/分钟足够(正常 60s 轮询一次)。
  const rl = rateLimit(`amkt:${clientIp(req)}`, 30, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfter);

  try {
    const codes = await allCodes();
    const syms = codes.map(tencentSym).filter(Boolean) as string[];
    const BATCH = 80;
    const batches: string[][] = [];
    for (let i = 0; i < syms.length; i += BATCH) batches.push(syms.slice(i, i + BATCH));

    const quotes: Record<string, { price: number | null; pct: number | null; vol: number | null; mcapYi: number | null }> = {};
    // 并发拉(限流:每波 ~12 个,避免被腾讯掐)
    const WAVE = 12;
    for (let i = 0; i < batches.length; i += WAVE) {
      const wave = batches.slice(i, i + WAVE);
      await Promise.all(
        wave.map(async (b) => {
          try {
            const r = await fetchWithTimeout(`https://qt.gtimg.cn/q=${b.join(",")}`, {
              headers: { referer: "https://gu.qq.com/", "user-agent": "Mozilla/5.0" },
              next: { revalidate: 60 },
            }, 7000);
            const txt = await r.text();
            for (const line of txt.split(";")) {
              const m = line.match(/v_(?:sh|sz|bj)(\d{6})="(.*)"/);
              if (!m) continue;
              const p = m[2].split("~");
              // [3]现价 [6]成交量(手) [32]涨跌% [45]总市值(亿)
              quotes[m[1]] = { price: num(p[3]), pct: num(p[32]), vol: num(p[6]), mcapYi: num(p[45]) };
            }
          } catch {
            /* 单批失败跳过 */
          }
        }),
      );
    }
    const count = Object.keys(quotes).length;
    if (count > 0) {
      A_LAST_GOOD = { quotes, ts: Date.now() };
      return Response.json(
        { quotes, ts: A_LAST_GOOD.ts, count },
        { headers: { "cache-control": "s-maxage=60" } },
      );
    }
    // 全部批次失败 → 降级到上次好值(带 stale 标记)
    if (A_LAST_GOOD) {
      return Response.json(
        { quotes: A_LAST_GOOD.quotes, ts: A_LAST_GOOD.ts, count: Object.keys(A_LAST_GOOD.quotes).length, stale: true },
        { headers: { "cache-control": "s-maxage=30" } },
      );
    }
    return Response.json({ quotes: {}, ts: Date.now(), count: 0 });
  } catch {
    if (A_LAST_GOOD) {
      return Response.json({ quotes: A_LAST_GOOD.quotes, ts: A_LAST_GOOD.ts, stale: true }, { headers: { "cache-control": "s-maxage=30" } });
    }
    return Response.json({ quotes: {}, ts: Date.now() });
  }
}
