// 持仓 AI 生成(私密:Bearer STATS_TOKEN):{kind:"daily"} 当日持仓日报 | {kind:"review", lotId} 单笔平仓复盘。
// 直调 NDT Anthropic 通道(/v1/messages,同盘报/arena 的模型),env: NDT_BASE_URL + NDT_CLAUDE_KEY(或 NDT_API_KEY)。
// 现价由前端随请求带上(quotes:{"us|NVDA":{price,pct}}),服务端不打行情。产物写回 Upstash,前端即刻可读。
import { redis } from "@/lib/stats";
import { statsAuthed as authed } from "@/lib/api-guard";
import { PF, aggregate, CCY, r2, type Trade, type ClosedLot } from "@/lib/portfolio";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // NDT 生成一篇 20-60s,Vercel 函数上限放宽

type Quote = { price?: number | null; pct?: number | null };

async function ndt(system: string, user: string): Promise<string> {
  const base = (process.env.NDT_BASE_URL || "https://api.nadoutong.org").replace(/\/$/, "");
  const key = process.env.NDT_CLAUDE_KEY || process.env.NDT_API_KEY || "";
  if (!key) throw new Error("no-key");
  const model = process.env.NDT_REPORT_MODEL || "claude-opus-4-8";
  const r = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, system, max_tokens: 1600, messages: [{ role: "user", content: user }] }),
  });
  const j = (await r.json().catch(() => null)) as { error?: unknown; content?: { type: string; text?: string }[] } | null;
  if (!j || j.error) throw new Error(String(j?.error ?? `http ${r.status}`).slice(0, 180));
  const text = (j.content || []).filter((p) => p.type === "text").map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("empty");
  return text;
}

const SYSTEM =
  "你是 Leslie 的私人持仓助理。只对他一个人说话,平实、直接、像懂行的朋友,不用敬语不装腔。" +
  "绝不喊单、不给目标价;可以指出风险、集中度、和他自己定的理由是否还成立。" +
  "输出 Markdown,用 ### 小节,总长 350-600 字,中文。数字保留两位小数,涨跌带正负号。";

function posLines(trades: Trade[], quotes: Record<string, Quote>): { lines: string[]; totals: string[] } {
  const { positions } = aggregate(trades);
  const bySlice: Record<string, { mv: number; cost: number }> = {};
  const lines = positions.map((p) => {
    const q = quotes[`${p.market}|${p.sym}`] || {};
    const px = typeof q.price === "number" && q.price > 0 ? q.price : null;
    const mv = px ? px * p.qty : p.invested;
    const s = (bySlice[p.market] ||= { mv: 0, cost: 0 });
    s.mv += mv; s.cost += p.invested;
    const ccy = CCY[p.market];
    const pnl = px ? ((px / p.avgCost - 1) * 100).toFixed(2) : "?";
    const day = typeof q.pct === "number" ? q.pct.toFixed(2) : "?";
    return `- ${p.sym} ${p.name}(${p.market})${p.qty}股 · 成本${ccy}${p.avgCost} · 现价${px ? ccy + px : "无行情"} · 浮盈${pnl}% · 今日${day}% · 市值${ccy}${r2(mv)}` +
      (p.lastReason ? ` · 买入理由:${p.lastReason.slice(0, 60)}` : "");
  });
  const totals = Object.entries(bySlice).map(([m, s]) =>
    `${m.toUpperCase()} 市值 ${CCY[m as keyof typeof CCY]}${r2(s.mv)} / 成本 ${CCY[m as keyof typeof CCY]}${r2(s.cost)} / 浮盈 ${s.cost > 0 ? (((s.mv - s.cost) / s.cost) * 100).toFixed(2) : "0"}%`);
  return { lines, totals };
}

export async function POST(req: Request) {
  if (!authed(req)) return new Response("unauthorized", { status: 401 });
  const r = redis();
  if (!r) return Response.json({ connected: false }, { status: 503 });
  if (!(process.env.NDT_CLAUDE_KEY || process.env.NDT_API_KEY)) {
    return Response.json({ aiDisabled: true, error: "NDT key 未配置(Vercel env 加 NDT_CLAUDE_KEY 或 NDT_API_KEY,可选 NDT_BASE_URL)" }, { status: 501 });
  }

  let body: { kind?: string; lotId?: string; quotes?: Record<string, Quote> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const quotes = body.quotes || {};

  try {
    const raw = await r.get<string | Trade[]>(PF.trades);
    const trades: Trade[] = raw == null ? [] : typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!trades.length) return Response.json({ error: "还没有任何交易记录" }, { status: 400 });
    const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10); // 北京日

    if (body.kind === "daily") {
      const { lines, totals } = posLines(trades, quotes);
      const recent = trades.slice(-8).map((t) => `- ${t.date} ${t.side} ${t.sym} ${t.qty}股 @${t.price}${t.reason ? " 理由:" + t.reason.slice(0, 50) : ""}`);
      const user =
        `今天是 ${today}。这是我的真实持仓与最新行情快照,请给我今天的持仓日报。\n\n` +
        `【当前持仓】\n${lines.join("\n") || "(空仓)"}\n\n【分市场汇总】\n${totals.join("\n")}\n\n` +
        `【最近交易】\n${recent.join("\n")}\n\n` +
        `要求:### 总览(一句话今天整体怎么样) ### 逐仓要点(只挑值得说的 3-5 只:异动/浮亏扩大/理由是否还成立) ### 结构与风险(集中度/币种/现金观察) ### 明天盯什么(2-3 条具体的)。`;
      const md = await ndt(SYSTEM, user);
      const rawD = await r.get<string | { date: string }[]>(PF.daily);
      const daily: { date: string; md: string; genAt: number }[] = rawD == null ? [] : typeof rawD === "string" ? JSON.parse(rawD) : (rawD as { date: string; md: string; genAt: number }[]);
      const rec = { date: today, md, genAt: Date.now() };
      const i = daily.findIndex((d) => d.date === today);
      if (i >= 0) daily[i] = rec; else daily.push(rec);
      daily.sort((a, b) => a.date.localeCompare(b.date));
      await r.set(PF.daily, JSON.stringify(daily.slice(-40)));
      return Response.json({ ok: true, daily: rec });
    }

    if (body.kind === "review" && body.lotId) {
      const { lots } = aggregate(trades);
      const lot = lots.find((l) => l.lotId === body.lotId);
      if (!lot) return Response.json({ error: "lot 未找到(该笔可能还没平仓)" }, { status: 404 });
      const seq = lot.trades.map((t) => `- ${t.date} ${t.side} ${t.qty}股 @${t.price}${t.reason ? " · 当时理由:" + t.reason : ""}`);
      const user =
        `复盘我这笔已经结束的操作(${lot.sym} ${lot.name},${lot.market.toUpperCase()})。\n\n` +
        `【完整流水】\n${seq.join("\n")}\n\n` +
        `【结果】持有 ${lot.holdDays} 天 · 投入 ${CCY[lot.market]}${lot.buyAmt} · 卖回 ${CCY[lot.market]}${lot.sellAmt} · 盈亏 ${CCY[lot.market]}${lot.realized}(${lot.retPct >= 0 ? "+" : ""}${lot.retPct}%)\n\n` +
        `要求:### 这笔做了什么(一句话) ### 当初的理由成立吗(对照买入理由和实际结果,诚实,别安慰我) ### 做对与做错(各 1-2 条,具体到买卖点) ### 一条带走的教训(一句话,可执行)。`;
      const md = await ndt(SYSTEM, user);
      const rawV = await r.get<string | unknown[]>(PF.reviews);
      const reviews: (Partial<ClosedLot> & { md: string; genAt: number })[] =
        rawV == null ? [] : typeof rawV === "string" ? JSON.parse(rawV) : (rawV as (Partial<ClosedLot> & { md: string; genAt: number })[]);
      const rec = { lotId: lot.lotId, market: lot.market, sym: lot.sym, name: lot.name, openDate: lot.openDate, closeDate: lot.closeDate, holdDays: lot.holdDays, realized: lot.realized, retPct: lot.retPct, buyAmt: lot.buyAmt, md, genAt: Date.now() };
      const i = reviews.findIndex((v) => v.lotId === lot.lotId);
      if (i >= 0) reviews[i] = rec; else reviews.unshift(rec);
      await r.set(PF.reviews, JSON.stringify(reviews.slice(0, 100)));
      return Response.json({ ok: true, review: rec });
    }

    return Response.json({ error: "unknown kind" }, { status: 400 });
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 200);
    if (msg === "no-key") return Response.json({ aiDisabled: true }, { status: 501 });
    return Response.json({ error: msg }, { status: 502 });
  }
}
