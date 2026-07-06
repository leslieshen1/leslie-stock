"use client";

// 私人持仓终端(Finviz 式深色高密度,固定配色不随站点主题):
// 录买卖 → 实时收益 → AI 日报(打开自动补当天)→ 平仓自动复盘。
// 口令与 /stats 共用(localStorage sg_stats_token / STATS_TOKEN);数据在 Upstash;现价 QUOTE_URL 30s 轮询。
import { useCallback, useEffect, useRef, useState } from "react";
import { QUOTE_URL } from "@/lib/quote-api";
import { yahooSym } from "@/lib/quote-sym";
import { CCY, type ClosedLot, type Dir, type Market, type Position, type Side, type Trade } from "@/lib/portfolio";

type Quote = { price: number; pct: number | null };
type Daily = { date: string; md: string; genAt: number };
type Review = { lotId: string; market: Market; sym: string; name: string; openDate: string; closeDate: string; holdDays: number; realized: number; retPct: number; buyAmt: number; dir?: Dir; lev?: number; md: string };
type Data = {
  connected: boolean;
  trades: Trade[]; positions: Position[]; lots: ClosedLot[];
  daily: Daily[]; reviews: Review[]; nav: { date: string; slices: Record<string, { mv: number; cost: number }> }[];
  aiReady: boolean;
};

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number, d = 2) => `${n >= 0 ? "+" : ""}${fmt(n, d)}`;
const bjToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const qKey = (m: Market, s: string) => `${m}|${s}`;
const toQuoteSym = (m: Market, s: string) => (m === "us" || m === "perp" ? s : yahooSym(s, m)); // 合约标的锚美股价
const MKT_NAME: Record<Market, string> = { us: "美股", a: "A股", hk: "港股", perp: "合约" };
// 各市场本金口径(Leslie 口述:A股账户本金 10 万)。盈利点 =(已实现+持仓浮动)/ 本金,组头常驻实时显示
const CAPITAL: Partial<Record<Market, number>> = { a: 100_000 };
const isShort = (p: { market: Market; dir?: Dir }) => p.market === "perp" && p.dir === "SHORT";
const DirBadge = ({ dir, lev }: { dir?: Dir; lev?: number }) =>
  dir ? (
    <span className={`ml-1.5 rounded-sm px-1 py-px text-[9px] font-semibold ${dir === "SHORT" ? "bg-[#f4525f22] text-[#f4525f]" : "bg-[#22c55e22] text-[#22c55e]"}`}>
      {dir === "SHORT" ? "空" : "多"}{lev ? `${lev}x` : ""}
    </span>
  ) : null;

// —— 终端调色板(独立于站点主题;深邃灰阶 + 克制红绿 + 少量橙) ——
const INK = "text-[#d6dbe4]", MUT = "text-[#8a93a3]", FAINT = "text-[#5a6372]";
const UP = "text-[#22c55e]", DN = "text-[#f4525f]";
const PANEL = "border border-[#262b35] bg-[#15181e]";
const INPUT = "rounded border border-[#2c323e] bg-[#0e1014] px-2 py-1.5 text-[12px] text-[#d6dbe4] outline-none focus:border-[#fb923c66]";
const BTN = "rounded border border-[#2c323e] bg-[#1a1e26] px-2.5 py-1 text-[11px] text-[#8a93a3] transition hover:text-[#d6dbe4] hover:border-[#3a4150] disabled:opacity-40";
const BTN_ACC = "rounded bg-[#fb923c] px-2.5 py-1 text-[11px] font-semibold text-[#1a0f08] transition hover:brightness-110 disabled:opacity-40";
const pn = (n: number) => (n >= 0 ? UP : DN);

// —— 持仓热力图(Finviz 式 squarified treemap,零依赖):面积=市值(折¥),颜色=当日涨跌 ——
type Cell = { sym: string; name: string; market: Market; v: number; pct: number | null; pnl: number | null };
type Rect = { x: number; y: number; w: number; h: number; c: Cell };

function squarify(cells: Cell[], x: number, y: number, w: number, h: number): Rect[] {
  // 经典 squarify:值降序,逐行铺,行内保持最优长宽比。坐标系 0-100,渲染用百分比 → 天然响应式。
  const items = cells.filter((c) => c.v > 0).sort((a, b) => b.v - a.v);
  const total = items.reduce((a, c) => a + c.v, 0);
  if (!total) return [];
  const scale = (w * h) / total;
  const out: Rect[] = [];
  let row: Cell[] = [], rx = x, ry = y, rw = w, rh = h;
  const worst = (r: Cell[], side: number) => {
    const s = r.reduce((a, c) => a + c.v * scale, 0);
    let m = 0;
    for (const c of r) {
      const a = c.v * scale;
      const ratio = Math.max((side * side * a) / (s * s), (s * s) / (side * side * a));
      m = Math.max(m, ratio);
    }
    return m;
  };
  const layoutRow = (r: Cell[]) => {
    const s = r.reduce((a, c) => a + c.v * scale, 0);
    const horiz = rw >= rh; // 行贴短边
    const side = horiz ? rh : rw;
    const thick = s / side;
    let off = 0;
    for (const c of r) {
      const len = (c.v * scale) / thick;
      out.push(horiz ? { x: rx, y: ry + off, w: thick, h: len, c } : { x: rx + off, y: ry, w: len, h: thick, c });
      off += len;
    }
    if (horiz) { rx += thick; rw -= thick; } else { ry += thick; rh -= thick; }
  };
  for (const c of items) {
    const side = Math.min(rw, rh);
    if (row.length && worst([...row, c], side) > worst(row, side)) { layoutRow(row); row = [c]; }
    else row.push(c);
  }
  if (row.length) layoutRow(row);
  return out;
}

function heatColor(pct: number | null): string {
  if (pct == null) return "#3a3f4a";
  const t = Math.max(-3, Math.min(3, pct)) / 3; // ±3% 封顶,Finviz 同款
  const mix = (a: number[], b: number[], k: number) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const base = [65, 69, 84]; // #414554 中性
  const rgb = t >= 0 ? mix(base, [38, 166, 91], t) : mix(base, [216, 58, 70], -t);
  return `rgb(${rgb.join(",")})`;
}

function Treemap({ cells }: { cells: Cell[] }) {
  const rects = squarify(cells, 0, 0, 100, 100);
  return (
    <div className="relative h-[300px] w-full overflow-hidden rounded-[3px]">
      {rects.map(({ x, y, w, h, c }) => {
        const area = (w * h) / 100; // 面积占比 %
        const big = area > 5, mid = area > 1.8;
        return (
          <a key={c.sym} href={`/stock/${c.sym}?market=${c.market}`}
            title={`${c.sym} ${c.name} · 市值占比 ${fmt(area, 1)}%${c.pct != null ? ` · 今日 ${sign(c.pct)}%` : ""}${c.pnl != null ? ` · 浮盈 ${sign(c.pnl)}%` : ""}`}
            className="absolute flex flex-col items-center justify-center overflow-hidden outline outline-1 outline-[#101216] transition hover:brightness-125"
            style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`, background: heatColor(c.pct) }}>
            {mid && <span className={`font-mono font-bold leading-tight text-white/90 ${big ? "text-[15px]" : "text-[10px]"}`}>{c.sym}</span>}
            {big && c.pct != null && <span className="font-mono text-[11px] leading-tight text-white/75">{sign(c.pct)}%</span>}
          </a>
        );
      })}
    </div>
  );
}

function Md({ md }: { md: string }) {
  const bold = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((seg, i) =>
      seg.startsWith("**") ? <strong key={i} className={`font-semibold ${INK}`}>{seg.slice(2, -2)}</strong> : seg);
  return (
    <div className={`space-y-1.5 text-[12px] leading-relaxed ${MUT}`}>
      {md.split(/\n+/).map((ln, i) =>
        ln.startsWith("###") ? (
          <h4 key={i} className={`pt-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#fb923c]`}>{ln.replace(/^#+\s*/, "")}</h4>
        ) : (
          <p key={i} className="whitespace-pre-wrap">{bold(ln)}</p>
        ))}
    </div>
  );
}

export default function HoldingsClient() {
  const [token, setToken] = useState("");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"gate" | "bad" | "loading" | "ok" | "error" | "no-store">("gate");
  const [data, setData] = useState<Data | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [fx, setFx] = useState<{ USD?: number; HKD?: number }>({});
  const [genState, setGenState] = useState<string>("");
  const [genErr, setGenErr] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const navDone = useRef(false);
  const autoDaily = useRef(false);

  const authHdr = useCallback((tok: string) => ({ authorization: `Bearer ${tok}` }), []);

  const load = useCallback(async (tok: string) => {
    setStatus((s) => (s === "ok" ? s : "loading"));
    try {
      const r = await fetch("/api/portfolio", { headers: authHdr(tok), cache: "no-store" });
      if (r.status === 401) { try { localStorage.removeItem("sg_stats_token"); } catch {} setStatus("bad"); return; }
      if (!r.ok) { setStatus("error"); return; }
      const j = (await r.json()) as Data;
      if (!j.connected) { setStatus("no-store"); return; }
      setData(j); setStatus("ok");
    } catch { setStatus("error"); }
  }, [authHdr]);

  useEffect(() => {
    let saved = "";
    try { saved = localStorage.getItem("sg_stats_token") || ""; } catch {}
    if (saved) { setToken(saved); load(saved); } else setStatus("gate");
  }, [load]);

  // —— 行情轮询(30s)+ 捎带汇率(USDCNY=X / HKDCNY=X,总计折 ¥ 用) ——
  useEffect(() => {
    const pos = data?.positions || [];
    if (!pos.length) return;
    let stop = false;
    const back = new Map(pos.map((p) => [toQuoteSym(p.market, p.sym).toUpperCase(), qKey(p.market, p.sym)]));
    const wantFx: string[] = [];
    if (pos.some((p) => p.market === "us")) wantFx.push("USDCNY=X");
    if (pos.some((p) => p.market === "hk")) wantFx.push("HKDCNY=X");
    const syms = [...back.keys(), ...wantFx];
    const tick = async () => {
      try {
        const r = await fetch(`${QUOTE_URL}?syms=${encodeURIComponent(syms.join(","))}`, { cache: "no-store" });
        const j = (await r.json()) as { quotes?: Record<string, Quote> };
        if (stop || !j.quotes) return;
        const next: Record<string, Quote> = {};
        const nf: { USD?: number; HKD?: number } = {};
        for (const [k, v] of Object.entries(j.quotes)) {
          const K = k.toUpperCase();
          if (K === "USDCNY=X" && v && typeof v.price === "number") { nf.USD = v.price; continue; }
          if (K === "HKDCNY=X" && v && typeof v.price === "number") { nf.HKD = v.price; continue; }
          const bk = back.get(K);
          if (bk && v && typeof v.price === "number") next[bk] = v;
        }
        setQuotes((old) => ({ ...old, ...next }));
        if (nf.USD || nf.HKD) setFx((old) => ({ ...old, ...nf }));
      } catch { /* 行情失败静默,下轮再试 */ }
    };
    tick();
    const iv = setInterval(tick, 30_000);
    return () => { stop = true; clearInterval(iv); };
  }, [data?.positions]);

  // —— 拿到行情后:①当天 NAV 打点(一次) ②今天没日报 → 自动生成 ——
  useEffect(() => {
    if (!data || status !== "ok") return;
    const pos = data.positions;
    if (!pos.length) return;
    const covered = pos.filter((p) => quotes[qKey(p.market, p.sym)]).length;
    if (covered < Math.min(pos.length, Math.ceil(pos.length * 0.7))) return;
    const today = bjToday();
    if (!navDone.current && !data.nav.some((n) => n.date === today)) {
      navDone.current = true;
      const slices: Record<string, { mv: number; cost: number }> = {};
      for (const p of pos) {
        const q = quotes[qKey(p.market, p.sym)];
        const mv = q ? q.price * p.qty : p.invested;
        const s = (slices[p.market] ||= { mv: 0, cost: 0 });
        s.mv += mv; s.cost += p.invested;
      }
      fetch("/api/portfolio", { method: "POST", headers: { ...authHdr(token), "content-type": "application/json" }, body: JSON.stringify({ action: "nav", date: today, slices }) }).catch(() => {});
    }
    if (!autoDaily.current && data.aiReady && !data.daily.some((d) => d.date === today)) {
      autoDaily.current = true;
      generate("daily");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes, data, status]);

  const quotesPayload = useCallback(() => {
    const out: Record<string, { price: number; pct: number | null }> = {};
    for (const [k, v] of Object.entries(quotes)) out[k] = { price: v.price, pct: v.pct };
    return out;
  }, [quotes]);

  const generate = useCallback(async (kind: "daily" | "review", lotId?: string) => {
    setGenState(kind === "daily" ? "daily" : lotId || "");
    setGenErr("");
    try {
      const r = await fetch("/api/portfolio/generate", {
        method: "POST",
        headers: { ...authHdr(token || localStorage.getItem("sg_stats_token") || ""), "content-type": "application/json" },
        body: JSON.stringify({ kind, lotId, quotes: quotesPayload() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setGenErr(String(j.error || (j.aiDisabled ? "AI 未接入:Vercel env 加 NDT_CLAUDE_KEY(或 NDT_API_KEY)后 redeploy" : `失败 ${r.status}`)));
      await load(token || localStorage.getItem("sg_stats_token") || "");
    } catch { setGenErr("网络错误,稍后重试"); }
    setGenState("");
  }, [authHdr, token, quotesPayload, load]);

  // —— 录入 ——
  const [f, setF] = useState({ market: "us" as Market, sym: "", name: "", side: "BUY" as Side, dir: "LONG" as Dir, lev: "", price: "", qty: "", date: bjToday(), reason: "" });
  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr] = useState("");
  const submitTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr(""); setSubmitting(true);
    try {
      const r = await fetch("/api/portfolio", {
        method: "POST", headers: { ...authHdr(token), "content-type": "application/json" },
        body: JSON.stringify({ action: "trade", trade: { market: f.market, sym: f.sym.trim(), name: f.name.trim(), side: f.side, price: Number(f.price), qty: Number(f.qty), date: f.date, reason: f.reason.trim(), dir: f.market === "perp" ? f.dir : undefined, lev: f.market === "perp" && f.lev ? Number(f.lev) : undefined } }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setFormErr(String(j.error || `失败 ${r.status}`)); setSubmitting(false); return; }
      setF({ ...f, sym: "", name: "", price: "", qty: "", reason: "" });
      setShowForm(false);
      await load(token);
      if (j.closedLot?.lotId) generate("review", j.closedLot.lotId);
    } catch { setFormErr("网络错误"); }
    setSubmitting(false);
  };

  const delTrade = async (id: string) => {
    if (!confirm("删除这笔记录?(仅用于录错撤销,会重算持仓)")) return;
    await fetch("/api/portfolio", { method: "POST", headers: { ...authHdr(token), "content-type": "application/json" }, body: JSON.stringify({ action: "deleteTrade", id }) });
    load(token);
  };

  // —— 批量导入(串行:后端读改写非原子,并发会丢笔) ——
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [importing, setImporting] = useState(false);
  const runImport = async () => {
    setImportMsg(""); setImporting(true);
    try {
      const arr = JSON.parse(importText) as Partial<Trade>[];
      if (!Array.isArray(arr) || !arr.length) { setImportMsg("要一个 JSON 数组"); setImporting(false); return; }
      let ok = 0; const fails: string[] = [];
      for (const x of arr) {
        const trade = { market: (x.market || "us") as Market, sym: x.sym, name: x.name || "", side: (x.side || "BUY") as Side, price: x.price, qty: x.qty, date: x.date || bjToday(), reason: x.reason || "", dir: x.dir, lev: x.lev };
        try {
          const r = await fetch("/api/portfolio", { method: "POST", headers: { ...authHdr(token), "content-type": "application/json" }, body: JSON.stringify({ action: "trade", trade }) });
          if (r.ok) ok++; else { const j = await r.json().catch(() => ({})); fails.push(`${x.sym}: ${j.error || r.status}`); }
        } catch { fails.push(`${x.sym}: 网络错误`); }
      }
      setImportMsg(`成功 ${ok}/${arr.length}` + (fails.length ? ` · ${fails.join(" / ")}` : ""));
      if (ok > 0) { setImportText(""); await load(token); }
    } catch { setImportMsg("JSON 解析失败,检查格式"); }
    setImporting(false);
  };

  // ---------- 门与状态 ----------
  if (status === "gate" || status === "bad") {
    return (
      <div className="mx-auto max-w-xs py-14">
        <p className={`mb-3 text-[12px] ${MUT}`}>私密数据 · 输入访问口令(与 /stats 同一个)</p>
        <form onSubmit={(e) => { e.preventDefault(); const tok = input.trim(); if (!tok) return; try { localStorage.setItem("sg_stats_token", tok); } catch {} setToken(tok); load(tok); }} className="space-y-2.5">
          <input type="password" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Token" autoFocus className={`w-full ${INPUT} py-2`} />
          {status === "bad" && <p className={`text-[11px] ${DN}`}>口令不对。</p>}
          <button type="submit" className={`w-full ${BTN_ACC} py-2 text-[12px]`}>进入</button>
        </form>
      </div>
    );
  }
  if (status === "loading") return <p className={`py-16 text-center text-[12px] ${FAINT}`}>加载中…</p>;
  if (status === "no-store") return <p className={`py-16 text-center text-[12px] ${MUT}`}>还没接 Upstash 存储(Vercel → Storage)。</p>;
  if (status === "error" || !data) return <p className={`py-16 text-center text-[12px] ${DN}`}>读取失败。<button onClick={() => load(token)} className="ml-1 underline">重试</button></p>;

  const today = bjToday();
  const todayDaily = data.daily.find((d) => d.date === today) || data.daily[data.daily.length - 1] || null;
  const groups: Market[] = ["us", "a", "hk", "perp"];
  const openLotsPending = data.lots.filter((l) => !data.reviews.some((v) => v.lotId === l.lotId));

  // 分组统计:名义市值/成本/未实现/已实现/当日(空单方向化:价涨=亏)
  const groupStats = groups.map((m) => {
    const rows = data.positions.filter((p) => p.market === m);
    let mv = 0, cost = 0, day = 0, unreal = 0;
    for (const p of rows) {
      const q = quotes[qKey(p.market, p.sym)];
      const px = q?.price ?? null;
      const v = px ? px * p.qty : p.invested;
      const eff = isShort(p) ? -1 : 1;
      mv += v; cost += p.invested;
      unreal += px ? eff * (px - p.avgCost) * p.qty : 0;
      if (q && q.pct != null) day += (eff * (v * q.pct)) / (100 + q.pct);
    }
    const held = new Set(rows.map((p) => p.sym));
    const realized = rows.reduce((a, p) => a + p.realized, 0) +
      data.lots.filter((l) => l.market === m && !held.has(l.sym)).reduce((a, l) => a + l.realized, 0);
    return { m, rows, mv, cost, day, unreal, realized };
  }).filter((g) => g.rows.length > 0 || Math.abs(g.realized) > 1e-9);

  // 总计(折 ¥):A股=1,美/港/合约(USDT≈$)按 USD 汇率。
  // 总资产 = 现货市值 + 合约未实现(合约保证金在交易所,系统不知,名义市值不计入资产)。
  const toCny = (m: Market) => (m === "a" ? 1 : m === "hk" ? fx.HKD ?? null : fx.USD ?? null);
  const fxReady = groupStats.every((g) => toCny(g.m) != null);
  const tot = fxReady && groupStats.length > 0
    ? groupStats.reduce((acc, g) => {
        const r = toCny(g.m)!;
        acc.asset += (g.m === "perp" ? g.unreal : g.mv) * r;
        acc.cost += (g.m === "perp" ? 0 : g.cost) * r;
        acc.unreal += g.unreal * r; acc.day += g.day * r; acc.realized += g.realized * r;
        return acc;
      }, { asset: 0, cost: 0, unreal: 0, day: 0, realized: 0 })
    : null;
  const kpi = tot ? { ccy: "¥", ...tot } : null; // KPI 一律折算人民币

  // 热力图数据:面积=名义市值(折¥),颜色=当日对我的盈亏方向(空单反色:价跌=绿)
  const heatCells: Cell[] = fxReady
    ? data.positions.map((p) => {
        const q = quotes[qKey(p.market, p.sym)];
        const r = toCny(p.market) ?? 0;
        const eff = isShort(p) ? -1 : 1;
        return {
          sym: p.sym, name: p.name, market: p.market,
          v: (q ? q.price * p.qty : p.invested) * r,
          pct: q?.pct == null ? null : eff * q.pct,
          pnl: q?.price ? (eff * (q.price - p.avgCost) * 100) / p.avgCost : null,
        };
      })
    : [];

  const Kpi = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={`text-[10px] uppercase tracking-[0.14em] ${FAINT}`}>{label}</span>
      <span className="font-mono text-[15px] leading-none tabular-nums">{children}</span>
    </div>
  );

  return (
    <div className="space-y-4 font-[system-ui]">
      {/* ===== KPI 汇总条 ===== */}
      <div className={`${PANEL} flex flex-wrap items-end justify-between gap-x-6 gap-y-3 rounded-md px-4 py-3`}>
        {kpi ? (
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <Kpi label="总资产 · 折算¥"><span className={INK}>{kpi.ccy}{fmt(kpi.asset, 0)}</span></Kpi>
            <Kpi label="今日"><span className={pn(kpi.day)}>{kpi.ccy}{sign(kpi.day, 0)}{kpi.asset - kpi.day > 0 ? ` (${sign((kpi.day / (kpi.asset - kpi.day)) * 100)}%)` : ""}</span></Kpi>
            <Kpi label="浮动盈亏"><span className={pn(kpi.unreal)}>{kpi.ccy}{sign(kpi.unreal, 0)}{kpi.cost > 0 ? ` (${sign((kpi.unreal / kpi.cost) * 100)}%)` : ""}</span></Kpi>
            {Math.abs(kpi.realized) > 0.5 && <Kpi label="已实现"><span className={pn(kpi.realized)}>{kpi.ccy}{sign(kpi.realized, 0)}</span></Kpi>}
            {(fx.USD || fx.HKD) && (
              <Kpi label="FX">
                <span className={`text-[12px] ${MUT}`}>{fx.USD ? `$${fmt(fx.USD)}` : ""}{fx.USD && fx.HKD ? " / " : ""}{fx.HKD ? `HK$${fmt(fx.HKD)}` : ""}</span>
              </Kpi>
            )}
          </div>
        ) : (
          <span className={`text-[12px] ${FAINT}`}>{data.positions.length ? "汇率加载中…" : "空仓 · 点「记一笔」或「导入」开始"}</span>
        )}
        <div className="flex items-center gap-1.5">
          <button onClick={() => setShowForm((v) => !v)} className={BTN_ACC}>{showForm ? "收起" : "+ 记一笔"}</button>
          <button onClick={() => setShowImport((v) => !v)} className={BTN}>导入</button>
          <button onClick={() => load(token)} className={BTN}>刷新</button>
        </div>
      </div>

      {/* ===== 持仓热力图(Finviz treemap:面积=市值,颜色=当日) ===== */}
      {heatCells.length > 0 && (
        <div className={`${PANEL} rounded-md p-1`}>
          <Treemap cells={heatCells} />
        </div>
      )}

      {/* ===== 导入 / 录入面板 ===== */}
      {showImport && (
        <div className={`${PANEL} rounded-md p-3`}>
          <p className={`mb-2 text-[11px] ${FAINT}`}>粘 JSON 数组批量录入。sym/price/qty 必填;market 默认 us、side 默认 BUY、date 默认今天。合约:market:"perp" + dir:"LONG"/"SHORT"(+可选 lev 杠杆),BUY=开仓价、SELL=平仓价,空单盈亏自动反向。逐笔写入,别关页面。</p>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={5}
            placeholder='[{"sym":"BOTZ","qty":131.94,"price":37.13}]'
            className={`w-full ${INPUT} font-mono text-[11px]`} />
          <div className="mt-2 flex items-center gap-3">
            <button onClick={runImport} disabled={importing || !importText.trim()} className={BTN_ACC}>{importing ? "导入中…(逐笔)" : "开始导入"}</button>
            {importMsg && <span className={`text-[11px] ${MUT}`}>{importMsg}</span>}
          </div>
        </div>
      )}
      {showForm && (
        <form onSubmit={submitTrade} className={`${PANEL} grid grid-cols-2 gap-2.5 rounded-md p-3 sm:grid-cols-4`}>
          {([
            ["市场", <select key="m" value={f.market} onChange={(e) => setF({ ...f, market: e.target.value as Market })} className={`w-full ${INPUT}`}><option value="us">美股</option><option value="a">A股</option><option value="hk">港股</option><option value="perp">合约(永续)</option></select>],
            ["代码", <input key="s" value={f.sym} onChange={(e) => setF({ ...f, sym: e.target.value })} placeholder="NVDA / 600519" required className={`w-full ${INPUT} font-mono`} />],
            ["名称(可选)", <input key="n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={`w-full ${INPUT}`} />],
            [f.market === "perp" ? "开/平" : "方向", <select key="d" value={f.side} onChange={(e) => setF({ ...f, side: e.target.value as Side })} className={`w-full ${INPUT}`}><option value="BUY">{f.market === "perp" ? "开仓" : "买入"}</option><option value="SELL">{f.market === "perp" ? "平仓" : "卖出"}</option></select>],
            ...(f.market === "perp"
              ? ([
                  ["多/空", <select key="dir" value={f.dir} onChange={(e) => setF({ ...f, dir: e.target.value as Dir })} className={`w-full ${INPUT}`}><option value="LONG">做多</option><option value="SHORT">做空</option></select>],
                  ["杠杆(可选)", <input key="lev" type="number" step="1" min="1" max="200" value={f.lev} onChange={(e) => setF({ ...f, lev: e.target.value })} placeholder="如 5" className={`w-full ${INPUT} font-mono`} />],
                ] as [string, React.ReactNode][])
              : []),
            ["价格", <input key="p" type="number" step="any" min="0" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required className={`w-full ${INPUT} font-mono`} />],
            [f.market === "perp" ? "数量(张)" : "数量(股)", <input key="q" type="number" step="any" min="0" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required className={`w-full ${INPUT} font-mono`} />],
            ["成交日", <input key="t" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required className={`w-full ${INPUT} font-mono`} />],
          ] as [string, React.ReactNode][]).map(([lab, el]) => (
            <label key={lab} className={`text-[10px] uppercase tracking-wider ${FAINT}`}>{lab}<div className="mt-1">{el}</div></label>
          ))}
          <label className={`col-span-2 text-[10px] uppercase tracking-wider ${FAINT} sm:col-span-4`}>理由(复盘的原料,建议写)
            <textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} rows={2} placeholder="为什么买 / 为什么卖…" className={`mt-1 w-full ${INPUT}`} />
          </label>
          {formErr && <p className={`col-span-2 text-[11px] ${DN} sm:col-span-4`}>{formErr}</p>}
          <div className="col-span-2 sm:col-span-4"><button type="submit" disabled={submitting} className={BTN_ACC}>{submitting ? "提交中…" : "确认记录"}</button></div>
        </form>
      )}

      {/* ===== 分市场持仓表 ===== */}
      {data.positions.length === 0 ? (
        <p className={`${PANEL} rounded-md px-4 py-6 text-center text-[12px] ${FAINT}`}>还没有持仓。</p>
      ) : groupStats.filter((g) => g.rows.length > 0).map(({ m, rows, mv, cost, day, unreal, realized }) => {
        const ccy = CCY[m];
        const pnl = cost > 0 ? (unreal / cost) * 100 : 0;
        const rate = toCny(m) ?? 1; // 市值列折 ¥(他的价值,第一列)
        const cap = CAPITAL[m];
        const totProfit = realized + unreal; // 该市场总盈利 = 已实现(含已平仓段)+ 持仓浮动
        return (
          <div key={m} className={`${PANEL} overflow-hidden rounded-md`}>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[#262b35] bg-[#1a1e26] px-3 py-2">
              <span className={`text-[12px] font-semibold tracking-wide ${INK}`}>{MKT_NAME[m]}</span>
              {cap != null && (
                <span className={`font-mono text-[11.5px] font-semibold tabular-nums ${pn(totProfit)}`}>
                  收益率 {sign((totProfit / cap) * 100)}%
                  <span className={`ml-1 font-normal ${MUT}`}>({sign(totProfit, 0)} / 本金{ccy}{fmt(cap, 0)})</span>
                </span>
              )}
              <span className={`font-mono text-[11px] tabular-nums ${MUT}`}>{m === "perp" ? "名义 " : ""}{ccy}{fmt(mv, 0)}</span>
              <span className={`font-mono text-[11px] tabular-nums ${pn(day)}`}>今日 {sign(day, 0)}</span>
              <span className={`font-mono text-[11px] tabular-nums ${pn(unreal)}`}>未实现 {sign(unreal, 0)}({sign(pnl)}%)</span>
              <span className={`ml-auto font-mono text-[10px] ${FAINT}`}>{m === "perp" ? "开仓额" : "成本"} {ccy}{fmt(cost, 0)}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[660px] text-[12px]">
                <thead>
                  <tr className={`border-b border-[#262b35] text-left text-[10px] uppercase tracking-[0.12em] ${FAINT}`}>
                    {["市值 ¥", "代码", "名称", "数量", "成本", "现价", "今日", "盈亏%", "盈亏额", "占比"].map((h, i) => (
                      <th key={h} className={`px-3 py-1.5 font-medium ${i >= 3 ? "text-right" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const q = quotes[qKey(p.market, p.sym)];
                    const px = q?.price ?? null;
                    const v = px ? px * p.qty : p.invested;
                    const eff = isShort(p) ? -1 : 1;
                    const pnlPct = px ? (eff * (px - p.avgCost) * 100) / p.avgCost : null;
                    const pnlAmt = px ? eff * (px - p.avgCost) * p.qty : null;
                    return (
                      <tr key={p.sym} className="border-b border-[#1e222b] transition hover:bg-[#1a1e26]">
                        <td className={`px-3 py-[7px] font-mono font-bold tabular-nums ${INK}`}>¥{fmt(v * rate, 0)}</td>
                        <td className="whitespace-nowrap px-3 py-[7px]"><a href={`/stock/${p.sym}?market=${m === "perp" ? "us" : m}`} className="font-mono font-semibold text-[#7eb3ff] hover:underline">{p.sym}</a><DirBadge dir={p.dir} lev={p.lev} /></td>
                        <td className={`max-w-[180px] truncate px-3 py-[7px] ${MUT}`} title={p.lastReason || p.name}>{p.name}</td>
                        <td className={`px-3 py-[7px] text-right font-mono tabular-nums ${MUT}`}>{fmt(p.qty, p.qty % 1 ? 2 : 0)}</td>
                        <td className={`px-3 py-[7px] text-right font-mono tabular-nums ${MUT}`}>{fmt(p.avgCost)}</td>
                        <td className={`px-3 py-[7px] text-right font-mono tabular-nums ${INK}`}>{px ? fmt(px) : "—"}</td>
                        <td className={`px-3 py-[7px] text-right font-mono tabular-nums ${q?.pct == null ? FAINT : pn(q.pct)}`}>{q?.pct == null ? "—" : `${sign(q.pct)}%`}</td>
                        <td className={`px-3 py-[7px] text-right font-mono tabular-nums ${pnlPct == null ? FAINT : pn(pnlPct)}`}>{pnlPct == null ? "—" : `${sign(pnlPct)}%`}</td>
                        <td className={`px-3 py-[7px] text-right font-mono tabular-nums ${pnlAmt == null ? FAINT : pn(pnlAmt)}`}>{pnlAmt == null ? "—" : sign(pnlAmt, 0)}</td>
                        <td className={`px-3 py-[7px] text-right font-mono tabular-nums ${FAINT}`}>{mv > 0 ? fmt((v / mv) * 100, 1) : "0"}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* ===== AI 日报 ===== */}
      <div className={`${PANEL} rounded-md`}>
        <div className="flex items-center justify-between border-b border-[#262b35] bg-[#1a1e26] px-3 py-2">
          <span className={`text-[11px] font-semibold uppercase tracking-[0.15em] ${MUT}`}>AI 持仓日报{todayDaily && <span className={`ml-2 font-mono normal-case ${FAINT}`}>{todayDaily.date}</span>}</span>
          <button onClick={() => generate("daily")} disabled={genState === "daily"} className={BTN}>{genState === "daily" ? "生成中…(~30s)" : "重新生成"}</button>
        </div>
        <div className="px-3 py-3">
          {genErr && <p className={`mb-2 text-[11px] ${DN}`}>{genErr}</p>}
          {!data.aiReady && <p className={`mb-2 text-[11px] ${FAINT}`}>AI 未接入:Vercel env 加 NDT_CLAUDE_KEY(或 NDT_API_KEY)并 redeploy。持仓/收益不受影响。</p>}
          {todayDaily ? <Md md={todayDaily.md} /> : <p className={`text-[12px] ${FAINT}`}>{genState === "daily" ? "AI 正在整理今天的持仓…" : "今天还没有日报。"}</p>}
        </div>
      </div>

      {/* ===== 平仓复盘 ===== */}
      <div className={`${PANEL} rounded-md`}>
        <div className={`border-b border-[#262b35] bg-[#1a1e26] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] ${MUT}`}>平仓复盘</div>
        <div className="px-3 py-2">
          {openLotsPending.map((l) => (
            <div key={l.lotId} className="flex items-center justify-between border-b border-[#1e222b] py-1.5 text-[12px]">
              <span className={MUT}><span className="font-mono text-[#7eb3ff]">{l.sym}</span><DirBadge dir={l.dir} lev={l.lev} /> {l.name} · {l.openDate}→{l.closeDate} · <span className={`font-mono ${pn(l.realized)}`}>{CCY[l.market]}{sign(l.realized, 0)}({sign(l.retPct)}%)</span> · 未复盘</span>
              <button onClick={() => generate("review", l.lotId)} disabled={genState === l.lotId} className={BTN}>{genState === l.lotId ? "生成中…" : "生成复盘"}</button>
            </div>
          ))}
          {data.reviews.length === 0 && openLotsPending.length === 0 ? (
            <p className={`py-3 text-[12px] ${FAINT}`}>还没有已平仓的操作。卖清某只票后自动出现该笔 AI 复盘。</p>
          ) : (
            data.reviews.map((v) => (
              <details key={v.lotId} className="border-b border-[#1e222b] last:border-0">
                <summary className="cursor-pointer select-none py-2 text-[12px]">
                  <span className="font-mono font-semibold text-[#7eb3ff]">{v.sym}</span><DirBadge dir={v.dir} lev={v.lev} />
                  <span className={`ml-2 ${MUT}`}>{v.name} · {v.openDate}→{v.closeDate} · {v.holdDays}天</span>
                  <span className={`ml-2 font-mono tabular-nums ${pn(v.realized)}`}>{CCY[v.market]}{sign(v.realized, 0)} ({sign(v.retPct)}%)</span>
                </summary>
                <div className="border-t border-[#1e222b] py-2.5"><Md md={v.md} /></div>
              </details>
            ))
          )}
        </div>
      </div>

      {/* ===== 交易流水 ===== */}
      <div className={`${PANEL} overflow-hidden rounded-md`}>
        <div className={`border-b border-[#262b35] bg-[#1a1e26] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] ${MUT}`}>交易流水 <span className="font-mono normal-case">{data.trades.length}</span></div>
        {data.trades.length > 0 && (
          <div className="max-h-[380px] overflow-y-auto overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12px]">
              <thead className="sticky top-0 bg-[#15181e]">
                <tr className={`border-b border-[#262b35] text-left text-[10px] uppercase tracking-[0.12em] ${FAINT}`}>
                  {["日期", "向", "代码", "价格", "数量", "理由", ""].map((h, i) => <th key={i} className={`px-3 py-1.5 font-medium ${i === 3 || i === 4 ? "text-right" : ""}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.trades.map((tr) => (
                  <tr key={tr.id} className="border-b border-[#1e222b] hover:bg-[#1a1e26]">
                    <td className={`px-3 py-[6px] font-mono tabular-nums ${FAINT}`}>{tr.date}</td>
                    <td className={`px-3 py-[6px] font-semibold ${tr.side === "BUY" ? UP : DN}`}>{tr.side === "BUY" ? "买" : "卖"}</td>
                    <td className="px-3 py-[6px]"><span className="font-mono text-[#7eb3ff]">{tr.sym}</span><span className={`ml-1 text-[10px] ${FAINT}`}>{tr.market}</span></td>
                    <td className={`px-3 py-[6px] text-right font-mono tabular-nums ${MUT}`}>{fmt(tr.price)}</td>
                    <td className={`px-3 py-[6px] text-right font-mono tabular-nums ${MUT}`}>{fmt(tr.qty, tr.qty % 1 ? 2 : 0)}</td>
                    <td className={`max-w-[260px] truncate px-3 py-[6px] ${FAINT}`} title={tr.reason}>{tr.reason || "—"}</td>
                    <td className="px-3 py-[6px] text-right"><button onClick={() => delTrade(tr.id)} className="text-[10px] text-[#5a6372] transition hover:text-[#f4525f]">删</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
