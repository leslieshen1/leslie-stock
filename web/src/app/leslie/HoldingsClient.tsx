"use client";

// 私人持仓面板:录买卖 → 实时收益 → AI 日报(打开自动补当天)→ 平仓自动复盘。
// 口令与 /stats 共用(localStorage sg_stats_token / STATS_TOKEN);数据在 Upstash,只有带口令的请求可读写。
// 现价走 QUOTE_URL(美/A/港现成,30s 轮询);NAV 快照由本组件拿到行情后回传打点。
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { QUOTE_URL } from "@/lib/quote-api";
import { yahooSym } from "@/lib/quote-sym";
import { CCY, type ClosedLot, type Market, type Position, type Trade } from "@/lib/portfolio";

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
const bjToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const qKey = (m: Market, s: string) => `${m}|${s}`;
const toQuoteSym = (m: Market, s: string) => (m === "us" ? s : yahooSym(s, m));

function Md({ md }: { md: string }) {
  const bold = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((seg, i) =>
      seg.startsWith("**") ? <strong key={i} className="font-semibold text-ink">{seg.slice(2, -2)}</strong> : seg);
  return (
    <div className="space-y-2 text-sm leading-relaxed text-muted">
      {md.split(/\n+/).map((ln, i) =>
        ln.startsWith("###") ? (
          <h4 key={i} className="pt-1.5 text-[13px] font-semibold tracking-wide text-ink">{ln.replace(/^#+\s*/, "")}</h4>
        ) : (
          <p key={i} className="whitespace-pre-wrap">{bold(ln)}</p>
        ))}
    </div>
  );
}

export default function HoldingsClient() {
  const { t } = useLang();
  const [token, setToken] = useState("");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"gate" | "bad" | "loading" | "ok" | "error" | "no-store">("gate");
  const [data, setData] = useState<Data | null>(null);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [fx, setFx] = useState<{ USD?: number; HKD?: number }>({}); // →¥ 实时汇率(跨市场总计折算)
  const [genState, setGenState] = useState<string>("");   // "" | "daily" | lotId
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

  // —— 行情轮询(持仓集合变化时重启;30s)——
  useEffect(() => {
    const pos = data?.positions || [];
    if (!pos.length) return;
    let stop = false;
    const back = new Map(pos.map((p) => [toQuoteSym(p.market, p.sym).toUpperCase(), qKey(p.market, p.sym)]));
    // 捎带汇率(Yahoo 兜底能识别 USDCNY=X):有美股/港股仓才拉,供总计折算 ¥
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
    if (covered < Math.min(pos.length, Math.ceil(pos.length * 0.7))) return; // 行情到位 ≥70% 再动
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
      if (!r.ok) setGenErr(String(j.error || (j.aiDisabled ? "AI 未接入:在 Vercel env 加 NDT_CLAUDE_KEY(或 NDT_API_KEY)后重试" : `失败 ${r.status}`)));
      await load(token || localStorage.getItem("sg_stats_token") || "");
    } catch { setGenErr("网络错误,稍后重试"); }
    setGenState("");
  }, [authHdr, token, quotesPayload, load]);

  // —— 录入 ——
  const [f, setF] = useState({ market: "us" as Market, sym: "", name: "", side: "BUY" as "BUY" | "SELL", price: "", qty: "", date: bjToday(), reason: "" });
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
      if (j.closedLot?.lotId) generate("review", j.closedLot.lotId); // 平仓 → 自动复盘
    } catch { setFormErr("网络错误"); }
    setSubmitting(false);
  };

  const delTrade = async (id: string) => {
    if (!confirm(t("删除这笔记录?(仅用于录错撤销,会重算持仓)", "Delete this record? Positions will be recalculated."))) return;
    await fetch("/api/portfolio", { method: "POST", headers: { ...authHdr(token), "content-type": "application/json" }, body: JSON.stringify({ action: "deleteTrade", id }) });
    load(token);
  };

  // ---------- 口令门 ----------
  if (status === "gate" || status === "bad") {
    return (
      <div className="mx-auto max-w-sm py-10">
        <p className="mb-3 text-sm text-muted">{t("持仓是私密数据,输入访问口令(与 /stats 同一个)。", "Holdings are private. Enter the access token (same as /stats).")}</p>
        <form onSubmit={(e) => { e.preventDefault(); const tok = input.trim(); if (!tok) return; try { localStorage.setItem("sg_stats_token", tok); } catch {} setToken(tok); load(tok); }} className="space-y-3">
          <input type="password" value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("口令", "Token")} autoFocus
            className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-accent/60" />
          {status === "bad" && <p className="text-xs text-down">{t("口令不对。", "Wrong token.")}</p>}
          <button type="submit" className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-[#1a0f08] hover:brightness-110">{t("进入", "Enter")}</button>
        </form>
      </div>
    );
  }
  if (status === "loading") return <p className="py-16 text-center text-sm text-muted">{t("加载中…", "Loading…")}</p>;
  if (status === "no-store") return <p className="py-16 text-center text-sm text-muted">{t("还没接 Upstash 存储(Vercel → Storage)。", "Storage not connected (Vercel → Storage).")}</p>;
  if (status === "error" || !data) return <p className="py-16 text-center text-sm text-down">{t("读取失败。", "Failed to load.")} <button onClick={() => load(token)} className="underline">{t("重试", "Retry")}</button></p>;

  const today = bjToday();
  const todayDaily = data.daily.find((d) => d.date === today) || data.daily[data.daily.length - 1] || null;
  const groups: Market[] = ["us", "a", "hk"];
  const openLotsPending = data.lots.filter((l) => !data.reviews.some((v) => v.lotId === l.lotId));

  // 分组统计(渲染与总计共用)。已实现 = 未清仓票累计 + 已完全清仓票的平仓段
  const groupStats = groups.map((m) => {
    const rows = data.positions.filter((p) => p.market === m);
    let mv = 0, cost = 0;
    for (const p of rows) {
      const q = quotes[qKey(p.market, p.sym)];
      mv += q ? q.price * p.qty : p.invested;
      cost += p.invested;
    }
    const held = new Set(rows.map((p) => p.sym));
    const realized = rows.reduce((a, p) => a + p.realized, 0) +
      data.lots.filter((l) => l.market === m && !held.has(l.sym)).reduce((a, l) => a + l.realized, 0);
    return { m, rows, mv, cost, realized };
  }).filter((g) => g.rows.length > 0 || Math.abs(g.realized) > 1e-9);

  // 跨市场总计:全部折算 ¥(A股=1,美/港按实时汇率)。多币种才有意义,单币种不显示。
  const toCny = (m: Market) => (m === "a" ? 1 : m === "us" ? fx.USD ?? null : fx.HKD ?? null);
  const fxReady = groupStats.every((g) => toCny(g.m) != null);
  const tot = fxReady && groupStats.length > 0
    ? groupStats.reduce((acc, g) => {
        const r = toCny(g.m)!;
        acc.mv += g.mv * r; acc.cost += g.cost * r; acc.realized += g.realized * r;
        return acc;
      }, { mv: 0, cost: 0, realized: 0 })
    : null;

  return (
    <div className="space-y-8">
      {/* 持仓 + 录入按钮 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium text-muted">{t("当前持仓", "Positions")}</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowForm((v) => !v)} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-[#1a0f08] hover:brightness-110">
              {showForm ? t("收起", "Close") : t("+ 记一笔", "+ Add trade")}
            </button>
            <button onClick={() => load(token)} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-muted hover:text-ink">{t("刷新", "Refresh")}</button>
          </div>
        </div>

        {showForm && (
          <form onSubmit={submitTrade} className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-4">
            <label className="text-xs text-muted">{t("市场", "Market")}
              <select value={f.market} onChange={(e) => setF({ ...f, market: e.target.value as Market })} className="mt-1 w-full rounded-lg border border-line bg-base px-2 py-2 text-sm text-ink">
                <option value="us">{t("美股", "US")}</option><option value="a">{t("A股", "A-share")}</option><option value="hk">{t("港股", "HK")}</option>
              </select></label>
            <label className="text-xs text-muted">{t("代码", "Symbol")}
              <input value={f.sym} onChange={(e) => setF({ ...f, sym: e.target.value })} placeholder="NVDA / 600519 / 0700" required className="mt-1 w-full rounded-lg border border-line bg-base px-2 py-2 text-sm text-ink" /></label>
            <label className="text-xs text-muted">{t("名称(可选)", "Name (optional)")}
              <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-base px-2 py-2 text-sm text-ink" /></label>
            <label className="text-xs text-muted">{t("方向", "Side")}
              <select value={f.side} onChange={(e) => setF({ ...f, side: e.target.value as "BUY" | "SELL" })} className="mt-1 w-full rounded-lg border border-line bg-base px-2 py-2 text-sm text-ink">
                <option value="BUY">{t("买入", "Buy")}</option><option value="SELL">{t("卖出", "Sell")}</option>
              </select></label>
            <label className="text-xs text-muted">{t("价格", "Price")}
              <input type="number" step="any" min="0" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required className="mt-1 w-full rounded-lg border border-line bg-base px-2 py-2 text-sm text-ink tnum" /></label>
            <label className="text-xs text-muted">{t("数量(股)", "Qty")}
              <input type="number" step="any" min="0" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required className="mt-1 w-full rounded-lg border border-line bg-base px-2 py-2 text-sm text-ink tnum" /></label>
            <label className="text-xs text-muted">{t("成交日", "Date")}
              <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required className="mt-1 w-full rounded-lg border border-line bg-base px-2 py-2 text-sm text-ink" /></label>
            <label className="col-span-2 text-xs text-muted sm:col-span-4">{t("理由(复盘的原料,强烈建议写)", "Reason (fuel for the review — write it)")}
              <textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} rows={2} placeholder={t("为什么买 / 为什么卖…", "Why buy / why sell…")} className="mt-1 w-full rounded-lg border border-line bg-base px-2 py-2 text-sm text-ink" /></label>
            {formErr && <p className="col-span-2 text-xs text-down sm:col-span-4">{formErr}</p>}
            <div className="col-span-2 sm:col-span-4">
              <button type="submit" disabled={submitting} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-[#1a0f08] hover:brightness-110 disabled:opacity-50">
                {submitting ? t("提交中…", "Submitting…") : t("确认记录", "Save")}
              </button>
            </div>
          </form>
        )}

        {/* 跨市场总计(多币种时显示;A股原值,美/港按实时汇率折 ¥) */}
        {groupStats.length > 1 && (
          <div className="mb-4 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3">
            {tot ? (
              <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
                <span className="font-semibold text-ink">{t("总计(折算¥)", "Total (¥)")}</span>
                <span className="text-muted">{t("市值", "MV")} ¥{fmt(tot.mv, 0)}</span>
                <span className="text-muted">{t("成本", "Cost")} ¥{fmt(tot.cost, 0)}</span>
                <span className={`tnum ${tot.mv - tot.cost >= 0 ? "text-up" : "text-down"}`}>
                  {t("浮盈", "P&L")} {tot.cost > 0 ? `${tot.mv - tot.cost >= 0 ? "+" : ""}${fmt(((tot.mv - tot.cost) / tot.cost) * 100)}%` : "—"}(¥{tot.mv - tot.cost >= 0 ? "+" : ""}{fmt(tot.mv - tot.cost, 0)})
                </span>
                {Math.abs(tot.realized) > 0.5 && (
                  <span className={`tnum ${tot.realized >= 0 ? "text-up" : "text-down"}`}>{t("已实现", "Realized")} ¥{tot.realized >= 0 ? "+" : ""}{fmt(tot.realized, 0)}</span>
                )}
                <span className="text-[11px] text-faint">
                  {fx.USD ? `1$≈¥${fmt(fx.USD)}` : ""}{fx.USD && fx.HKD ? " · " : ""}{fx.HKD ? `1HK$≈¥${fmt(fx.HKD)}` : ""}{t(" 实时", " live")}
                </span>
              </div>
            ) : (
              <p className="text-xs text-faint">{t("总计:汇率加载中…", "Total: loading FX…")}</p>
            )}
          </div>
        )}

        {data.positions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-2 bg-surface p-10 text-center text-sm text-muted">{t("还没有持仓,点「+ 记一笔」录入第一笔买入。", "No positions yet — add your first buy.")}</div>
        ) : groupStats.filter((g) => g.rows.length > 0).map(({ m, rows, mv, cost }) => {
          const ccy = CCY[m];
          const body = rows.map((p) => {
            const q = quotes[qKey(p.market, p.sym)];
            const px = q?.price ?? null;
            const v = px ? px * p.qty : p.invested;
            const pnlPct = px ? (px / p.avgCost - 1) * 100 : null;
            return (
              <tr key={p.sym} className="hover:bg-surface-2">
                <td className="px-3 py-2.5"><a href={`/stock/${p.sym}?market=${m === "us" ? "us" : m}`} className="font-medium text-ink hover:text-accent">{p.name}</a><span className="ml-1.5 font-mono text-[11px] text-faint">{p.sym}</span></td>
                <td className="px-3 py-2.5 text-right tnum">{fmt(p.qty, 0)}</td>
                <td className="px-3 py-2.5 text-right tnum text-muted">{fmt(p.avgCost)}</td>
                <td className="px-3 py-2.5 text-right tnum">{px ? fmt(px) : "—"}</td>
                <td className={`px-3 py-2.5 text-right tnum ${q?.pct == null ? "text-faint" : q.pct >= 0 ? "text-up" : "text-down"}`}>{q?.pct == null ? "—" : `${q.pct >= 0 ? "+" : ""}${fmt(q.pct)}%`}</td>
                <td className={`px-3 py-2.5 text-right tnum ${pnlPct == null ? "text-faint" : pnlPct >= 0 ? "text-up" : "text-down"}`}>{pnlPct == null ? "—" : `${pnlPct >= 0 ? "+" : ""}${fmt(pnlPct)}%`}</td>
                <td className="px-3 py-2.5 text-right tnum text-muted">{ccy}{fmt(v, 0)}</td>
              </tr>
            );
          });
          const pnl = cost > 0 ? ((mv - cost) / cost) * 100 : 0;
          return (
            <div key={m} className="mb-4 overflow-hidden rounded-xl border border-line bg-surface">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line px-4 py-2.5 text-sm">
                <span className="font-semibold text-ink">{m === "us" ? t("美股", "US") : m === "a" ? t("A股", "A-shares") : t("港股", "HK")}</span>
                <span className="text-muted">{t("市值", "MV")} {ccy}{fmt(mv, 0)}</span>
                <span className="text-muted">{t("成本", "Cost")} {ccy}{fmt(cost, 0)}</span>
                <span className={pnl >= 0 ? "text-up" : "text-down"}>{t("浮盈", "P&L")} {pnl >= 0 ? "+" : ""}{fmt(pnl)}%</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-faint">
                    <tr>{[t("股票", "Stock"), t("股数", "Qty"), t("成本", "Cost"), t("现价", "Price"), t("今日", "Day"), t("浮盈", "P&L"), t("市值", "MV")].map((h, i) => <th key={i} className={`px-3 py-2 font-medium ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-line">{body}</tbody>
                </table>
              </div>
            </div>
          );
        })}
      </section>

      {/* AI 日报 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium text-muted">{t("AI 持仓日报", "AI Daily Note")}{todayDaily && <span className="ml-2 text-xs text-faint">· {todayDaily.date}</span>}</h2>
          <button onClick={() => generate("daily")} disabled={genState === "daily"} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-muted hover:text-ink disabled:opacity-50">
            {genState === "daily" ? t("生成中…(约半分钟)", "Generating… (~30s)") : t("重新生成", "Regenerate")}
          </button>
        </div>
        {genErr && <p className="mb-2 text-xs text-down">{genErr}</p>}
        {!data.aiReady && <p className="mb-2 rounded-lg border border-line bg-surface p-3 text-xs text-muted">{t("AI 未接入:在 Vercel 环境变量加 NDT_CLAUDE_KEY(或 NDT_API_KEY,可选 NDT_BASE_URL)并 redeploy,日报和复盘就会自动工作。持仓/收益不受影响。", "AI not connected: add NDT_CLAUDE_KEY (or NDT_API_KEY) in Vercel env and redeploy.")}</p>}
        {todayDaily ? (
          <article className="rounded-xl border border-line bg-surface p-5"><Md md={todayDaily.md} /></article>
        ) : (
          <div className="rounded-xl border border-dashed border-line-2 bg-surface p-8 text-center text-sm text-muted">
            {genState === "daily" ? t("AI 正在整理今天的持仓…", "AI is writing today's note…") : t("今天还没有日报。", "No note for today yet.")}
          </div>
        )}
      </section>

      {/* 平仓复盘 */}
      <section>
        <h2 className="mb-3 text-lg font-medium text-muted">{t("平仓复盘", "Closed-trade Reviews")}</h2>
        {openLotsPending.map((l) => (
          <div key={l.lotId} className="mb-2 flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-2.5 text-sm">
            <span className="text-muted">{l.sym} {l.name} · {l.openDate} → {l.closeDate} · <span className={l.realized >= 0 ? "text-up" : "text-down"}>{l.realized >= 0 ? "+" : ""}{fmt(l.retPct)}%</span> {t("· 还没复盘", "· not reviewed")}</span>
            <button onClick={() => generate("review", l.lotId)} disabled={genState === l.lotId} className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:text-ink disabled:opacity-50">
              {genState === l.lotId ? t("生成中…", "Generating…") : t("生成复盘", "Review")}
            </button>
          </div>
        ))}
        {data.reviews.length === 0 && openLotsPending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-2 bg-surface p-8 text-center text-sm text-muted">{t("还没有已平仓的操作。卖出清零某只票后,这里会自动出现该笔的 AI 复盘。", "No closed trades yet — reviews appear automatically after you fully exit a position.")}</p>
        ) : (
          <div className="space-y-3">
            {data.reviews.map((v) => (
              <details key={v.lotId} className="rounded-xl border border-line bg-surface">
                <summary className="cursor-pointer select-none px-4 py-3 text-sm">
                  <span className="font-medium text-ink">{v.sym} {v.name}</span>
                  <span className="ml-2 text-muted">{v.openDate} → {v.closeDate} · {v.holdDays}{t("天", "d")}</span>
                  <span className={`ml-2 tnum ${v.realized >= 0 ? "text-up" : "text-down"}`}>{v.realized >= 0 ? "+" : ""}{CCY[v.market]}{fmt(v.realized, 0)}({v.retPct >= 0 ? "+" : ""}{fmt(v.retPct)}%)</span>
                </summary>
                <div className="border-t border-line p-4"><Md md={v.md} /></div>
              </details>
            ))}
          </div>
        )}
      </section>

      {/* 交易流水 */}
      <section>
        <h2 className="mb-3 text-lg font-medium text-muted">{t("交易流水", "Trade Log")}<span className="ml-2 text-xs text-faint">{data.trades.length} {t("笔", "records")}</span></h2>
        {data.trades.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="max-h-[420px] overflow-y-auto overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="sticky top-0 bg-surface text-[11px] uppercase tracking-wider text-faint">
                  <tr>{[t("日期", "Date"), t("方向", "Side"), t("股票", "Stock"), t("价格", "Price"), t("数量", "Qty"), t("理由", "Reason"), ""].map((h, i) => <th key={i} className={`px-3 py-2 font-medium ${i >= 3 && i <= 4 ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.trades.map((tr) => (
                    <tr key={tr.id} className="hover:bg-surface-2">
                      <td className="px-3 py-2 tnum text-muted">{tr.date}</td>
                      <td className={`px-3 py-2 font-medium ${tr.side === "BUY" ? "text-up" : "text-down"}`}>{tr.side === "BUY" ? t("买", "B") : t("卖", "S")}</td>
                      <td className="px-3 py-2 text-ink">{tr.sym}<span className="ml-1 text-[11px] text-faint">{tr.market}</span></td>
                      <td className="px-3 py-2 text-right tnum">{fmt(tr.price)}</td>
                      <td className="px-3 py-2 text-right tnum">{fmt(tr.qty, 0)}</td>
                      <td className="max-w-[280px] truncate px-3 py-2 text-muted" title={tr.reason}>{tr.reason || "—"}</td>
                      <td className="px-3 py-2 text-right"><button onClick={() => delTrade(tr.id)} className="text-xs text-faint hover:text-down">{t("删", "del")}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
