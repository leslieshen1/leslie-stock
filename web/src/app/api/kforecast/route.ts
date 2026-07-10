// K线情景推演 · 数据端(私密:Bearer STATS_TOKEN):拉全历史日线 → 相似形态回测 + 技术快照。
// A/港股走腾讯 fqkline(前复权),美股走 Yahoo chart;北交所腾讯历史极短,数据不足时如实报错。
import { statsAuthed as authed } from "@/lib/api-guard";
import { analogBacktest, techSnapshot, walkForwardValidate, type Candle } from "@/lib/kforecast";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 样本外回测滚动几百次,留足时间

const UA = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" };

async function fetchTencent(sym: string, market: "a" | "hk"): Promise<{ name: string; candles: Candle[] }> {
  const code =
    market === "hk"
      ? "hk" + sym.padStart(5, "0")
      : (sym.startsWith("6") ? "sh" : /^(92|43|83|87)/.test(sym) ? "bj" : "sz") + sym;
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,800,qfq`;
  const j = (await fetch(url, { headers: UA, cache: "no-store" }).then((r) => r.json())) as {
    data?: Record<string, { qfqday?: string[][]; day?: string[][]; qt?: Record<string, string[]> }>;
  };
  const d = j?.data?.[code];
  const rows = d?.qfqday || d?.day || [];
  const name = d?.qt?.[code]?.[1] || sym;
  return {
    name,
    candles: rows.map((r) => ({ d: r[0], o: +r[1], c: +r[2], h: +r[3], l: +r[4], v: +r[5] })), // 腾讯序:开收高低量
  };
}

async function fetchYahoo(sym: string): Promise<{ name: string; candles: Candle[] }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5y&interval=1d`;
  const j = (await fetch(url, { headers: UA, cache: "no-store" }).then((r) => r.json())) as {
    chart?: { result?: { meta?: { longName?: string; shortName?: string }; timestamp?: number[]; indicators?: { quote?: { open?: number[]; high?: number[]; low?: number[]; close?: number[]; volume?: number[] }[] } }[] };
  };
  const res = j?.chart?.result?.[0];
  const ts = res?.timestamp || [];
  const q = res?.indicators?.quote?.[0];
  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q?.open?.[i], h = q?.high?.[i], l = q?.low?.[i], c = q?.close?.[i];
    if (o == null || h == null || l == null || c == null) continue; // 停牌/空洞
    candles.push({ d: new Date(ts[i] * 1000).toISOString().slice(0, 10), o, h, l, c, v: q?.volume?.[i] || 0 });
  }
  return { name: res?.meta?.longName || res?.meta?.shortName || sym, candles };
}

export async function GET(req: Request) {
  if (!authed(req)) return new Response("unauthorized", { status: 401 });
  const u = new URL(req.url);
  const sym = (u.searchParams.get("sym") || "").trim().toUpperCase();
  const market = (u.searchParams.get("market") || "us").toLowerCase();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(sym)) return Response.json({ error: "代码不合法" }, { status: 400 });
  if (!["us", "a", "hk"].includes(market)) return Response.json({ error: "market 不合法" }, { status: 400 });

  try {
    const { name, candles } =
      market === "us" ? await fetchYahoo(sym) : await fetchTencent(sym, market as "a" | "hk");
    if (candles.length < 90) {
      return Response.json({ error: `历史日线不足(拿到 ${candles.length} 根)——新股/北交所常见,做不了形态回测` }, { status: 422 });
    }
    const bt = analogBacktest(candles);
    if ("error" in bt) return Response.json({ error: bt.error }, { status: 422 });
    const val = walkForwardValidate(candles); // 样本外滚动回测:这套方法在本票上准不准
    return Response.json({
      sym, market, name,
      tech: techSnapshot(candles),
      backtest: { ...bt, matches: bt.matches.slice(0, 12) }, // 前端展示只要头部匹配
      validation: "error" in val ? null : val,
      validationErr: "error" in val ? val.error : null,
      candles: candles.slice(-70), // 画图只要尾部
      total: candles.length,
    });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e).slice(0, 160) }, { status: 502 });
  }
}
