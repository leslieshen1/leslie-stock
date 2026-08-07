// K线情景推演 · AI 端(私密:Bearer STATS_TOKEN):技术快照 + 回测统计 → NDT Claude 输出三条情景路径(JSON)。
// 约束写进 prompt:情景须与回测分位锥大体相容、概率合计=1、只做概率推演绝不构成建议。
import { statsAuthed as authed } from "@/lib/api-guard";
import type { Backtest, TechSnapshot, Candle, Validation } from "@/lib/kforecast";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export type Scenario = { name: string; prob: number; path: number[]; why: string };
export type AiRead = { read: string; scenarios: Scenario[] };

async function ndt(system: string, user: string, modelOverride?: string): Promise<string> {
  const base = (process.env.NDT_BASE_URL || "https://api.nxtpath.ai").replace(/\/$/, "");
  const key = process.env.NDT_CLAUDE_KEY || process.env.NDT_API_KEY || "";
  if (!key) throw new Error("no-key");
  const model = modelOverride || process.env.NDT_REPORT_MODEL || "claude-opus-4-8";
  const r = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, system, max_tokens: 2000, messages: [{ role: "user", content: user }] }),
  });
  const j = (await r.json().catch(() => null)) as { error?: { retryable?: boolean } | unknown; content?: { type: string; text?: string }[] } | null;
  if (!j || j.error) {
    const e = j?.error;
    const retryable = typeof e === "object" && e !== null && (e as { retryable?: boolean }).retryable === true;
    const err = new Error((typeof e === "object" && e !== null ? JSON.stringify(e) : String(e ?? `http ${r.status}`)).slice(0, 300));
    (err as Error & { retryable?: boolean }).retryable = retryable;
    throw err;
  }
  const text = (j.content || []).filter((p) => p.type === "text").map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("empty");
  return text;
}

// 降级通道:NDT OpenAI 式 /v1/responses,必须 stream:true(非流式一律 MODEL_NOT_AVAILABLE)。key 用 NDT_API_KEY。
async function ndtGpt(prompt: string): Promise<string> {
  const base = (process.env.NDT_BASE_URL || "https://api.nxtpath.ai").replace(/\/$/, "");
  const key = process.env.NDT_API_KEY || "";
  if (!key) throw new Error("no-gpt-key");
  const r = await fetch(`${base}/v1/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.NDT_GPT_MODEL || "gpt-5.5", stream: true, input: prompt }),
  });
  if (!r.ok || !r.body) throw new Error(`gpt http ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let j: { type?: string; delta?: string };
      try { j = JSON.parse(data); } catch { continue; }
      if (j.type === "response.output_text.delta") out += j.delta || "";
      else if (j.type === "response.failed" || j.type === "error") throw new Error(JSON.stringify(j).slice(0, 200));
    }
  }
  if (!out.trim()) throw new Error("gpt 空回复");
  return out.trim();
}

// 优先 Claude(retryable 退避重试 claudeTries 次),持续不可用 → 降级 gpt-5.5(它偶发 502 也退避重试)。
// 时间预算:Claude 2×~7s + gpt 3×~25s + 退避 ≈ 96s < maxDuration 120s。两条都挂才抛。
async function llm(system: string, user: string, model?: string, claudeTries = 2): Promise<string> {
  let last: unknown;
  for (let i = 0; i < claudeTries; i++) {
    try { return await ndt(system, user, model); }
    catch (e) {
      last = e;
      if (!(e as Error & { retryable?: boolean }).retryable || i === claudeTries - 1) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  const prompt = system ? system + "\n\n" + user : user;
  let gptLast: unknown;
  for (let i = 0; i < 3; i++) {
    try { return await ndtGpt(prompt); }
    catch (e2) {
      gptLast = e2;
      if (String((e2 as Error)?.message) === "no-gpt-key") throw last; // gpt 没配,报 Claude 原始错
      if (i < 2) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error(`Claude+gpt 双挂:claude=${String((last as Error)?.message).slice(0, 80)} | gpt=${String((gptLast as Error)?.message).slice(0, 80)}`);
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
  let body: { sym?: string; name?: string; market?: string; tech?: TechSnapshot; backtest?: Backtest; validation?: Validation | null; recent?: Candle[]; model?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const { sym, name, market, tech, backtest, validation, recent } = body;
  if (!sym || !tech || !backtest) return Response.json({ error: "缺参数" }, { status: 400 });

  const f = backtest.fan;
  const lastIdx = backtest.fwd - 1;
  const volLine = (recent || []).slice(-10).map((k) => `${k.d.slice(5)} ${k.c >= k.o ? "阳" : "阴"}量${k.v ? Math.round(k.v / 1e4) + "万" : "?"}`).join(" ");
  const user =
    `标的:${name || sym}(${sym},${(market || "us").toUpperCase()}),现价 ${tech.price}。\n\n` +
    `【趋势】均线排列${tech.maAlign === "bull" ? "多头(MA5>20>60)" : tech.maAlign === "bear" ? "空头(MA5<20<60)" : "纠缠"} | 5日${tech.chg5}% 20日${tech.chg20}% 60日${tech.chg60}% | MA5 ${tech.ma5}/MA20 ${tech.ma20}/MA60 ${tech.ma60}\n` +
    `【动量】RSI14 ${tech.rsi14} | MACD dif ${tech.macd.dif} dea ${tech.macd.dea} 柱 ${tech.macd.hist}\n` +
    `【波动】ATR ${tech.atrPct}%(近14日日均真实波幅) | 历史波动率 ${tech.histVol}%(年化) | BOLL ${tech.bollLow}~${tech.bollMid}~${tech.bollUp} 带宽 ${tech.bollW}%\n` +
    `【量能】量比(5日/前20日) ${tech.volR5} | OBV ${tech.obvUp ? "近10日走升(量在推价)" : "近10日走平/降"} | 最近一根 ${tech.volPrice}\n` +
    `【位置】52周 ${tech.lo52}~${tech.hi52},现价 ${tech.posIn52}% 分位\n` +
    `【近10根量价】${volLine}\n\n` +
    `【相似形态回测】最近 ${backtest.win} 日形态在全历史 ${backtest.samples} 窗口中取 ${backtest.topK} 个最相似段,之后 ${backtest.fwd} 日走势分布:\n` +
    `第${backtest.fwd}日:p10 ${f.p10[lastIdx]}% / p25 ${f.p25[lastIdx]}% / 中位 ${f.p50[lastIdx]}% / p75 ${f.p75[lastIdx]}% / p90 ${f.p90[lastIdx]}%;上涨占比 ${(backtest.horizon.upProb * 100).toFixed(0)}%,均值 ${backtest.horizon.mean}%。逐日中位:[${f.p50.join(", ")}]\n\n` +
    (validation
      ? `【⚠️ 这套方法的样本外准确度(务必据此收敛你的自信)】在该股全历史滚动 ${validation.points} 次样本外测试:方向命中率 ${(validation.dirAcc * 100).toFixed(0)}%,基准(闭眼押多数方向)${(validation.naiveBest * 100).toFixed(0)}%,超额 ${(validation.edge * 100).toFixed(0)} 个点;80% 概率区间实测覆盖 ${(validation.cover80 * 100).toFixed(0)}%。结论:${validation.verdict}\n` +
        `→ 如果超额≤1个点,说明形态对方向几乎没有预测力,你的三情景概率不要过度偏向某一边、要贴近回测分布本身;如果覆盖率明显偏离80%,提醒用户概率锥的可信度。\n\n`
      : "") +
    `请输出 JSON。read 里必须点出量价配合与这套方法的准确度边界;三条 path 与回测分位锥相容。`;

  try {
    const mdl = body.model && /^[a-z0-9.\-]{3,40}$/i.test(body.model) ? body.model : undefined;
    const raw = await llm(SYSTEM, user, mdl);
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
