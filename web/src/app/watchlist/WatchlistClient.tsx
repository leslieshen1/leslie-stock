"use client";

// 观察列表 —— 统一五方评分(美股=五方均分,A股=Serenity 瓶颈分;取不到显示 —,绝不显示死值 0)
// + 全市场实时报价(美股 Nasdaq / A股·港股 Yahoo,经 /api/quote 批量,30s 轮询,变价闪烁)。

import Link from "next/link";
import AiPersonaNote from "@/components/AiPersonaNote";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWatchlist, type LocalWatchEntry } from "@/lib/useWatchlist";
import { useLang } from "@/lib/i18n";

type SortKey = "added" | "score" | "mcap";
type PanelSummary = { order: string[]; stocks: Record<string, { sc: (number | null)[]; div: number }> };
type Quote = { price: number; pct: number | null; session?: string };

// /api/quote 的代码口径:美股纯代码;A股 6 开头 .SS 其余 .SZ;港股 .HK;韩股 .KS
function quoteSym(w: LocalWatchEntry): string {
  if (w.market === "a") return `${w.code}.${w.code.startsWith("6") ? "SS" : "SZ"}`;
  if (w.market === "hk") return `${w.code}.HK`;
  if (w.market === "kr") return `${w.code}.KS`;
  return w.code;
}

export default function WatchlistClient() {
  const { items, ready, remove } = useWatchlist();
  const { t, lang } = useLang();
  const [sortBy, setSortBy] = useState<SortKey>("added");
  const [panels, setPanels] = useState<PanelSummary>({ order: [], stocks: {} });
  const [aPanels, setAPanels] = useState<PanelSummary>({ order: [], stocks: {} });
  const [blurbs, setBlurbs] = useState<Record<string, string>>({});
  const [aBlurbs, setABlurbs] = useState<Record<string, string>>({});
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  const prev = useRef<Record<string, number>>({});

  // 五方摘要 + 一句话分歧线,按观察列表里实际有哪些市场懒加载(blurbs 单文件 ~900KB,没该市场的票就别拉)
  const marketKey = useMemo(() => [...new Set(items.map((w) => w.market))].sort().join(","), [items]);
  useEffect(() => {
    if (marketKey.includes("us")) {
      fetch("/data/us-panel-summary.json").then((r) => r.json()).then(setPanels).catch(() => {});
      fetch("/data/us-blurbs.json").then((r) => r.json()).then(setBlurbs).catch(() => {});
    }
    if (marketKey.includes("a")) {
      // A股和美股同源同构:五方摘要让评分实时查(不再只靠加入时存的死分)+ 分歧线一句话补进描述
      fetch("/data/a-panel-summary.json").then((r) => r.json()).then(setAPanels).catch(() => {});
      fetch("/data/a-blurbs.json").then((r) => r.json()).then(setABlurbs).catch(() => {});
    }
  }, [marketKey]);

  // 实时报价:30s 轮询,后台标签自动停
  const symMap = useMemo(() => items.map((w) => ({ key: `${w.code}-${w.market}`, sym: quoteSym(w) })), [items]);
  useEffect(() => {
    if (!symMap.length) return;
    let stop = false;
    async function poll() {
      if (document.hidden) return;
      const syms = symMap.map((s) => s.sym);
      const merged: Record<string, Quote> = {};
      for (let i = 0; i < syms.length; i += 25) {
        try {
          const r = await fetch(`/api/quote?syms=${syms.slice(i, i + 25).join(",")}`, { cache: "no-store" });
          Object.assign(merged, (await r.json()).quotes || {});
        } catch { /* 单批失败不阻塞 */ }
      }
      if (stop || !Object.keys(merged).length) return;
      const fl: Record<string, "up" | "down"> = {};
      for (const [sym, q] of Object.entries(merged)) {
        const p0 = prev.current[sym];
        if (p0 != null && q.price !== p0) fl[sym] = q.price > p0 ? "up" : "down";
        prev.current[sym] = q.price;
      }
      setQuotes((o) => ({ ...o, ...merged }));
      if (Object.keys(fl).length) {
        setFlash(fl);
        setTimeout(() => setFlash({}), 1100);
      }
    }
    poll();
    const id = setInterval(poll, 30_000);
    return () => { stop = true; clearInterval(id); };
  }, [symMap]);

  // 统一评分:美股/A股 → 各自 panel-summary 的五方均分(实时、同口径);取不到再回退加入时存的分;都没有 → null(显示 —,绝不显示死值 0)
  const unified = useMemo(() => {
    const avg = (p?: { sc: (number | null)[] }) => {
      const xs = (p?.sc ?? []).filter((x): x is number => typeof x === "number");
      return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
    };
    const stored = (w: LocalWatchEntry) =>
      typeof w.score === "number" && w.score > 0 ? { label: "Serenity", labelEn: "Serenity", value: w.score } : null;
    const m: Record<string, { label: string; labelEn: string; value: number } | null> = {};
    for (const w of items) {
      const key = `${w.code}-${w.market}`;
      const summary = w.market === "us" ? panels : w.market === "a" ? aPanels : null;
      const v = summary ? avg(summary.stocks[w.code]) : null;
      m[key] = v != null ? { label: "五方均分", labelEn: "Panel avg", value: v } : stored(w);
    }
    return m;
  }, [items, panels, aPanels]);

  if (!ready) {
    return (
      <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-faint">{t("加载中…", "Loading…")}</div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line-2 bg-surface p-16 text-center">
        <p className="mb-3 text-lg text-muted">{t("观察列表为空", "Your watchlist is empty")}</p>
        <p className="text-sm text-muted">
          {t("去", "Open the")}{" "}
          <Link href="/scan" className="font-medium text-accent hover:underline">{t("全市场扫描", "market scanner")}</Link>{" "}
          {t("找感兴趣的标的,点 ☆ 加入。", "and hit ☆ on anything interesting.")}
        </p>
      </div>
    );
  }

  const sorted = [...items].sort((a, b) => {
    if (sortBy === "added") return b.added_at.localeCompare(a.added_at);
    if (sortBy === "score")
      return (unified[`${b.code}-${b.market}`]?.value ?? -1) - (unified[`${a.code}-${a.market}`]?.value ?? -1);
    if (sortBy === "mcap") return (b.market_cap_yi ?? 0) - (a.market_cap_yi ?? 0);
    return 0;
  });

  const liveOn = Object.keys(quotes).length > 0;

  return (
    <>
      <AiPersonaNote className="mb-4" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs text-muted">
          <span className="font-mono font-semibold text-ink">{items.length}</span> {t("只跟踪中", "tracked")}
          {liveOn && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-up/30 bg-up-soft px-2 py-0.5 text-[10px] font-semibold text-up">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              {t("实时", "Live")} · 30s
            </span>
          )}
        </p>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="rounded-lg border border-line px-3 py-1.5 text-sm"
        >
          <option value="added">{t("按加入时间", "By date added")}</option>
          <option value="score">{t("按评分(五方均分 / Serenity)", "By score (panel avg / Serenity)")}</option>
          <option value="mcap">{t("按市值", "By market cap")}</option>
        </select>
      </div>

      <div className="space-y-2">
        {sorted.map((w) => {
          const key = `${w.code}-${w.market}`;
          return (
            <Row key={key} item={w} onRemove={remove} score={unified[key] ?? null}
                 blurb={w.market === "us" ? blurbs[w.code] : w.market === "a" ? aBlurbs[w.code] : undefined}
                 quote={quotes[quoteSym(w).toUpperCase()]} flash={flash[quoteSym(w).toUpperCase()]} lang={lang} t={t} />
          );
        })}
      </div>
    </>
  );
}

function Row({
  item: w, onRemove, score, blurb, quote, flash, lang, t,
}: {
  item: LocalWatchEntry;
  onRemove: (code: string, market: string) => void;
  score: { label: string; labelEn: string; value: number } | null;
  blurb?: string;
  quote?: Quote;
  flash?: "up" | "down";
  lang: "zh" | "en";
  t: (zh: string, en: string) => string;
}) {
  const desc = w.thesis || blurb;
  const marketLabel = w.market === "a" ? t("A股", "A-share") : w.market === "hk" ? t("港股", "HK") : t("美股", "US");
  const marketColor = w.market === "a" ? "text-down" : "text-accent";
  const flCls = flash === "up" ? "bg-up-soft" : flash === "down" ? "bg-down-soft" : "";

  function handleRemove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (confirm(t(`从观察列表移除 ${w.name} (${w.code})?`, `Remove ${w.name} (${w.code}) from watchlist?`))) {
      onRemove(w.code, w.market);
    }
  }

  return (
    <div className="group flex items-center rounded-lg border border-line bg-surface transition hover:border-line-2">
      <Link href={`/stock/${w.code}?market=${w.market}`} className="block min-w-0 flex-1 px-4 py-3">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h3 className="truncate text-sm font-semibold text-ink">{w.name}</h3>
              <span className="font-mono text-xs text-faint">{w.code}</span>
              <span className={`text-[10px] font-medium ${marketColor}`}>{marketLabel}</span>
              {w.layer && <span className="text-[10px] text-muted">L{w.layer}</span>}
              {/* 实时价:有报价就显示,变价闪烁 */}
              {quote && (
                <span className={`ml-1 inline-flex items-baseline gap-1.5 font-mono text-xs tabular-nums transition-colors duration-700 ${flCls}`}>
                  <span className="text-ink">{w.market === "us" ? "$" : ""}{quote.price.toFixed(2)}</span>
                  {quote.pct != null && (
                    <span className={`font-semibold ${quote.pct >= 0 ? "text-up" : "text-down"}`}>
                      {quote.pct >= 0 ? "+" : ""}{quote.pct.toFixed(2)}%
                    </span>
                  )}
                  {quote.session === "pre" && <span className="text-[9px] text-faint">{t("盘前", "pre")}</span>}
                  {quote.session === "post" && <span className="text-[9px] text-faint">{t("盘后", "post")}</span>}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
              {w.market_cap_yi && <span className="font-mono">{lang === "zh" ? `${w.market_cap_yi.toFixed(0)} 亿` : `${(w.market_cap_yi / 10).toFixed(1)}B`}</span>}
              {w.sector && (<><span className="text-faint">·</span><span className="truncate">{w.sector}</span></>)}
              {w.verdict_label && (<><span className="text-faint">·</span><span className="text-accent">{w.verdict_label}</span></>)}
              <span className="text-faint">·</span>
              <span className="text-faint">{t("加入于", "added")} {w.added_at.slice(0, 10)}</span>
            </div>
            {desc && (
              <p className="mt-1 truncate text-[11px] text-muted group-hover:whitespace-normal group-hover:text-ink">{desc}</p>
            )}
          </div>

          {/* 统一评分:五方均分(美股)/ Serenity(A股);取不到 = 不渲染,绝不显示 0 */}
          {score ? (
            <div className="shrink-0 text-right">
              <p className="text-[9px] uppercase tracking-wider text-accent">{lang === "zh" ? score.label : score.labelEn}</p>
              <p className={`font-mono text-lg font-semibold tabular-nums ${scoreColor(score.value)}`}>{score.value}</p>
            </div>
          ) : (
            <div className="shrink-0 text-right" title={t("还没有五方判读", "Not scored by the panel yet")}>
              <p className="text-[9px] uppercase tracking-wider text-faint">{t("五方", "Panel")}</p>
              <p className="font-mono text-lg font-semibold text-faint">—</p>
            </div>
          )}
        </div>
      </Link>

      <button
        onClick={handleRemove}
        title={t("从观察列表移除", "Remove from watchlist")}
        aria-label={t("从观察列表移除", "Remove from watchlist")}
        className="mr-2 shrink-0 rounded px-3 py-2 text-faint transition hover:bg-down-soft hover:text-down"
      >
        ✕
      </button>
    </div>
  );
}

function scoreColor(score: number): string {
  if (score >= 65) return "text-up";
  if (score >= 50) return "text-accent";
  if (score >= 30) return "text-muted";
  return "text-faint";
}
