"use client";

// 板块图:每行=一个板块,行高=√市值(量级,最小封底 30px 保可读),颜色=涨跌。
// 诚实:三段(盘前/盘中/盘后)只在「当天真有快照」时才显示;没快照就只给一列「最近收盘」,不冒充。
import { useEffect, useState } from "react";
import Link from "next/link";

type Row = { sector: string; capB: number; mid: number | null; pre: number | null; post: number | null };

const ZH: Record<string, string> = {
  Technology: "科技", Finance: "金融", "Financial Services": "金融", "Health Care": "医疗", Healthcare: "医疗",
  "Consumer Discretionary": "可选消费", "Consumer Staples": "必需消费", "Consumer Cyclical": "可选消费",
  "Consumer Defensive": "必需消费", Industrials: "工业", Energy: "能源", Utilities: "公用事业",
  "Real Estate": "地产", Telecommunications: "通信", "Communication Services": "通信",
  "Basic Materials": "材料", Materials: "材料", Miscellaneous: "其他", Other: "其他",
};

function heat(p: number | null): { bg: string; fg: string } {
  if (p == null) return { bg: "transparent", fg: "#6b7280" };
  if (p >= -0.05 && p <= 0.05) return { bg: "hsl(220 6% 27%)", fg: "rgba(255,255,255,.8)" };
  const t = Math.min(1, Math.abs(p) / 3);
  return p < 0 ? { bg: `hsl(0 ${50 + t * 26}% ${40 - t * 18}%)`, fg: "#fff" } : { bg: `hsl(150 ${44 + t * 26}% ${34 - t * 15}%)`, fg: "#fff" };
}
const fp = (p: number | null) => (p == null ? "—" : `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`);
const fcap = (b: number) => (b >= 1000 ? `$${(b / 1000).toFixed(1)}T` : `$${Math.round(b)}B`);

export default function SectorSessions() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/sector-sessions").then((r) => r.json()).then((j) => setRows(j.sectors || [])).catch(() => setRows([]));
  }, []);

  const hasSnap = !!rows?.some((r) => r.pre != null || r.post != null);
  const sqrtSum = rows?.reduce((s, r) => s + Math.sqrt(Math.max(1, r.capB)), 0) || 1;
  // 真有快照 → 三段;否则只给一列「最近收盘」(不冒充盘中)
  const cols: { key: "pre" | "mid" | "post"; label: string }[] = hasSnap
    ? [{ key: "pre", label: "盘前" }, { key: "mid", label: "盘中" }, { key: "post", label: "盘后" }]
    : [{ key: "mid", label: "最近收盘" }];
  const gridCols = `minmax(150px,200px) repeat(${cols.length}, 1fr)`;

  return (
    <section className="mt-8">
      <header className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-ink">板块{hasSnap ? " · 一日三段" : "热力"}</h2>
        <span className="text-xs text-faint">
          美股 · 行高=市值 · 颜色=涨跌{hasSnap ? " · 盘前→盘中→盘后看轮动" : ""} · 点板块进扫描
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-faint">
          {[-3, -1, 0, 1, 3].map((v) => <i key={v} className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: heat(v).bg }} />)}
          <span className="ml-1">−3% → +3%</span>
        </span>
      </header>

      <div className="overflow-hidden rounded-2xl border border-line bg-base/40 p-2">
        <div className="mb-1 grid gap-1 px-1 text-[11px] text-faint" style={{ gridTemplateColumns: gridCols }}>
          <span className="pl-1">板块 · 市值</span>
          {cols.map((c) => <span key={c.key} className="text-center">{c.label}</span>)}
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
                <Link
                  key={r.sector}
                  href={`/scan?market=us`}
                  prefetch={false}
                  className="grid gap-1 transition hover:brightness-110"
                  style={{ height: h, gridTemplateColumns: gridCols }}
                  title={`${ZH[r.sector] || r.sector} · ${fcap(r.capB)} · ${fp(r.mid)}`}
                >
                  <div className="flex items-center justify-between gap-2 overflow-hidden rounded-md bg-surface px-2.5">
                    <span className="truncate text-[13px] text-ink">{ZH[r.sector] || r.sector}</span>
                    <span className="shrink-0 text-[12px] text-faint tnum">{fcap(r.capB)}</span>
                  </div>
                  {cols.map((c) => {
                    const p = r[c.key];
                    const col = heat(p);
                    return (
                      <div key={c.key} className="flex items-center justify-center rounded-md text-[13px] font-medium tnum"
                        style={{ background: col.bg, color: col.fg, border: p == null ? "1px dashed #2a2a2a" : "none" }}>
                        {fp(p)}
                      </div>
                    );
                  })}
                </Link>
              );
            })}
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-faint">
        {hasSnap
          ? "盘前/盘中/盘后 = 当日三次快照;颜色=各段涨跌(相对昨收)。"
          : "现仅「最近收盘」一段(市值加权)。盘前/盘中/盘后要接每日三次实时快照才显示,接上后这里自动变三列。"}
        {" "}板块按 GICS · 非投资建议
      </p>
    </section>
  );
}
