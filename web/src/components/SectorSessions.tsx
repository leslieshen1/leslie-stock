"use client";

// 板块热力 · 盘前/盘中/盘后三段。每行=一个板块,行高=√市值(量级,最小封底 30px 保可读)。
// 当前时段=实时(随访问刷),已过去的段=定格最后值,还没到的段=空(—)。纯展示,不跳转。
import { useEffect, useState } from "react";

type Row = { sector: string; capB: number; pre: number | null; mid: number | null; post: number | null };
type Resp = { sectors: Row[]; session: string; day: string; isToday: boolean };

const ZH: Record<string, string> = {
  Technology: "科技", Finance: "金融", "Financial Services": "金融", "Health Care": "医疗", Healthcare: "医疗",
  "Consumer Discretionary": "可选消费", "Consumer Staples": "必需消费", "Consumer Cyclical": "可选消费",
  "Consumer Defensive": "必需消费", Industrials: "工业", Energy: "能源", Utilities: "公用事业",
  "Real Estate": "地产", Telecommunications: "通信", "Communication Services": "通信",
  "Basic Materials": "材料", Materials: "材料", Miscellaneous: "其他", Other: "其他",
};

function heat(p: number): { bg: string; fg: string } {
  if (p >= -0.05 && p <= 0.05) return { bg: "hsl(220 6% 27%)", fg: "rgba(255,255,255,.82)" };
  const t = Math.min(1, Math.abs(p) / 3);
  return p < 0
    ? { bg: `hsl(0 ${50 + t * 26}% ${40 - t * 18}%)`, fg: "#fff" }
    : { bg: `hsl(150 ${44 + t * 26}% ${34 - t * 15}%)`, fg: "#fff" };
}
const fp = (p: number) => `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
const fcap = (b: number) => (b >= 1000 ? `$${(b / 1000).toFixed(1)}T` : `$${Math.round(b)}B`);

const COLS: { key: "pre" | "mid" | "post"; label: string }[] = [
  { key: "pre", label: "盘前" },
  { key: "mid", label: "盘中" },
  { key: "post", label: "盘后" },
];

function Cell({ p, live }: { p: number | null; live: boolean }) {
  if (p == null) {
    return <div className="flex items-center justify-center rounded-md border border-dashed border-line/55 text-[12px] text-faint/55">—</div>;
  }
  const c = heat(p);
  return (
    <div
      className={`flex items-center justify-center rounded-md text-[13px] font-medium tnum ${live ? "ring-1 ring-white/35" : ""}`}
      style={{ background: c.bg, color: c.fg }}
    >
      {fp(p)}
    </div>
  );
}

export default function SectorSessions() {
  const [data, setData] = useState<Resp | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/sector-sessions")
        .then((r) => r.json())
        .then((j) => { if (alive) setData(j); })
        .catch(() => { if (alive) setData({ sectors: [], session: "", day: "", isToday: false }); });
    load();
    const id = setInterval(load, 60_000); // 每分钟跟实时刷
    return () => { alive = false; clearInterval(id); };
  }, []);

  const rows = data?.sectors || null;
  const session = data?.session || "";
  const sqrtSum = rows?.reduce((s, r) => s + Math.sqrt(Math.max(1, r.capB)), 0) || 1;

  return (
    <section className="mt-8">
      <header className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-ink">板块热力</h2>
        {session && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${session === "休市" ? "bg-surface-2 text-faint" : "bg-up-soft text-up"}`}>
            {data?.isToday ? `当前 · ${session}` : `上一交易日 ${data?.day || ""}`}
          </span>
        )}
        <span className="text-xs text-faint">行高=市值 · 颜色=涨跌 · 当前段实时·过去段定格</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-faint">
          {[-3, -1, 0, 1, 3].map((v) => <i key={v} className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: heat(v).bg }} />)}
          <span className="ml-1">−3% → +3%</span>
        </span>
      </header>

      <div className="overflow-hidden rounded-2xl border border-line bg-base/40 p-2">
        {/* 列头 */}
        <div className="mb-1 grid grid-cols-[minmax(104px,168px)_1fr_1fr_1fr] gap-1 px-1 text-[11px] text-faint">
          <span className="pl-1">板块 · 市值</span>
          {COLS.map((c) => (
            <span key={c.key} className={`flex items-center justify-center gap-1 ${session === c.label ? "font-medium text-up" : ""}`}>
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
              const h = Math.max(30, Math.round((Math.sqrt(Math.max(1, r.capB)) / sqrtSum) * 470));
              return (
                <div
                  key={r.sector}
                  className="grid grid-cols-[minmax(104px,168px)_1fr_1fr_1fr] gap-1"
                  style={{ height: h }}
                  title={`${ZH[r.sector] || r.sector} · ${fcap(r.capB)}`}
                >
                  <div className="flex flex-col justify-center overflow-hidden rounded-md bg-surface px-2.5">
                    <span className="truncate text-[13px] leading-tight text-ink">{ZH[r.sector] || r.sector}</span>
                    <span className="text-[11px] leading-tight text-faint tnum">{fcap(r.capB)}</span>
                  </div>
                  <Cell p={r.pre} live={session === "盘前"} />
                  <Cell p={r.mid} live={session === "盘中"} />
                  <Cell p={r.post} live={session === "盘后"} />
                </div>
              );
            })}
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-faint">
        市值加权 · 当前时段随访问实时刷新,已过去时段定格在收段值,未到时段留空 · 板块按 GICS · 非投资建议
      </p>
    </section>
  );
}
