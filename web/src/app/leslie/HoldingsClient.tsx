"use client";

// 私人持仓终端(Finviz 式深色高密度,固定配色不随站点主题):
// 录买卖 → 实时收益 → AI 日报(打开自动补当天)→ 平仓自动复盘。
// 口令与 /stats 共用(localStorage sg_stats_token / STATS_TOKEN);数据在 Upstash;现价 QUOTE_URL 30s 轮询。
import { useCallback, useEffect, useRef, useState } from "react";
import { QUOTE_URL } from "@/lib/quote-api";
import { yahooSym } from "@/lib/quote-sym";
import { CCY, type ClosedLot, type Market, type Position, type Side, type Trade } from "@/lib/portfolio";

type Quote = { price: number; pct: number | null };
type Daily = { date: string; md: string; genAt: number };
type Review = { lotId: string; market: Market; sym: string; name: string; openDate: string; closeDate: string; holdDays: number; realized: number; retPct: number; buyAmt: number; md: string };
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
const toQuoteSym = (m: Market, s: string) => (m === "us" ? s : yahooSym(s, m));
const MKT_NAME: Record<Market, string> = { us: "美股", a: "A股", hk: "港股" };

// —— 终端调色板(独立于站点主题;深邃灰阶 + 克制红绿 + 少量橙) ——
const INK = "text-[#d6dbe4]", MUT = "text-[#8a93a3]", FAINT = "text-[#5a6372]";
const UP = "text-[#22c55e]", DN = "text-[#f4525f]";
const PANEL = "border border-[#262b35] bg-[#15181e]";
const INPUT = "rounded border border-[#2c323e] bg-[#0e1014] px-2 py-1.5 text-[12px] text-[#d6dbe4] outline-none focus:border-[#fb923c66]";
const BTN = "rounded border border-[#2c323e] bg-[#1a1e26] px-2.5 py-1 text-[11px] text-[#8a93a3] transition hover:text-[#d6dbe4] hover:border-[#3a4150] disabled:opacity-40";
const BTN_ACC = "rounded bg-[#fb923c] px-2.5 py-1 text-[11px] font-semibold text-[#1a0f08] transition hover:brightness-110 disabled:opacity-40";
const pn = (n: number) => (n >= 0 ? UP : DN);

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
  const [f, setF] = useState({ market: "us" as Market, sym: "", name: "", side: "BUY" as Side, price: "", qty: "", date: bjToday(), reason: "" });
  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr] = useState("");
  const submitTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErr(""); setSubmitting(true);
    try {
      const r = await fetch("/api/portfolio", {
        method: "POST", headers: { ...authHdr(token), "content-type": "application/json" },
        body: JSON.stringify({ action: "trade", trade: { market: f.market, sym: f.sym.trim(), name: f.name.trim(), side: f.side, price: Number(f.price), qty: Number(f.qty), date: f.date, reason: f.reason.trim() } }),
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
        const trade = { market: (x.market || "us") as Market, sym: x.sym, name: x.name || "", side: (x.side || "BUY") as Side, price: x.price, qty: x.qty, date: x.date || bjToday(), reason: x.reason || "" };
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
  const groups: Market[] = ["us", "a", "hk"];
  const openLotsPending = data.lots.filter((l) => !data.reviews.some((v) => v.lotId === l.lotId));

  // 分组统计:市值/成本/已实现/当日盈亏(day = Σ mv·pct/(100+pct))
  const groupStats = groups.map((m) => {
    const rows = data.positions.filter((p) => p.market === m);
    let mv = 0, cost = 0, day = 0;
    for (const p of rows) {
      const q = quotes[qKey(p.market, p.sym)];
      const v = q ? q.price * p.qty : p.invested;
      mv += v; cost += p.invested;
      if (q && q.pct != null) day += (v * q.pct) / (100 + q.pct);
    }
    const held = new Set(rows.map((p) => p.sym));
    const realized = rows.reduce((a, p) => a + p.realized, 0) +
      data.lots.filter((l) => l.market === m && !held.has(l.sym)).reduce((a, l) => a + l.realized, 0);
    return { m, rows, mv, cost, day, realized };
  }).filter((g) => g.rows.length > 0 || Math.abs(g.realized) > 1e-9);

  // 总计(折 ¥):A股=1,美/港按实时汇率
  const toCny = (m: Market) => (m === "a" ? 1 : m === "us" ? fx.USD ?? null : fx.HKD ?? null);
  const fxReady = groupStats.every((g) => toCny(g.m) != null);
  const tot = fxReady && groupStats.length > 0
    ? groupStats.reduce((acc, g) => {
        const r = toCny(g.m)!;
        acc.mv += g.mv * r; acc.cost += g.cost * r; acc.day += g.day * r; acc.realized += g.realized * r;
        return acc;
      }, { mv: 0, cost: 0, day: 0, realized: 0 })
    : null;
  const single = groupStats.length === 1 ? groupStats[0] : null;
  const kpi = tot && !single
    ? { ccy: "¥", ...tot }
    : single
      ? { ccy: CCY[single.m], mv: single.mv, cost: single.cost, day: single.day, realized: single.realized }
      : null;

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
            <Kpi label={`总资产 ${kpi.ccy !== "¥" ? kpi.ccy : "· 折算¥"}`}><span className={INK}>{kpi.ccy}{fmt(kpi.mv, 0)}</span></Kpi>
            <Kpi label="今日"><span className={pn(kpi.day)}>{kpi.ccy}{sign(kpi.day, 0)}{kpi.mv - kpi.day > 0 ? ` (${sign((kpi.day / (kpi.mv - kpi.day)) * 100)}%)` : ""}</span></Kpi>
            <Kpi label="浮动盈亏"><span className={pn(kpi.mv - kpi.cost)}>{kpi.ccy}{sign(kpi.mv - kpi.cost, 0)}{kpi.cost > 0 ? ` (${sign(((kpi.mv - kpi.cost) / kpi.cost) * 100)}%)` : ""}</span></Kpi>
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

      {/* ===== 导入 / 录入面板 ===== */}
      {showImport && (
        <div className={`${PANEL} rounded-md p-3`}>
          <p className={`mb-2 text-[11px] ${FAINT}`}>粘 JSON 数组批量录入。sym/price/qty 必填;market 默认 us、side 默认 BUY、date 默认今天。逐笔写入,别关页面。</p>
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
            ["市场", <select key="m" value={f.market} onChange={(e) => setF({ ...f, market: e.target.value as Market })} className={`w-full ${INPUT}`}><option value="us">美股</option><option value="a">A股</option><option value="hk">港股</option></select>],
            ["代码", <input key="s" value={f.sym} onChange={(e) => setF({ ...f, sym: e.target.value })} placeholder="NVDA / 600519" required className={`w-full ${INPUT} font-mono`} />],
            ["名称(可选)", <input key="n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={`w-full ${INPUT}`} />],
            ["方向", <select key="d" value={f.side} onChange={(e) => setF({ ...f, side: e.target.value as Side })} className={`w-full ${INPUT}`}><option value="BUY">买入</option><option value="SELL">卖出</option></select>],
            ["价格", <input key="p" type="number" step="any" min="0" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required className={`w-full ${INPUT} font-mono`} />],
            ["数量(股)", <input key="q" type="number" step="any" min="0" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required className={`w-full ${INPUT} font-mono`} />],
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
      ) : groupStats.filter((g) => g.rows.length > 0).map(({ m, rows, mv, cost, day }) => {
        const ccy = CCY[m];
        const pnl = cost > 0 ? ((mv - cost) / cost) * 100 : 0;
        return (
          <div key={m} className={`${PANEL} overflow-hidden rounded-md`}>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[#262b35] bg-[#1a1e26] px-3 py-2">
              <span className={`text-[12px] font-semibold tracking-wide ${INK}`}>{MKT_NAME[m]}</span>
              <span className={`font-mono text-[11px] tabular-nums ${MUT}`}>{ccy}{fmt(mv, 0)}</span>
              <span className={`font-mono text-[11px] tabular-nums ${pn(day)}`}>今日 {sign(day, 0)}</span>
              <span className={`font-mono text-[11px] tabular-nums ${pn(pnl)}`}>{sign(pnl)}%</span>
              <span className={`ml-auto font-mono text-[10px] ${FAINT}`}>成本 {ccy}{fmt(cost, 0)}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[660px] text-[12px]">
                <thead>
                  <tr className={`border-b border-[#262b35] text-left text-[10px] uppercase tracking-[0.12em] ${FAINT}`}>
                    {["代码", "名称", "数量", "成本", "现价", "今日", "盈亏%", "盈亏额", "市值", "占比"].map((h, i) => (
                      <th key={h} className={`px-3 py-1.5 font-medium ${i >= 2 ? "text-right" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const q = quotes[qKey(p.market, p.sym)];
                    const px = q?.price ?? null;
                    const v = px ? px * p.qty : p.invested;
                    const pnlPct = px ? (px / p.avgCost - 1) * 100 : null;
                    const pnlAmt = px ? (px - p.avgCost) * p.qty : null;
                    return (
                      <tr key={p.sym} className="border-b border-[#1e222b] transition hover:bg-[#1a1e26]">
                        <td className="px-3 py-[7px]"><a href={`/stock/${p.sym}?market=${m}`} className="font-mono font-semibold text-[#7eb3ff] hover:underline">{p.sym}</a></td>
                        <td className={`max-w-[180px] truncate px-3 py-[7px] ${MUT}`} title={p.lastReason || p.name}>{p.name}</td>
                        <td className={`px-3 py-[7px] text-right font-mono tabular-nums ${MUT}`}>{fmt(p.qty, p.qty % 1 ? 2 : 0)}</td>
                        <td className={`px-3 py-[7px] text-right font-mono tabular-nums ${MUT}`}>{fmt(p.avgCost)}</td>
                        <td className={`px-3 py-[7px] text-right font-mono tabular-nums ${INK}`}>{px ? fmt(px) : "—"}</td>
                        <td className={`px-3 py-[7px] text-right font-mono tabular-nums ${q?.pct == null ? FAINT : pn(q.pct)}`}>{q?.pct == null ? "—" : `${sign(q.pct)}%`}</td>
                        <td className={`px-3 py-[7px] text-right font-mono tabular-nums ${pnlPct == null ? FAINT : pn(pnlPct)}`}>{pnlPct == null ? "—" : `${sign(pnlPct)}%`}</td>
                        <td className={`px-3 py-[7px] text-right font-mono tabular-nums ${pnlAmt == null ? FAINT : pn(pnlAmt)}`}>{pnlAmt == null ? "—" : sign(pnlAmt, 0)}</td>
                        <td className={`px-3 py-[7px] text-right font-mono tabular-nums ${INK}`}>{fmt(v, 0)}</td>
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
              <span className={MUT}><span className="font-mono text-[#7eb3ff]">{l.sym}</span> {l.name} · {l.openDate}→{l.closeDate} · <span className={`font-mono ${pn(l.realized)}`}>{sign(l.retPct)}%</span> · 未复盘</span>
              <button onClick={() => generate("review", l.lotId)} disabled={genState === l.lotId} className={BTN}>{genState === l.lotId ? "生成中…" : "生成复盘"}</button>
            </div>
          ))}
          {data.reviews.length === 0 && openLotsPending.length === 0 ? (
            <p className={`py-3 text-[12px] ${FAINT}`}>还没有已平仓的操作。卖清某只票后自动出现该笔 AI 复盘。</p>
          ) : (
            data.reviews.map((v) => (
              <details key={v.lotId} className="border-b border-[#1e222b] last:border-0">
                <summary className="cursor-pointer select-none py-2 text-[12px]">
                  <span className="font-mono font-semibold text-[#7eb3ff]">{v.sym}</span>
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
