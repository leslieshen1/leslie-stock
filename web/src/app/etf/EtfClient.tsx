"use client";

import { useEffect, useMemo, useState } from "react";
import { useLang } from "@/lib/i18n";
import { type EtfData, type EtfRow, SUPERS, SORTS, CLS_TONE } from "@/lib/etf-types";

function EtfLogo({ sym }: { sym: string }) {
  const [bad, setBad] = useState(false);
  if (bad || !sym)
    return <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[9px] font-bold text-accent">{sym.slice(0, 2)}</span>;
  return <img src={`https://assets.parqet.com/logos/symbol/${sym}?format=png&size=44`} alt={sym}
    onError={() => setBad(true)} className="h-6 w-6 shrink-0 rounded-full border border-line bg-white object-cover" />;
}

function fmtAum(k: number | null): string {
  if (!k) return "—";
  const usd = k * 1000;
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(usd >= 1e10 ? 0 : 1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  return `$${(usd / 1e3).toFixed(0)}K`;
}
function pctCls(v: number | null): string {
  return v == null ? "text-faint" : v >= 0 ? "text-up" : "text-down";
}
function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${Math.round(v)}%`;
}
function mddCls(v: number | null): string {
  if (v == null) return "text-faint";
  if (v >= -20) return "text-up";
  if (v >= -40) return "text-accent";
  return "text-down";
}

const METRIC = (e: EtfRow, k: string): number | null =>
  k === "aum" ? e.aum : k === "ret1y" ? e.ret1y : k === "ret5y" ? e.ret5y : k === "mdd" ? e.mdd : e.aum;

export default function EtfClient() {
  const { t, lang } = useLang();
  const [data, setData] = useState<EtfData | null>(null);
  const [sup, setSup] = useState<string>("行业");
  const [sort, setSort] = useState<string>("aum");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/data/etf-analyses.json").then((r) => r.json()).then(setData).catch(() => {});
  }, []);

  const sortRows = useMemo(() => (rows: EtfRow[]) => {
    const k = sort;
    return [...rows].sort((a, b) => {
      const va = METRIC(a, k), vb = METRIC(b, k);
      if (va == null && vb == null) return (b.aum || 0) - (a.aum || 0);
      if (va == null) return 1;
      if (vb == null) return -1;
      return vb - va; // 全部降序:规模大/回报高/回撤小(mdd 负,-10 > -50)在前
    });
  }, [sort]);

  // 搜索:扁平结果;否则按板块分组
  const qq = q.trim().toUpperCase();
  const groups = useMemo(() => {
    if (!data) return [];
    let etfs = sup === "all" ? data.etfs : data.etfs.filter((e) => e.kind === sup);
    if (qq) etfs = data.etfs.filter((e) => e.sym.includes(qq) || e.name.toUpperCase().includes(qq));
    if (qq) return [{ sector: "__search", n: etfs.length, rows: sortRows(etfs) }];
    const map = new Map<string, EtfRow[]>();
    for (const e of etfs) (map.get(e.sector) || map.set(e.sector, []).get(e.sector)!).push(e);
    return [...map.entries()]
      .map(([sector, rows]) => ({ sector, n: rows.length, rows: sortRows(rows) }))
      .sort((a, b) => b.rows.reduce((s, e) => s + (e.aum || 0), 0) - a.rows.reduce((s, e) => s + (e.aum || 0), 0));
  }, [data, sup, qq, sortRows]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{t("ETF · 板块业绩", "ETFs · by sector & track record")}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          {t(
            "ETF 是篮子不是生意。按它押注的板块归类,看同一条赛道里谁跑得好(1年/5年)、谁回撤狠(最大回撤)。低费率宽基定投友好,杠杆反向是赌场——巴菲特/段永平的话照旧。",
            "An ETF is a basket. Grouped by the bet it makes — within one lane, who ran (1Y/5Y) and who bled (max drawdown). Low-cost broad index for holding; leveraged/inverse is a casino.",
          )}
        </p>
      </header>

      {/* 控制条 */}
      <div className="space-y-2.5">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={t("搜代码 / 名称…", "Search ticker / name…")}
          className="w-full max-w-xs rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus:border-accent/50" />
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SUPERS.map((s) => (
            <Chip key={s.key} active={sup === s.key && !qq} onClick={() => { setSup(s.key); setQ(""); }}>
              {t(s.zh, s.en)}{data?.supers[s.key] ? ` ${data.supers[s.key]}` : ""}
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-faint">{t("排序", "Sort")}</span>
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
            {SORTS.map((s) => (
              <button key={s.key} onClick={() => setSort(s.key)}
                className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${sort === s.key ? "bg-surface-3 text-ink" : "text-muted hover:text-ink"}`}>
                {t(s.zh, s.en)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!data && <p className="py-10 text-center text-sm text-faint">{t("加载中…", "Loading…")}</p>}

      <div className="space-y-4">
        {groups.map((g) => (
          <SectorBlock key={g.sector} sector={g.sector} rows={g.rows} sort={sort}
            open={expanded.has(g.sector) || g.sector === "__search"} t={t}
            onToggle={() => setExpanded((prev) => { const n = new Set(prev); n.has(g.sector) ? n.delete(g.sector) : n.add(g.sector); return n; })} />
        ))}
        {data && groups.length === 0 && <p className="py-8 text-center text-sm text-faint">{t("无匹配", "No match")}</p>}
      </div>

      <p className="text-center text-[11px] leading-relaxed text-faint">
        {t(
          `数据 = Nasdaq(AUM/费率 + 5年日线算回报与最大回撤)。${data?.n ?? "—"} 只 ETF、${data?.sectors.length ?? "—"} 个板块。回报为区间累计,非年化;最大回撤=区间内峰值到谷底最大跌幅 · 判决是费率+类型的机械映射 · 非投资建议。`,
          `Data = Nasdaq (AUM/expense + returns & max drawdown from 5y daily). ${data?.n ?? "—"} ETFs across ${data?.sectors.length ?? "—"} sectors. Returns are cumulative; max drawdown = largest peak-to-trough drop · not financial advice.`,
        )}
      </p>
    </div>
  );
}

function SectorBlock({ sector, rows, sort, open, onToggle, t }: {
  sector: string; rows: EtfRow[]; sort: string; open: boolean; onToggle: () => void; t: (zh: string, en: string) => string;
}) {
  const search = sector === "__search";
  const withRet = rows.filter((e) => e.ret5y != null);
  const withMdd = rows.filter((e) => e.mdd != null);
  const best = withRet.length ? withRet.reduce((a, b) => ((b.ret5y || 0) > (a.ret5y || 0) ? b : a)) : null;
  const worst = withMdd.length ? withMdd.reduce((a, b) => ((b.mdd || 0) < (a.mdd || 0) ? b : a)) : null;
  const totAum = rows.reduce((s, e) => s + (e.aum || 0), 0);
  const shown = open ? rows : rows.slice(0, 6);

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      {!search && (
        <button onClick={onToggle} className="flex w-full items-center gap-2 px-4 py-3 text-left transition hover:bg-surface-2">
          <span className="text-[15px] font-semibold text-ink">{sector}</span>
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-muted">{rows.length}</span>
          <span className="font-mono text-[11px] text-faint">{fmtAum(totAum)}</span>
          <span className="flex-1" />
          {best && best.ret5y != null && (
            <span className="hidden items-center gap-1 text-[11px] sm:flex">
              <span className="text-faint">{t("5年最强", "best 5Y")}</span>
              <span className="font-mono font-semibold text-ink">{best.sym}</span>
              <span className="font-mono font-semibold text-up">+{Math.round(best.ret5y)}%</span>
            </span>
          )}
          {worst && worst.mdd != null && (
            <span className="ml-2 hidden items-center gap-1 text-[11px] sm:flex">
              <span className="text-faint">{t("最深回撤", "worst DD")}</span>
              <span className="font-mono font-semibold text-down">{Math.round(worst.mdd)}%</span>
            </span>
          )}
          <svg className={`h-4 w-4 shrink-0 text-faint transition ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6" /></svg>
        </button>
      )}
      {(open || search) && (
        <div className="border-t border-line/60">
          {/* 列头 */}
          <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-faint sm:px-4">
            <span className="w-5 shrink-0" /><span className="flex-1">{t("代码", "Ticker")}</span>
            <span className="w-12 shrink-0 text-right sm:w-14">{t("规模", "AUM")}</span>
            <span className="w-11 shrink-0 text-right sm:w-12">1Y</span>
            <span className="w-11 shrink-0 text-right sm:w-12">5Y</span>
            <span className="w-12 shrink-0 text-right sm:w-14">{t("回撤", "MaxDD")}</span>
          </div>
          <div className="divide-y divide-line/50">
            {shown.map((e) => <EtfRowItem key={e.sym} e={e} t={t} />)}
          </div>
          {!search && rows.length > 6 && (
            <button onClick={onToggle} className="w-full py-2 text-center text-[11px] font-medium text-accent hover:underline">
              {open ? t("收起", "Collapse") : t(`展开全部 ${rows.length}`, `Show all ${rows.length}`)}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

const DOT: Record<string, string> = { up: "bg-up", neutral: "bg-accent", down: "bg-down" };

function EtfRowItem({ e }: { e: EtfRow; t: (zh: string, en: string) => string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
      <EtfLogo sym={e.sym} />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full sm:hidden ${DOT[e.cls]}`} title={e.verdict} />
        <span className="font-mono text-[13px] font-semibold text-ink">{e.sym}</span>
        <span className={`hidden shrink-0 rounded border px-1 py-px text-[9px] font-medium sm:inline-block ${CLS_TONE[e.cls]}`}>{e.verdict}</span>
        <span className="hidden truncate text-[11px] text-muted sm:block">{e.name}</span>
      </div>
      <span className="w-12 shrink-0 text-right font-mono text-[12px] text-ink sm:w-14">{fmtAum(e.aum)}</span>
      <span className={`w-11 shrink-0 text-right font-mono text-[12px] sm:w-12 ${pctCls(e.ret1y)}`}>{fmtPct(e.ret1y)}</span>
      <span className={`w-11 shrink-0 text-right font-mono text-[12px] sm:w-12 ${pctCls(e.ret5y)}`}>{fmtPct(e.ret5y)}</span>
      <span className={`w-12 shrink-0 text-right font-mono text-[12px] sm:w-14 ${mddCls(e.mdd)}`}>{e.mdd == null ? "—" : `${Math.round(e.mdd)}%`}</span>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-[12px] font-medium transition ${active ? "border-accent/40 bg-accent/10 text-accent" : "border-line bg-surface text-muted hover:text-ink"}`}>
      {children}
    </button>
  );
}
