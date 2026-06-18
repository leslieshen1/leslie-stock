"use client";

// finviz 式方块热力图:前 N 大,按板块分组,方块大小=市值,颜色=当日涨跌。
// 默认美股;可切 A 股。d3 squarified treemap;数据走 /api/heatmap(服务端精简)。点方块 → 个股详情。
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from "d3-hierarchy";
import { useLang } from "@/lib/i18n";

type Slim = { sym: string; name: string; mcapB: number; pct: number; sector: string };
type Market = "us" | "a";

// finviz 配色:负=红、平=灰、正=绿,越极端越深
function tileColor(pct: number): string {
  if (pct >= -0.05 && pct <= 0.05) return "hsl(220 6% 27%)";
  const t = Math.min(1, Math.abs(pct) / 3);
  return pct < 0 ? `hsl(0 ${48 + t * 28}% ${34 - t * 16}%)` : `hsl(150 ${42 + t * 28}% ${30 - t * 13}%)`;
}
const fmtPct = (p: number) => `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;

export default function HeatmapTreemap() {
  const { t, lang } = useLang();
  const mLabel = (m: Market) => (m === "a" ? t("A股", "A-share") : t("美股", "US"));
  const [market, setMarket] = useState<Market>("us");
  const [data, setData] = useState<Slim[] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);

  useEffect(() => {
    let alive = true;
    setData(null);
    fetch(`/api/heatmap?market=${market}&n=160`)
      .then((r) => r.json())
      .then((j) => { if (alive) setData(j.stocks || []); })
      .catch(() => { if (alive) setData([]); });
    return () => { alive = false; };
  }, [market]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver((e) => setW(Math.round(e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fmtCap = (b: number) => (market === "a" ? `¥${Math.round(b)}亿` : b >= 1000 ? `$${(b / 1000).toFixed(2)}T` : `$${Math.round(b)}B`);

  const layout = useMemo(() => {
    if (!data || data.length === 0 || w < 50) return null;
    const bySector = new Map<string, Slim[]>();
    for (const s of data) {
      const arr = bySector.get(s.sector);
      if (arr) arr.push(s);
      else bySector.set(s.sector, [s]);
    }
    const H = Math.round(Math.min(720, Math.max(420, w * 0.5)));
    const root = treemap<{ sector?: string; mcapB?: number } | Slim>()
      .size([w, H])
      .paddingTop(15)
      .paddingInner(1)
      .round(true)
      .tile(treemapSquarify)(
      hierarchy<{ sector?: string; children?: unknown[]; mcapB?: number }>({
        children: [...bySector.entries()].map(([sector, items]) => ({ sector, children: items })),
      })
        .sum((d) => (d as { mcapB?: number }).mcapB || 0)
        .sort((a, b) => (b.value || 0) - (a.value || 0)),
    ) as unknown as HierarchyRectangularNode<{ sector?: string } & Slim>;
    return { root, H };
  }, [data, w]);

  return (
    <section className="mt-8">
      <header className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-ink">{lang === "en" ? `${mLabel(market)} Heatmap` : `${mLabel(market)}热力图`}</h2>
        {/* 市场切换 */}
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-[12px]">
          {(["us", "a"] as Market[]).map((m) => (
            <button key={m} onClick={() => setMarket(m)}
              className={`rounded-md px-2.5 py-1 transition ${market === m ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink"}`}>
              {mLabel(m)}
            </button>
          ))}
        </div>
        <span className="text-xs text-faint">{lang === "en" ? `Top ${data?.length || 160} · size=cap · color=daily change · click for detail` : `前 ${data?.length || 160} 大 · 方块=市值 · 颜色=当日涨跌 · 点进详情`}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-faint">
          {[-3, -1, 0, 1, 3].map((v) => <i key={v} className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: tileColor(v) }} />)}
          <span className="ml-1">−3% → +3%</span>
        </span>
      </header>

      <div ref={wrapRef} className="relative w-full overflow-hidden rounded-2xl border border-line bg-base/40">
        {!data ? (
          <div className="flex h-[420px] items-center justify-center text-sm text-faint">{lang === "en" ? `Loading ${mLabel(market)} heatmap…` : `加载${mLabel(market)}热力图…`}</div>
        ) : data.length === 0 ? (
          <div className="flex h-[420px] items-center justify-center text-sm text-faint">{t("暂无数据", "No data")}</div>
        ) : layout ? (
          <div className="relative" style={{ height: layout.H }}>
            {layout.root.children?.map((sec) => {
              const tw = sec.x1 - sec.x0;
              if (tw < 56) return null;
              return (
                <div key={(sec.data as { sector?: string }).sector}
                  className="pointer-events-none absolute truncate px-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/50"
                  style={{ left: sec.x0, top: sec.y0, width: tw, height: 15, lineHeight: "15px" }}>
                  {(sec.data as { sector?: string }).sector}
                </div>
              );
            })}
            {layout.root.leaves().map((lf) => {
              const d = lf.data as Slim;
              const tw = lf.x1 - lf.x0;
              const th = lf.y1 - lf.y0;
              if (tw < 2 || th < 2) return null;
              const showText = tw >= 36 && th >= 22;
              const fs = Math.max(8, Math.min(22, Math.min(tw / 3.4, th / 2.3)));
              const label = market === "a" ? d.name : d.sym;
              return (
                <Link key={d.sym} href={`/stock/${d.sym}?market=${market}`} prefetch={false}
                  title={`${d.name} · ${fmtCap(d.mcapB)} · ${fmtPct(d.pct)}`}
                  className="absolute flex flex-col items-center justify-center overflow-hidden text-center leading-none text-white/95 transition hover:z-10 hover:brightness-125 hover:ring-1 hover:ring-white/50"
                  style={{ left: lf.x0, top: lf.y0, width: tw, height: th, background: tileColor(d.pct) }}>
                  {showText && (
                    <>
                      <span className="max-w-full truncate px-0.5 font-semibold" style={{ fontSize: market === "a" ? Math.min(fs, 15) : fs }}>{label}</span>
                      {th >= 38 && <span className="opacity-80" style={{ fontSize: fs * 0.64 }}>{fmtPct(d.pct)}</span>}
                    </>
                  )}
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="h-[420px]" />
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-faint">
        {market === "a"
          ? t("A股 · 行业静态 + 腾讯实时市值/涨跌", "A-share · static industry + Tencent live cap/change")
          : t("美股 · 最近收盘/刷新 · 板块按 GICS", "US · latest close/refresh · GICS sectors")}
        {t(" · 非投资建议", " · not financial advice")}
      </p>
    </section>
  );
}
