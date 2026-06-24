// A 股全盘实时快照(腾讯行情,免费无 key,批量拉)。列表轮询用,字段对齐美股 /api/market。
// 腾讯 q=sh600519,sz000858… 一次最多 ~80 只;5510 只分批并发 → 服务端 60s 缓存。
import { promises as fs } from "fs";
import path from "path";
import { clientIp, rateLimit, tooMany, fetchWithTimeout } from "@/lib/api-guard";

// 不 force-dynamic(它让边缘不缓存)。读 req(限流)本就动态;用 Vercel-CDN-Cache-Control 让边缘缓存 55s,函数少打。

// 上次成功的全盘快照 —— 腾讯整体抽风/被限时,serve 上次好值,避免列表价格全空白。
type AQuote = { price: number | null; pct: number | null; vol: number | null; mcapYi: number | null };
let A_LAST_GOOD: { quotes: Record<string, AQuote>; ts: number } | null = null;
// 省钱:GitHub Actions 每 5 分钟产出的 A 股全盘快照(data-live 分支,raw CDN 免费)。优先读它 → 省掉每请求 ~69 批腾讯。
const SNAP_A_URL = "https://raw.githubusercontent.com/leslieshen1/leslie-stock/data-live/a-snapshot.json";

function tencentSym(code: string): string | null {
  if (/^6/.test(code)) return "sh" + code;          // 沪市主板/科创板(688)
  if (/^[03]/.test(code)) return "sz" + code;        // 深市主板/创业板(300)
  if (/^(?:[48]|92)/.test(code)) return "bj" + code; // 北交所(含新代码段 920xxx;9 开头只认 92,避开 900xxx 沪B股)
  return null;
}

function num(s: string | undefined): number | null {
  const v = parseFloat(s ?? "");
  return Number.isFinite(v) ? v : null;
}

// A 股是否在交易时段(北京时间 = UTC+8;周一~五 9:15–11:30 / 13:00–15:00)。收盘/午休/周末价格不变 → 缓存可拉长。
function aMarketLive(): boolean {
  const bj = new Date(Date.now() + 8 * 3600_000); // UTC→北京
  const day = bj.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hm = bj.getUTCHours() * 100 + bj.getUTCMinutes();
  return (hm >= 915 && hm <= 1130) || (hm >= 1300 && hm <= 1500);
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

  // 省钱快路:优先读 GitHub 快照(A 股全盘,盘中每 5 分钟刷)。命中即省掉 ~69 批腾讯。
  // 交易时段要求 20 分钟内新鲜;收盘/午休价格不变、任意快照都用。读不到/太旧 → 落到下面现拉。
  try {
    const snap = await fetchWithTimeout(SNAP_A_URL, {}, 6000).then((x) => x.json()).catch(() => null);
    const fresh = !aMarketLive() || (snap?.ts != null && Date.now() - snap.ts < 20 * 60_000);
    if (snap?.quotes && Object.keys(snap.quotes).length > 1000 && fresh) {
      A_LAST_GOOD = { quotes: snap.quotes, ts: snap.ts };
      return Response.json(
        { quotes: snap.quotes, ts: snap.ts, count: snap.count ?? Object.keys(snap.quotes).length, src: "snap" },
        { headers: {
          "cache-control": "public, max-age=0, must-revalidate",
          "Vercel-CDN-Cache-Control": `max-age=${aMarketLive() ? 180 : 900}, stale-while-revalidate=120`,
        } },
      );
    }
  } catch { /* 快照不可用 → 退回现拉 */ }

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
            // GBK 正确解码(同 a-fundamentals):避免名字含 0x7E 字节把 ~ 字段切错位
            const txt = new TextDecoder("gbk").decode(await r.arrayBuffer());
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
      // 只在快照足够完整(≥半数)时才更新"上次好值",避免偶发的部分批失败把它污染成稀疏集
      if (count >= syms.length * 0.5) A_LAST_GOOD = { quotes, ts: Date.now() };
      return Response.json(
        { quotes, ts: Date.now(), count },
        { headers: {
          "cache-control": "public, max-age=0, must-revalidate",
          // 止血:A 股交易时段边缘缓存 3min;**收盘/午休/周末(占一天 ~20h)价格不变 → 15min**;每次 ~69 批腾讯外部请求随之大砍。
          "Vercel-CDN-Cache-Control": `max-age=${aMarketLive() ? 180 : 900}, stale-while-revalidate=120`,
        } },
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
