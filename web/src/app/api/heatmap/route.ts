import { promises as fs } from "fs";
import path from "path";
import { fetchWithTimeout } from "@/lib/api-guard";

// 方块热力图数据:服务端吐精简 top-N(不把全量塞前端)。
// 美股:us-stocks.json(静态,市值+涨跌+板块,日更)。
// A股:aleabit_manifest(名字+市值)+ a-industry(行业)+ 腾讯实时(涨跌,只抓 top-N)。
export const dynamic = "force-dynamic";

type Slim = { sym: string; name: string; mcapB: number; pct: number; sector: string };
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

async function usHeatmap(n: number): Promise<Slim[]> {
  const p = path.join(process.cwd(), "public", "data", "us-stocks.json");
  const all: Record<string, unknown>[] = JSON.parse(await fs.readFile(p, "utf-8")).stocks || [];
  return all
    .filter((s) => s.country === "United States" && !s.capDup && Number(s.mcapB) > 0 && s.sector && s.pct != null)
    .sort((a, b) => Number(b.mcapB) - Number(a.mcapB))
    .slice(0, n)
    .map((s) => ({ sym: String(s.sym), name: String(s.name || s.sym), mcapB: r1(Number(s.mcapB)), pct: r2(Number(s.pct)), sector: String(s.sector) }));
}

function tencentSym(code: string): string | null {
  if (/^6/.test(code)) return "sh" + code;
  if (/^[03]/.test(code)) return "sz" + code;
  if (/^[48]/.test(code)) return "bj" + code;
  return null;
}

// 腾讯实时涨跌(只抓给定 codes,2 波并发)。字段 [32]=涨跌%。GBK 解码同 a-market。
async function aPct(codes: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const syms = codes.map((c) => [c, tencentSym(c)] as const).filter(([, s]) => s);
  const batches: (readonly [string, string | null])[][] = [];
  for (let i = 0; i < syms.length; i += 80) batches.push(syms.slice(i, i + 80));
  await Promise.all(
    batches.map(async (batch) => {
      try {
        const r = await fetchWithTimeout(
          `https://qt.gtimg.cn/q=${batch.map(([, s]) => s).join(",")}`,
          { headers: { referer: "https://gu.qq.com/", "user-agent": "Mozilla/5.0" }, next: { revalidate: 60 } },
          7000,
        );
        const txt = new TextDecoder("gbk").decode(await r.arrayBuffer());
        for (const line of txt.split(";")) {
          const m = line.match(/v_(?:sh|sz|bj)(\d{6})="(.*)"/);
          if (!m) continue;
          const pct = parseFloat(m[2].split("~")[32] ?? "");
          if (Number.isFinite(pct)) out[m[1]] = pct;
        }
      } catch {
        /* 单批失败跳过 */
      }
    }),
  );
  return out;
}

async function aHeatmap(n: number): Promise<Slim[]> {
  const dir = path.join(process.cwd(), "public", "data");
  const [manRaw, indRaw] = await Promise.all([
    fs.readFile(path.join(dir, "aleabit_manifest.json"), "utf-8"),
    fs.readFile(path.join(dir, "a-industry.json"), "utf-8").catch(() => "{}"),
  ]);
  const man = JSON.parse(manRaw) as Record<string, unknown>[];
  const ind = JSON.parse(indRaw) as Record<string, string>;
  const top = man
    .filter((m) => m.market === "a" && Number(m.market_cap_yi) > 0 && m.code)
    .sort((a, b) => Number(b.market_cap_yi) - Number(a.market_cap_yi))
    .slice(0, n);
  const pct = await aPct(top.map((m) => String(m.code)));
  return top.map((m) => ({
    sym: String(m.code),
    name: String(m.name || m.code),
    mcapB: r1(Number(m.market_cap_yi)),
    pct: r2(pct[String(m.code)] ?? 0),
    sector: ind[String(m.code)] || "其他",
  }));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const market = url.searchParams.get("market") === "a" ? "a" : "us";
  const n = Math.min(400, Math.max(40, Number(url.searchParams.get("n")) || 160));
  try {
    const stocks = market === "a" ? await aHeatmap(n) : await usHeatmap(n);
    return Response.json(
      { stocks, n: stocks.length, market },
      { headers: { "cache-control": "s-maxage=120, stale-while-revalidate=600" } },
    );
  } catch {
    return Response.json({ stocks: [], n: 0, market });
  }
}
