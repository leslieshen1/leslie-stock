"use client";

// 板块热力 · 盘前/盘中/盘后。顶层=大板块(~12),行高=√市值(量级,封顶防独大)。
// 只渲染「有数据的时段」列(空列不画,免大片留白)。「科技」等可就地展开看子板块(不跳转)。
import { Fragment, useEffect, useState } from "react";

type SKey = "pre" | "mid" | "post";
type Row = { sector: string; capB: number; pre: number | null; mid: number | null; post: number | null; subs?: Row[] };
type Resp = { sectors: Row[]; session: string; day: string; isToday: boolean };

const SKEYS: { k: SKey; label: string }[] = [{ k: "pre", label: "盘前" }, { k: "mid", label: "盘中" }, { k: "post", label: "盘后" }];

function heat(p: number): { bg: string; fg: string } {
  if (p >= -0.05 && p <= 0.05) return { bg: "hsl(220 6% 27%)", fg: "rgba(255,255,255,.82)" };
  const t = Math.min(1, Math.abs(p) / 3);
  return p < 0
    ? { bg: `hsl(0 ${50 + t * 26}% ${40 - t * 18}%)`, fg: "#fff" }
    : { bg: `hsl(150 ${44 + t * 26}% ${34 - t * 15}%)`, fg: "#fff" };
}
const fp = (p: number) => `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
const fcap = (b: number) => (b >= 1000 ? `$${(b / 1000).toFixed(1)}T` : `$${Math.round(b)}B`);

function Cell({ p, live }: { p: number | null; live: boolean }) {
  if (p == null) return <div className="flex items-center justify-center rounded-md border border-dashed border-line/40 text-[12px] text-faint/45">—</div>;
  const c = heat(p);
  return (
    <div className={`flex items-center justify-center rounded-md text-[13px] font-medium tnum ${live ? "ring-1 ring-white/30" : ""}`} style={{ background: c.bg, color: c.fg }}>
      {fp(p)}
    </div>
  );
}

export default function SectorSessions() {
  const [data, setData] = useState<Resp | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/sector-sessions").then((r) => r.json())
        .then((j) => { if (alive) setData(j); })
        .catch(() => { if (alive) setData({ sectors: [], session: "", day: "", isToday: false }); });
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const rows = data?.sectors || null;
  const session = data?.session || "";
  const sqrtSum = rows?.reduce((s, r) => s + Math.sqrt(Math.max(1, r.capB)), 0) || 1;

  // 盘前/盘中/盘后三段恒显示;有数据的时段宽(1fr),空时段做细列(56px)——保留三段结构又不留大白带
  const dataKeys = new Set(
    SKEYS.filter((c) => rows?.some((r) => r[c.k] != null || r.subs?.some((s) => s[c.k] != null))).map((c) => c.k),
  );
  const allEmpty = dataKeys.size === 0;
  const gridCols = `minmax(82px,108px) ${SKEYS.map((c) => (allEmpty || dataKeys.has(c.k) ? "minmax(0,1fr)" : "52px")).join(" ")}`;

  return (
    <section className="mt-8">
      <header className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-ink">板块热力</h2>
        {session && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${session === "休市" ? "bg-surface-2 text-faint" : "bg-up-soft text-up"}`}>
            {data?.isToday ? `当前 · ${session}` : `上一交易日 ${data?.day || ""}`}
          </span>
        )}
        <span className="text-xs text-faint">行高=市值 · 颜色=涨跌 · 点带 ▸ 的板块展开细分</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-faint">
          {[-3, -1, 0, 1, 3].map((v) => <i key={v} className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: heat(v).bg }} />)}
          <span className="ml-1">−3% → +3%</span>
        </span>
      </header>

      <div className="overflow-hidden rounded-2xl border border-line bg-base/40 p-2">
        <div className="mb-1 grid gap-1 px-1 text-[11px] text-faint" style={{ gridTemplateColumns: gridCols }}>
          <span className="pl-1">板块 · 市值</span>
          {SKEYS.map((c) => (
            <span key={c.k} className={`flex items-center justify-center gap-1 ${session === c.label ? "font-medium text-up" : ""}`}>
              {session === c.label && <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-up" />}
              {c.label}
            </span>
          ))}
        </div>

        {!rows ? (
          <div className="flex h-[360px] items-center justify-center text-sm text-faint">加载板块…</div>
        ) : rows.length === 0 ? (
          <div className="flex h-[360px] items-center justify-center text-sm text-faint">暂无数据</div>
        ) : (
          <div className="flex flex-col gap-1">
            {rows.map((r) => {
              const h = Math.min(108, Math.max(30, Math.round((Math.sqrt(Math.max(1, r.capB)) / sqrtSum) * 640)));
              const expandable = !!(r.subs && r.subs.length);
              const isOpen = expandable && open[r.sector];
              const subSqrt = r.subs?.reduce((s, x) => s + Math.sqrt(Math.max(1, x.capB)), 0) || 1;
              return (
                <Fragment key={r.sector}>
                  <div className="grid gap-1" style={{ gridTemplateColumns: gridCols, height: h }} title={`${r.sector} · ${fcap(r.capB)}`}>
                    <button
                      type="button"
                      disabled={!expandable}
                      onClick={() => setOpen((o) => ({ ...o, [r.sector]: !o[r.sector] }))}
                      className={`flex flex-col justify-center overflow-hidden rounded-md bg-surface px-2.5 text-left ${expandable ? "cursor-pointer hover:bg-surface-2" : ""}`}
                    >
                      <span className="flex items-center gap-1 text-[13px] leading-tight text-ink">
                        {expandable && <span className="text-[11px] text-up">{isOpen ? "▾" : "▸"}</span>}
                        <span className="truncate">{r.sector}</span>
                      </span>
                      <span className="text-[11px] leading-tight text-faint tnum">{fcap(r.capB)}</span>
                    </button>
                    {SKEYS.map((c) => <Cell key={c.k} p={r[c.k]} live={session === c.label} />)}
                  </div>

                  {isOpen && r.subs!.map((sub) => {
                    const sh = Math.min(52, Math.max(26, Math.round((Math.sqrt(Math.max(1, sub.capB)) / subSqrt) * 280)));
                    return (
                      <div key={sub.sector} className="grid gap-1 pl-3" style={{ gridTemplateColumns: gridCols, height: sh }} title={`${sub.sector} · ${fcap(sub.capB)}`}>
                        <div className="flex flex-col justify-center overflow-hidden rounded-md border-l-2 border-up/40 bg-surface/50 px-2">
                          <span className="truncate text-[12px] leading-tight text-ink/90">{sub.sector}</span>
                          <span className="text-[10px] leading-tight text-faint tnum">{fcap(sub.capB)}</span>
                        </div>
                        {SKEYS.map((c) => <Cell key={c.k} p={sub[c.k]} live={session === c.label} />)}
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-faint">
        市值加权 · 盘前/盘中/盘后三段(当前段实时·过去段定格·无数据段留空) · 点 ▸ 展开子板块 · 全部美股上市票 · 非投资建议
      </p>
    </section>
  );
}
