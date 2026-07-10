"use client";

// K线情景推演(私密工具,口令同 /stats):
// 输入代码 → 全历史相似形态回测(概率锥) → AI 三条情景路径叠加在 K 线右侧。
// 视觉:深色终端高密度(同 /leslie 调色板);诚实边界常驻页脚。
import { useCallback, useEffect, useRef, useState } from "react";
import type { Backtest, Candle, TechSnapshot } from "@/lib/kforecast";

type Scenario = { name: string; prob: number; path: number[]; why: string };
type Data = { sym: string; market: string; name: string; tech: TechSnapshot; backtest: Backtest; candles: Candle[]; total: number };

const INK = "text-[#d6dbe4]", MUT = "text-[#8a93a3]", FAINT = "text-[#5a6372]";
const UP = "#22c55e", DN = "#f4525f", ACC = "#fb923c", BASE = "#8a93a3";
const PANEL = "border border-[#262b35] bg-[#15181e]";
const INPUT = "rounded border border-[#2c323e] bg-[#0e1014] px-2 py-1.5 text-[12px] text-[#d6dbe4] outline-none focus:border-[#fb923c66]";
const BTN = "rounded border border-[#2c323e] bg-[#1a1e26] px-2.5 py-1 text-[11px] text-[#8a93a3] transition hover:text-[#d6dbe4] hover:border-[#3a4150] disabled:opacity-40";
const BTN_ACC = "rounded bg-[#fb923c] px-2.5 py-1 text-[11px] font-semibold text-[#1a0f08] transition hover:brightness-110 disabled:opacity-40";
const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number, d = 2) => `${n >= 0 ? "+" : ""}${fmt(n, d)}`;

/* ---------- 主图:蜡烛 + 概率锥 + 情景路径 ---------- */
function Chart({ data, ai }: { data: Data; ai: Scenario[] | null }) {
  const W = 960, H = 430, PAD_T = 14, PAD_B = 26, AXIS_W = 56;
  const candles = data.candles.slice(-56);
  const fwd = data.backtest.fwd;
  const price = data.tech.price;
  const fan = data.backtest.fan;

  const plotW = W - AXIS_W;
  const histW = plotW * 0.72, fwdW = plotW * 0.28;
  const cw = histW / candles.length;
  const fx = (t: number) => histW + ((t + 1) / fwd) * (fwdW - 8); // 未来第 t 日(0-based)的 x

  const toPrice = (pct: number) => price * (1 + pct / 100);
  const lows = candles.map((k) => k.l), highs = candles.map((k) => k.h);
  const fanPrices = [...fan.p10, ...fan.p90].map(toPrice);
  const aiPrices = (ai || []).flatMap((s) => s.path.map(toPrice));
  const yMin = Math.min(...lows, ...fanPrices, ...aiPrices) * 0.995;
  const yMax = Math.max(...highs, ...fanPrices, ...aiPrices) * 1.005;
  const y = (p: number) => PAD_T + ((yMax - p) / (yMax - yMin)) * (H - PAD_T - PAD_B);

  const lastX = histW - cw / 2;
  const fanPoly = (up: number[], dn: number[]) => {
    const pts = [`${lastX},${y(price)}`];
    up.forEach((v, t) => pts.push(`${fx(t)},${y(toPrice(v))}`));
    for (let t = dn.length - 1; t >= 0; t--) pts.push(`${fx(t)},${y(toPrice(dn[t]))}`);
    pts.push(`${lastX},${y(price)}`);
    return pts.join(" ");
  };
  const pathLine = (path: number[]) => [`${lastX},${y(price)}`, ...path.map((v, t) => `${fx(t)},${y(toPrice(v))}`)].join(" ");
  const gridLines = 5;
  const scColor = (n: string) => (n.includes("乐") ? UP : n.includes("悲") ? DN : BASE);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {/* 网格 + 右轴 */}
      {Array.from({ length: gridLines + 1 }, (_, i) => {
        const p = yMin + ((yMax - yMin) * i) / gridLines;
        return (
          <g key={i}>
            <line x1={0} x2={plotW} y1={y(p)} y2={y(p)} stroke="#1e222b" strokeWidth={1} />
            <text x={plotW + 6} y={y(p) + 3.5} fontSize={10} fill="#5a6372" fontFamily="ui-monospace,monospace">{fmt(p, p >= 100 ? 1 : 2)}</text>
          </g>
        );
      })}
      {/* 未来区分隔 */}
      <line x1={histW} x2={histW} y1={PAD_T} y2={H - PAD_B} stroke="#2c323e" strokeWidth={1} strokeDasharray="3 3" />
      <text x={histW + 6} y={PAD_T + 9} fontSize={9.5} fill="#5a6372">未来 {fwd} 交易日 · 概率锥=相似形态回测分位</text>

      {/* 概率锥 p10-p90 / p25-p75 / p50 */}
      <polygon points={fanPoly(fan.p90, fan.p10)} fill="#8a93a3" opacity={0.1} />
      <polygon points={fanPoly(fan.p75, fan.p25)} fill="#8a93a3" opacity={0.16} />
      <polyline points={pathLine(fan.p50)} fill="none" stroke="#6b7484" strokeWidth={1.2} strokeDasharray="2 3" />

      {/* 蜡烛 */}
      {candles.map((k, i) => {
        const cx = i * cw + cw / 2;
        const up = k.c >= k.o;
        const col = up ? UP : DN;
        const bw = Math.max(2, cw * 0.62);
        return (
          <g key={k.d}>
            <line x1={cx} x2={cx} y1={y(k.h)} y2={y(k.l)} stroke={col} strokeWidth={1} />
            <rect x={cx - bw / 2} y={y(Math.max(k.o, k.c))} width={bw} height={Math.max(1, Math.abs(y(k.o) - y(k.c)))} fill={col} opacity={up ? 0.9 : 1} />
          </g>
        );
      })}
      {/* 现价线 */}
      <line x1={0} x2={plotW} y1={y(price)} y2={y(price)} stroke={ACC} strokeWidth={0.8} strokeDasharray="4 3" opacity={0.7} />
      <text x={4} y={y(price) - 4} fontSize={9.5} fill={ACC} fontFamily="ui-monospace,monospace">{fmt(price)}</text>

      {/* AI 情景路径 */}
      {(ai || []).map((s) => (
        <g key={s.name}>
          <polyline points={pathLine(s.path)} fill="none" stroke={scColor(s.name)} strokeWidth={1.6} strokeDasharray="5 3" opacity={0.95} />
          <text x={fx(fwd - 1) + 3} y={y(toPrice(s.path[fwd - 1])) + 3.5} fontSize={10} fill={scColor(s.name)} fontFamily="ui-monospace,monospace">
            {fmt(toPrice(s.path[fwd - 1]))} {(s.prob * 100).toFixed(0)}%
          </text>
        </g>
      ))}

      {/* x 轴日期 */}
      {candles.filter((_, i) => i % 12 === 0).map((k) => (
        <text key={k.d} x={candles.indexOf(k) * cw + cw / 2} y={H - 8} fontSize={9.5} fill="#5a6372" textAnchor="middle" fontFamily="ui-monospace,monospace">{k.d.slice(5)}</text>
      ))}
    </svg>
  );
}

/* ---------- 页面 ---------- */
export default function KlineClient() {
  const [token, setToken] = useState("");
  const [input, setInput] = useState("");
  const [gate, setGate] = useState(true);
  const [q, setQ] = useState("");
  const [market, setMarket] = useState<"us" | "a" | "hk">("a");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [ai, setAi] = useState<{ read: string; scenarios: Scenario[] } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const abortRef = useRef(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("sg_stats_token") || "";
      if (saved) { setToken(saved); setGate(false); }
    } catch { /* noop */ }
  }, []);

  const load = useCallback(async (sym: string, mkt: string, tok: string) => {
    const id = ++abortRef.current;
    setBusy(true); setErr(""); setData(null); setAi(null); setAiErr("");
    try {
      const r = await fetch(`/api/kforecast?sym=${encodeURIComponent(sym)}&market=${mkt}`, { headers: { authorization: `Bearer ${tok}` }, cache: "no-store" });
      if (r.status === 401) { try { localStorage.removeItem("sg_stats_token"); } catch { /* noop */ } setGate(true); setBusy(false); return; }
      const j = await r.json();
      if (abortRef.current !== id) return;
      if (!r.ok || j.error) { setErr(String(j.error || `失败 ${r.status}`)); setBusy(false); return; }
      setData(j);
    } catch { if (abortRef.current === id) setErr("网络错误"); }
    setBusy(false);
  }, []);

  const go = useCallback(async () => {
    const s = q.trim().toUpperCase();
    if (!s) return;
    let mkt: string = market, sym = s;
    try { // 站内搜索精确命中则自动纠正市场
      const r = await fetch(`/api/search?q=${encodeURIComponent(s)}&limit=1`);
      const hit = (await r.json())?.results?.[0] as { code?: string; market?: string } | undefined;
      if (hit && String(hit.code).toUpperCase() === s && ["a", "hk", "us"].includes(String(hit.market))) {
        mkt = String(hit.market); setMarket(mkt as "a" | "hk" | "us");
      }
    } catch { /* 检索挂了不拦路 */ }
    load(sym, mkt, token);
  }, [q, market, token, load]);

  const runAi = useCallback(async () => {
    if (!data) return;
    setAiBusy(true); setAiErr("");
    try {
      const r = await fetch("/api/kforecast/ai", {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ sym: data.sym, name: data.name, market: data.market, tech: data.tech, backtest: data.backtest, recent: data.candles.slice(-10) }),
      });
      const j = await r.json();
      if (!r.ok || j.error) { setAiErr(String(j.error || (j.aiDisabled ? "AI 未接入" : `失败 ${r.status}`))); setAiBusy(false); return; }
      setAi(j.ai);
    } catch { setAiErr("网络错误"); }
    setAiBusy(false);
  }, [data, token]);

  if (gate) {
    return (
      <div className="mx-auto max-w-xs py-14">
        <p className={`mb-3 text-[12px] ${MUT}`}>私密工具 · 输入访问口令(与 /stats 同一个)</p>
        <form onSubmit={(e) => { e.preventDefault(); const t = input.trim(); if (!t) return; try { localStorage.setItem("sg_stats_token", t); } catch { /* noop */ } setToken(t); setGate(false); }} className="space-y-2.5">
          <input type="password" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Token" autoFocus className={`w-full ${INPUT} py-2`} />
          <button type="submit" className={`w-full ${BTN_ACC} py-2 text-[12px]`}>进入</button>
        </form>
      </div>
    );
  }

  const t = data?.tech;
  const bt = data?.backtest;
  const lastIdx = bt ? bt.fwd - 1 : 0;

  return (
    <div className="space-y-3 font-[system-ui]">
      {/* 搜索条 */}
      <div className={`${PANEL} flex flex-wrap items-center gap-2 rounded-md px-3 py-2.5`}>
        <select value={market} onChange={(e) => setMarket(e.target.value as "a" | "hk" | "us")} className={INPUT}>
          <option value="a">A股</option><option value="us">美股</option><option value="hk">港股</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder="代码:600519 / NVDA / 00700" className={`w-[200px] ${INPUT} font-mono`} />
        <button onClick={go} disabled={busy} className={BTN_ACC}>{busy ? "回测中…" : "推演"}</button>
        {data && (
          <span className={`ml-1 text-[12px] ${INK}`}>
            {data.name} <span className="font-mono text-[#7eb3ff]">{data.sym}</span>
            <span className={`ml-2 font-mono ${MUT}`}>{fmt(data.tech.price)}</span>
            <span className={`ml-2 font-mono text-[11px] ${FAINT}`}>{data.total} 根日线</span>
          </span>
        )}
        {data && !ai && (
          <button onClick={runAi} disabled={aiBusy} className={`ml-auto ${BTN_ACC}`}>{aiBusy ? "AI 推演中…(~30s)" : "生成 AI 情景"}</button>
        )}
        {err && <span className={`text-[11.5px]`} style={{ color: DN }}>{err}</span>}
        {aiErr && <span className={`text-[11.5px]`} style={{ color: DN }}>{aiErr}</span>}
      </div>

      {/* 主图 */}
      {data && bt && (
        <div className={`${PANEL} rounded-md p-2`}>
          <Chart data={data} ai={ai?.scenarios || null} />
        </div>
      )}

      {/* 三栏:技术快照 / 回测统计 / AI 解读 */}
      {data && t && bt && (
        <div className="grid gap-3 lg:grid-cols-3">
          <div className={`${PANEL} rounded-md p-3`}>
            <p className={`mb-2 text-[10px] uppercase tracking-[0.15em] ${FAINT}`}>技术快照</p>
            <div className={`grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[11.5px] tabular-nums ${MUT}`}>
              <span>5日 <b style={{ color: t.chg5 >= 0 ? UP : DN }}>{sign(t.chg5)}%</b></span>
              <span>20日 <b style={{ color: t.chg20 >= 0 ? UP : DN }}>{sign(t.chg20)}%</b></span>
              <span>60日 <b style={{ color: t.chg60 >= 0 ? UP : DN }}>{sign(t.chg60)}%</b></span>
              <span>量比 <b className={INK}>{fmt(t.volR5)}</b></span>
              <span>MA5 {fmt(t.ma5)}</span><span>MA20 {fmt(t.ma20)}</span>
              <span>MA60 {fmt(t.ma60)}</span><span>RSI14 <b className={INK}>{fmt(t.rsi14, 0)}</b></span>
              <span className="col-span-2">BOLL {fmt(t.bollLow)} ~ {fmt(t.bollMid)} ~ {fmt(t.bollUp)}</span>
              <span className="col-span-2">MACD dif {fmt(t.macd.dif)} dea {fmt(t.macd.dea)} 柱 <b style={{ color: t.macd.hist >= 0 ? UP : DN }}>{fmt(t.macd.hist)}</b></span>
              <span className="col-span-2">52周 {fmt(t.lo52)} ~ {fmt(t.hi52)} · 现价 <b className={INK}>{t.posIn52}%</b> 分位</span>
            </div>
          </div>
          <div className={`${PANEL} rounded-md p-3`}>
            <p className={`mb-2 text-[10px] uppercase tracking-[0.15em] ${FAINT}`}>相似形态回测(近{bt.win}日形态 · 全历史 {bt.samples} 窗口 · 取前 {bt.topK})</p>
            <div className={`space-y-1.5 font-mono text-[11.5px] tabular-nums ${MUT}`}>
              <p>第{bt.fwd}日上涨占比 <b style={{ color: bt.horizon.upProb >= 0.5 ? UP : DN }}>{(bt.horizon.upProb * 100).toFixed(0)}%</b> · 中位 <b style={{ color: bt.horizon.median >= 0 ? UP : DN }}>{sign(bt.horizon.median)}%</b> · 均值 {sign(bt.horizon.mean)}%</p>
              <p>分位:p10 {sign(bt.fan.p10[lastIdx])}% · p25 {sign(bt.fan.p25[lastIdx])}% · p75 {sign(bt.fan.p75[lastIdx])}% · p90 {sign(bt.fan.p90[lastIdx])}%</p>
              <p>极端:最好 <span style={{ color: UP }}>{sign(bt.horizon.best)}%</span> · 最差 <span style={{ color: DN }}>{sign(bt.horizon.worst)}%</span></p>
              <p className={`pt-1 text-[10.5px] ${FAINT}`}>头部相似段:{bt.matches.slice(0, 4).map((m) => `${m.endDate}(${(m.sim * 100).toFixed(0)}%→${sign(m.fwd[lastIdx])}%)`).join(" · ")}</p>
            </div>
          </div>
          <div className={`${PANEL} rounded-md p-3`}>
            <p className={`mb-2 text-[10px] uppercase tracking-[0.15em] ${FAINT}`}>AI 盘面解读</p>
            {ai ? (
              <p className={`text-[12px] leading-relaxed ${MUT}`}>{ai.read}</p>
            ) : (
              <p className={`text-[12px] ${FAINT}`}>{aiBusy ? "AI 正在结合技术面与回测分布推演…" : "点右上「生成 AI 情景」,叠加三条情景路径。"}</p>
            )}
          </div>
        </div>
      )}

      {/* 情景卡 */}
      {ai && (
        <div className="grid gap-3 lg:grid-cols-3">
          {ai.scenarios.map((s) => {
            const col = s.name.includes("乐") ? UP : s.name.includes("悲") ? DN : BASE;
            const end = s.path[s.path.length - 1];
            return (
              <div key={s.name} className={`${PANEL} rounded-md p-3`}>
                <p className="flex items-baseline justify-between">
                  <span className="text-[12.5px] font-semibold" style={{ color: col }}>{s.name}</span>
                  <span className={`font-mono text-[11.5px] tabular-nums ${MUT}`}>P={(s.prob * 100).toFixed(0)}% · {bt?.fwd}日 <b style={{ color: end >= 0 ? UP : DN }}>{sign(end)}%</b></span>
                </p>
                <p className={`mt-1.5 text-[11.5px] leading-relaxed ${MUT}`}>{s.why}</p>
              </div>
            );
          })}
        </div>
      )}

      <p className={`px-1 text-[10.5px] leading-relaxed ${FAINT}`}>
        情景推演基于历史相似形态统计与技术面,是概率参考不是预测;历史相似不代表未来重演,样本有限时尤其失真。不构成任何投资建议。
      </p>
    </div>
  );
}
