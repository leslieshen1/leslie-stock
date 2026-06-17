"use client";

// 板块·一日三段:每行=一个板块,行高=√市值(量级,最小封底 30px 保可读),
// 三列=盘前/盘中/盘后(红绿=涨跌)。今日(盘中)= us-stocks 市值加权;盘前/盘后= Upstash 当日快照。
import { useEffect, useState } from "react";
import Link from "next/link";

type Row = { sector: string; capB: number; mid: number; pre: number | null; post: number | null };

const ZH: Record<string, string> = {
  Technology: "科技", Finance: "金融", "Financial Services": "金融", "Health Care": "医疗", Healthcare: "医疗",
  "Consumer Discretionary": "可选消费", "Consumer Staples": "必需消费", "Consumer Cyclical": "可选消费",
  "Consumer Defensive": "必需消费", Industrials: "工业", Energy: "能源", Utilities: "公用事业",
  "Real Estate": "地产", Telecommunications: "通信", "Communication Services": "通信", "Basic Materials": "材料", Materials: "材料",
};

function heat(p: number | null): { bg: string; fg: string } {
  if (p == null) return { bg: "transparent", fg: "var(--faint, #6b7280)" };
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

  return (
    <section className="mt-8">
      <header className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-ink">板块 · 一日三段</h2>
        <span className="text-xs text-faint">美股 · 行高=市值 · 颜色=涨跌 · 盘前→盘中→盘后看轮动 · 点板块进扫描</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-faint">
          {[-3, -1, 0, 1, 3].map((v) => <i key={v} className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: heat(v).bg }} />)}
          <span className="ml-1">−3% → +3%</span>
        </span>
      </header>

      <div className="overflow-hidden rounded-2xl border border-line bg-base/40 p-2">
        {/* 列头 */}
        <div className="mb-1 grid grid-cols-[180px_1fr_1fr_1fr] gap-1 px-1 text-[11px] text-faint sm:grid-cols-[200px_1fr_1fr_1fr]">
          <span className="pl-1">板块 · 今日</span>
          <span className="text-center">盘前</span>
          <span className="text-center">盘中</span>
          <span className="text-center">盘后</span>
        </div>
        {!rows ? (
          <div className="flex h-[360px] items-center justify-center text-sm text-faint">加载板块…</div>
        ) : rows.length === 0 ? (
          <div className="flex h-[360px] items-center justify-center text-sm text-faint">暂无数据</div>
        ) : (
          <div className="flex flex-col gap-1">
            {rows.map((r) => {
              const h = Math.max(30, Math.round((Math.sqrt(Math.max(1, r.capB)) / sqrtSum) * 470));
              const net = r.mid;
              const nc = net < -0.05 ? "text-down" : net > 0.05 ? "text-up" : "text-faint";
              const cells: (number | null)[] = [r.pre, r.mid, r.post];
              return (
                <Link
                  key={r.sector}
                  href={`/scan?market=us&sector=${encodeURIComponent(r.sector)}`}
                  prefetch={false}
                  className="grid grid-cols-[180px_1fr_1fr_1fr] gap-1 transition hover:brightness-110 sm:grid-cols-[200px_1fr_1fr_1fr]"
                  style={{ height: h }}
                  title={`${ZH[r.sector] || r.sector} · ${fcap(r.capB)} · 今日 ${fp(net)}`}
                >
                  <div className="flex items-center justify-between gap-2 overflow-hidden rounded-md bg-surface px-2.5">
                    <span className="truncate text-[13px] text-ink">{ZH[r.sector] || r.sector}</span>
                    <span className={`shrink-0 text-[13px] font-medium tnum ${nc}`}>{fp(net)}</span>
                  </div>
                  {cells.map((p, i) => {
                    const c = heat(p);
                    return (
                      <div key={i} className="flex items-center justify-center rounded-md text-[13px] font-medium tnum"
                        style={{ background: c.bg, color: c.fg, border: p == null ? "1px dashed var(--line,#2a2a2a)" : "none" }}>
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
        盘中=今日市值加权(实时刷新)。{hasSnap ? "盘前/盘后=当日快照。" : "盘前/盘后:每日三次快照攒齐后显示。"} · 板块按 GICS · 非投资建议
      </p>
    </section>
  );
}
