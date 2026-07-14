"use client";

// 宏观驾驶舱(私密工具,口令同 /stats):十个指标按传导地图四层——
//   ① 经济数据 → ② 利率·流动性 总闸门 → ③ 传导·警报 → ④ 实体周期温度计。
// 每格:现值 + 20d 变化 + 迷你趋势线 + 红黄绿状态灯。硬数据 FRED,④ 三个是行情代理(已标注)。
import { useCallback, useEffect, useState } from "react";

type Ind = {
  num: number; tier: 1 | 2 | 3 | 4; label: string; sub: string;
  value: string; chg: string; dir: "up" | "dn" | "flat";
  status: "g" | "a" | "r"; spark: number[]; lead: boolean; proxy: boolean; note: string; lag: string;
};
type Resp = { asOf: string; indicators: Ind[]; summary: { r: number; a: number; g: number; reds: string[] }; cached?: boolean };

const INK = "text-[#d6dbe4]", MUT = "text-[#8a93a3]", FAINT = "text-[#5a6372]";
const SC = { g: "#22c55e", a: "#f5a524", r: "#f4525f" } as const;
const INPUT = "rounded border border-[#2c323e] bg-[#0e1014] px-2 py-1.5 text-[12px] text-[#d6dbe4] outline-none focus:border-[#fb923c66]";
const BTN = "rounded border border-[#2c323e] bg-[#1a1e26] px-2.5 py-1 text-[11px] text-[#8a93a3] transition hover:text-[#d6dbe4] hover:border-[#3a4150] disabled:opacity-40";

const TIERS: { t: 1 | 2 | 3 | 4; name: string; dot: string }[] = [
  { t: 1, name: "经济数据 · 决定美联储往哪走", dot: "#8a93a3" },
  { t: 2, name: "利率与流动性 · 总闸门(估值重力 + 潮水)", dot: "#2dd4bf" },
  { t: 3, name: "传导与警报器", dot: "#fb923c" },
  { t: 4, name: "实体周期温度计 · 领先看到需求的地方", dot: "#a78bfa" },
];

function Spark({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return <div className="h-[30px] w-[112px]" />;
  const w = 112, h = 30, p = 3;
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const x = (i: number) => p + (i / (data.length - 1)) * (w - 2 * p);
  const y = (v: number) => p + (1 - (v - mn) / rng) * (h - 2 * p);
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const li = data.length - 1;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
      <circle cx={x(li)} cy={y(data[li])} r={1.9} fill={color} />
    </svg>
  );
}

function Card({ i }: { i: Ind }) {
  const sc = SC[i.status];
  const cc = i.dir === "up" ? "#22c55e" : i.dir === "dn" ? "#f4525f" : "#8a93a3";
  return (
    <div className="flex flex-col gap-1 rounded-md border border-[#262b35] bg-[#15181e] p-2.5">
      <div className="flex items-center justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`shrink-0 font-mono text-[10px] ${FAINT}`}>{i.num}</span>
          <span className={`truncate text-[12px] font-medium ${INK}`}>{i.label}</span>
          {i.lead && <span className="shrink-0 rounded bg-[#22c55e1a] px-1 py-px text-[8.5px] text-[#22c55e]">领先</span>}
          {i.proxy && <span className="shrink-0 rounded bg-[#8a93a31f] px-1 py-px text-[8.5px] text-[#8a93a3]">代理</span>}
        </div>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: sc, boxShadow: `0 0 6px ${sc}80` }} />
      </div>
      <div className={`-mt-0.5 truncate text-[10px] ${FAINT}`}>{i.sub}</div>
      <div className="mt-0.5 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className={`font-mono text-[19px] leading-none tabular-nums ${INK}`}>{i.value}</div>
          <div className="mt-1 font-mono text-[10.5px] tabular-nums" style={{ color: cc }}>{i.chg}</div>
        </div>
        <Spark data={i.spark} color={sc} />
      </div>
      <div className="mt-0.5 text-[9.5px] leading-snug text-[#6b7280]">{i.note}</div>
    </div>
  );
}

export default function MacroClient() {
  const [token, setToken] = useState("");
  const [input, setInput] = useState("");
  const [gate, setGate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState<Resp | null>(null);

  const load = useCallback(async (tok: string) => {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/cockpit", { headers: { authorization: `Bearer ${tok}` }, cache: "no-store" });
      if (r.status === 401) { try { localStorage.removeItem("sg_stats_token"); } catch { /* noop */ } setGate(true); setBusy(false); return; }
      const j = (await r.json()) as Resp & { error?: string };
      if (j.error) { setErr(j.error); setBusy(false); return; }
      setData(j);
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("sg_stats_token") || "";
      if (saved) { setToken(saved); setGate(false); load(saved); }
    } catch { /* noop */ }
  }, [load]);

  if (gate) {
    return (
      <div className="mx-auto max-w-sm py-10">
        <h1 className={`mb-1 text-[13px] font-semibold uppercase tracking-[0.3em] ${INK}`}>宏观驾驶舱</h1>
        <p className={`mb-3 text-[12px] ${MUT}`}>私密工具 · 输入访问口令(与 /stats 同一个)</p>
        <form
          onSubmit={(e) => { e.preventDefault(); const t = input.trim(); if (!t) return; try { localStorage.setItem("sg_stats_token", t); } catch { /* noop */ } setToken(t); setGate(false); load(t); }}
          className="space-y-2.5"
        >
          <input type="password" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Token" autoFocus className={`w-full ${INPUT} py-2`} />
          <button type="submit" className="w-full rounded bg-[#fb923c] px-2.5 py-2 text-[12px] font-semibold text-[#1a0f08] transition hover:brightness-110">进入</button>
        </form>
      </div>
    );
  }

  const s = data?.summary;
  const driver = !s ? "" : s.r > 0 ? `亮红灯:${s.reds.join("、")} — 这几个在主导` : s.g >= 6 ? "总闸门偏友好,暂无警报" : "多数中性 · 盯有没有指标转红";

  return (
    <div>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#262b35] pb-2.5">
        <div className="flex items-baseline gap-2.5">
          <h1 className={`text-[13px] font-semibold uppercase tracking-[0.3em] ${INK}`}>宏观驾驶舱</h1>
          <span className={`font-mono text-[10px] tabular-nums ${FAINT}`}>{data?.asOf}{data?.cached ? " · cached" : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          {s && (
            <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
              <span style={{ color: SC.r }}>●{s.r}</span>
              <span style={{ color: SC.a }}>●{s.a}</span>
              <span style={{ color: SC.g }}>●{s.g}</span>
            </div>
          )}
          <button className={BTN} onClick={() => load(token)} disabled={busy}>{busy ? "…" : "刷新"}</button>
        </div>
      </header>

      {driver && (
        <div className="mb-3 rounded-md border border-[#262b35] bg-[#15181e] px-3 py-2 text-[11.5px] leading-relaxed">
          <span className={FAINT}>驾驶座 · </span>
          <span className={INK}>{driver}</span>
        </div>
      )}

      {err && <div className="mb-3 rounded border border-[#f4525f44] bg-[#f4525f11] px-3 py-2 text-[11px] text-[#f4525f]">拉取失败:{err}</div>}
      {!data && !err && <div className={`py-10 text-center text-[12px] ${MUT}`}>加载中…</div>}

      {data && TIERS.map(({ t, name, dot }) => {
        const cards = data.indicators.filter((i) => i.tier === t);
        if (!cards.length) return null;
        return (
          <section key={t} className="mb-3">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: dot }} />
              <span className={`text-[11px] font-medium ${MUT}`}>{name}</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((i) => <Card key={i.num} i={i} />)}
            </div>
          </section>
        );
      })}

      <footer className={`mt-4 space-y-1 border-t border-[#262b35] pt-2.5 text-[10px] leading-relaxed ${FAINT}`}>
        <p>读法:自上而下的因果级联 · 带「领先」的优先盯 · 当下通常只有 1–2 个在驾驶座。红=收紧/警报,黄=中性,绿=友好/健康。</p>
        <p>①②③ 八个是 FRED 硬数据(免key);④ 三个是行情代理——真数据:存储价走 TrendForce、中国信用脉冲/地产走 iFinD、AI capex 读四大云厂财报季。不构成投资建议。</p>
      </footer>
    </div>
  );
}
