"use client";

import { useEffect, useMemo, useState } from "react";
import { useLang } from "@/lib/i18n";
import { type EtfData, type EtfRow, KINDS, CLS_TONE } from "@/lib/etf-types";

function EtfLogo({ sym }: { sym: string }) {
  const [bad, setBad] = useState(false);
  if (bad || !sym)
    return <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[10px] font-bold text-accent">{sym.slice(0, 2)}</span>;
  return <img src={`https://assets.parqet.com/logos/symbol/${sym}?format=png&size=44`} alt={sym}
    onError={() => setBad(true)} className="h-7 w-7 shrink-0 rounded-full border border-line bg-white object-cover" />;
}

function fmtAum(k: number | null, lang: string): string {
  if (!k) return "—";
  const usd = k * 1000;
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(usd >= 1e10 ? 0 : 1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  return `$${(usd / 1e3).toFixed(0)}K`;
}
function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export default function EtfClient() {
  const { t, lang } = useLang();
  const [data, setData] = useState<EtfData | null>(null);
  const [kind, setKind] = useState<string>("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(120);

  useEffect(() => {
    fetch("/data/etf-analyses.json").then((r) => r.json()).then(setData).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const qq = q.trim().toUpperCase();
    return data.etfs.filter((e) => {
      if (kind !== "all" && e.kind !== kind) return false;
      if (qq && !e.sym.includes(qq) && !e.name.toUpperCase().includes(qq)) return false;
      return true;
    });
  }, [data, kind, q]);

  // 判决摘要(段永平/巴菲特镜头的四种立场)
  const summary = useMemo(() => {
    if (!data) return null;
    const by = (pred: (e: EtfRow) => boolean) => data.etfs.filter(pred).length;
    return {
      index: by((e) => e.verdict.includes("指数定投") || e.verdict.includes("可长持")),
      allocate: by((e) => e.cls === "neutral" && (e.kind === "债券" || e.kind === "商品")),
      timing: by((e) => e.verdict.includes("择时") || e.verdict.includes("策略")),
      gamble: by((e) => e.cls === "down"),
    };
  }, [data]);

  useEffect(() => setLimit(120), [kind, q]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{t("ETF · 段永平/巴菲特镜头", "ETFs · Buffett / Duan lens")}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          {t(
            "ETF 是篮子不是生意,五位价投不直接打分。换个问法:这只值不值得长持?巴菲特一辈子只推荐普通人买一种——低费率宽基指数。其余都是择时押注、配置工具,或纯赌场(杠杆/反向)。看清你买的到底是什么。",
            "An ETF is a basket, not a business — so the five masters don't score it. Different question: is it worth holding for the long run? Buffett only ever recommended one thing for ordinary people — a low-cost broad index. Everything else is a timing bet, an allocation tool, or a casino chip (leveraged/inverse).",
          )}
        </p>
      </header>

      {summary && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label={t("指数定投友好", "Index, hold")} value={summary.index} tone="up" hint={t("低费率宽基", "low-cost broad")} />
          <Stat label={t("配置/避险", "Allocation")} value={summary.allocate} tone="neutral" hint={t("债/商品", "bond/commodity")} />
          <Stat label={t("择时押注", "Timing bets")} value={summary.timing} tone="neutral" hint={t("行业/主题/策略", "sector/theme")} />
          <Stat label={t("投机工具", "Casino chips")} value={summary.gamble} tone="down" hint={t("杠杆/反向", "leveraged/inverse")} />
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={t("搜代码 / 名称…", "Search ticker / name…")}
          className="w-full max-w-xs rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus:border-accent/50" />
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Chip active={kind === "all"} onClick={() => setKind("all")}>{t("全部", "All")}{data ? ` ${data.n}` : ""}</Chip>
          {KINDS.map((k) => (
            <Chip key={k.key} active={kind === k.key} onClick={() => setKind(k.key)}>
              {t(k.zh, k.en)}{data?.kinds[k.key] ? ` ${data.kinds[k.key]}` : ""}
            </Chip>
          ))}
        </div>
      </div>

      {!data && <p className="py-10 text-center text-sm text-faint">{t("加载中…", "Loading…")}</p>}

      <div className="divide-y divide-line/60 overflow-hidden rounded-xl border border-line bg-surface">
        {filtered.slice(0, limit).map((e) => <EtfRowItem key={e.sym} e={e} lang={lang} t={t} />)}
        {data && filtered.length === 0 && <p className="px-4 py-8 text-center text-sm text-faint">{t("无匹配", "No match")}</p>}
      </div>
      {filtered.length > limit && (
        <button onClick={() => setLimit((n) => n + 200)}
          className="mx-auto block rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-muted transition hover:text-ink">
          {t(`展开更多(还有 ${filtered.length - limit})`, `Show more (${filtered.length - limit} more)`)}
        </button>
      )}

      <p className="text-center text-[11px] leading-relaxed text-faint">
        {t(
          `数据 = Nasdaq(AUM/费率/beta,逐只)。共 ${data?.n ?? "—"} 只 ETF,按 AUM 排序。判决是段永平/巴菲特方法论的机械映射(费率+类型),不是个股式五方判读 · 不生息的商品、杠杆/反向是工具不是投资 · 非投资建议。`,
          `Data = Nasdaq (AUM / expense / beta, per fund). ${data?.n ?? "—"} ETFs by AUM. Verdicts are a mechanical mapping of Buffett/Duan principles (cost + type), not a per-business five-master read · not financial advice.`,
        )}
      </p>
    </div>
  );
}

function EtfRowItem({ e, lang, t }: { e: EtfRow; lang: string; t: (zh: string, en: string) => string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
      <EtfLogo sym={e.sym} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-semibold text-ink">{e.sym}</span>
          <span className={`shrink-0 rounded border px-1 py-0.5 text-[9px] font-medium ${CLS_TONE[e.cls]}`}>{e.verdict}</span>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted">{e.name}</div>
        <div className="mt-1 text-[11px] leading-snug text-faint">{e.thesis || e.why}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-[13px] font-semibold text-ink">{fmtAum(e.aum, lang)}</div>
        <div className="mt-0.5 flex items-center justify-end gap-1.5 font-mono text-[10px] text-faint">
          <span>{e.expense != null ? `${e.expense}%` : "—"}</span>
          <span className="text-line">·</span>
          <span className={e.ret1y != null && e.ret1y >= 0 ? "text-up" : "text-down"}>{fmtPct(e.ret1y)} 1y</span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: number; tone: "up" | "neutral" | "down"; hint: string }) {
  const c = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-accent";
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="text-[10px] text-faint">{label}</div>
      <div className={`tnum mt-0.5 text-lg font-semibold ${c}`}>{value}</div>
      <div className="text-[9px] text-faint">{hint}</div>
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
