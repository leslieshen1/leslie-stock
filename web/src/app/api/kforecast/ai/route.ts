// K线情景推演 · AI 端(私密:Bearer STATS_TOKEN):技术快照 + 回测统计 → NDT Claude 输出三条情景路径(JSON)。
// 约束写进 prompt:情景须与回测分位锥大体相容、概率合计=1、只做概率推演绝不构成建议。
import { statsAuthed as authed } from "@/lib/api-guard";
import type { Backtest, TechSnapshot, Candle } from "@/lib/kforecast";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export type Scenario = { name: string; prob: number; path: number[]; why: string };
export type AiRead = { read: string; scenarios: Scenario[] };

async function ndt(system: string, user: string, modelOverride?: string): Promise<string> {
  const base = (process.env.NDT_BASE_URL || "https://api.nadoutong.org").replace(/\/$/, "");
  const key = process.env.NDT_CLAUDE_KEY || process.env.NDT_API_KEY || "";
  if (!key) throw new Error("no-key");
  const model = modelOverride || process.env.NDT_REPORT_MODEL || "claude-opus-4-8";
  const r = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, system, max_tokens: 2000, messages: [{ role: "user", content: user }] }),
  });
  const j = (await r.json().catch(() => null)) as { error?: unknown; content?: { type: string; text?: string }[] } | null;
  if (!j || j.error) {
    const e = j?.error;
    throw new Error((typeof e === "object" && e !== null ? JSON.stringify(e) : String(e ?? `http ${r.status}`)).slice(0, 300));
  }
  const text = (j.content || []).filter((p) => p.type === "text").map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("empty");
  return text;
}

const SYSTEM =
  "你是一位严谨的技术分析师,给 Leslie 一个人做 K 线情景推演。你清楚:技术分析是概率不是预言,历史相似形态的统计只是参考。" +
  "你的输出必须是严格的 JSON(不要 markdown 代码栅栏、不要任何 JSON 之外的文字),结构:" +
  '{"read":"80-140字的盘面解读,平实中文,指出当前形态/量能/位置的关键矛盾","scenarios":[{"name":"乐观情景","prob":0.3,"path":[10个数字],"why":"40-80字理由"},{"name":"基准情景",...},{"name":"悲观情景",...}]}。' +
  "硬约束:①三个 prob 合计=1,按你对技术面的真实判断分配,别一律 0.3/0.4/0.3;②path 是未来10个交易日相对现价的累计涨跌%(如 [0.5,1.2,...]),要画得像真实K线走势(有回踩有波动,不是直线);" +
  "③三条 path 要与给你的回测分位锥大体相容:乐观大致落在 p75-p90 一带、基准围绕 p40-p60、悲观落在 p10-p25,可依技术面判断适度偏移但不得远超 p90/低破 p10 的 1.5 倍;④绝不出现\"建议买入/卖出\"等字样。";

export async function POST(req: Request) {
  if (!authed(req)) return new Response("unauthorized", { status: 401 });
  if (!(process.env.NDT_CLAUDE_KEY || process.env.NDT_API_KEY)) {
    return Response.json({ aiDisabled: true, error: "NDT key 未配置" }, { status: 501 });
  }
  let body: { sym?: string; name?: string; market?: string; tech?: TechSnapshot; backtest?: Backtest; recent?: Candle[]; model?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const { sym, name, market, tech, backtest, recent } = body;
  if (!sym || !tech || !backtest) return Response.json({ error: "缺参数" }, { status: 400 });

  const f = backtest.fan;
  const lastIdx = backtest.fwd - 1;
  const user =
    `标的:${name || sym}(${sym},${(market || "us").toUpperCase()}),现价 ${tech.price}。\n\n` +
    `【技术快照】5日${tech.chg5}% 20日${tech.chg20}% 60日${tech.chg60}% | MA5 ${tech.ma5} / MA20 ${tech.ma20} / MA60 ${tech.ma60} | ` +
    `BOLL ${tech.bollLow}~${tech.bollMid}~${tech.bollUp} | RSI14 ${tech.rsi14} | MACD dif ${tech.macd.dif} dea ${tech.macd.dea} 柱 ${tech.macd.hist} | ` +
    `量比(5日/前20日) ${tech.volR5} | 52周 ${tech.lo52}~${tech.hi52},现价位于 ${tech.posIn52}% 分位。\n\n` +
    `【相似形态回测】用最近 ${backtest.win} 日形态在该股全历史(${backtest.samples} 个可比窗口)找到 ${backtest.topK} 个最相似段,它们之后 ${backtest.fwd} 日的真实走势分布:\n` +
    `第${backtest.fwd}日累计:p10 ${f.p10[lastIdx]}% / p25 ${f.p25[lastIdx]}% / 中位 ${f.p50[lastIdx]}% / p75 ${f.p75[lastIdx]}% / p90 ${f.p90[lastIdx]}%;` +
    `上涨占比 ${(backtest.horizon.upProb * 100).toFixed(0)}%,均值 ${backtest.horizon.mean}%,最好 ${backtest.horizon.best}%,最差 ${backtest.horizon.worst}%。\n` +
    `逐日中位路径:[${f.p50.join(", ")}]。头部相似段(日期/相似度/末日收益):${backtest.matches.slice(0, 6).map((m) => `${m.endDate} ${m.sim} ${m.fwd[lastIdx]}%`).join(" | ")}\n\n` +
    `【最近10根日K】${(recent || []).slice(-10).map((k) => `${k.d.slice(5)} 开${k.o}收${k.c}高${k.h}低${k.l}`).join(" / ")}\n\n` +
    `请输出 JSON。`;

  try {
    const mdl = body.model && /^[a-z0-9.\-]{3,40}$/i.test(body.model) ? body.model : undefined;
    const raw = await ndt(SYSTEM, user, mdl);
    const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(clean) as AiRead;
    if (!parsed.read || !Array.isArray(parsed.scenarios) || parsed.scenarios.length !== 3) throw new Error("结构不符");
    for (const s of parsed.scenarios) {
      if (!Array.isArray(s.path) || s.path.length !== backtest.fwd) throw new Error("path 长度不符");
      s.path = s.path.map((x) => Math.round(Number(x) * 100) / 100);
      s.prob = Math.round(Number(s.prob) * 100) / 100;
    }
    return Response.json({ ok: true, ai: parsed, genAt: Date.now() });
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 200);
    if (msg === "no-key") return Response.json({ aiDisabled: true }, { status: 501 });
    return Response.json({ error: msg }, { status: 502 });
  }
}
