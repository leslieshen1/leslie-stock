"use client";

// 板块热力(实时):每行=一个板块,行高=√市值(量级,最小封底 30px 保可读),颜色=当前涨跌。
// 跟着 /api/market 实时行情走(每分钟刷),带当前时段标签;不靠快照、不靠 cron。
import { useEffect, useState } from "react";
import Link from "next/link";

type Row = { sector: string; capB: number; pct: number };

const ZH: Record<string, string> = {
  Technology: "科技", Finance: "金融", "Financial Services": "金融", "Health Care": "医疗", Healthcare: "医疗",
  "Consumer Discretionary": "可选消费", "Consumer Staples": "必需消费", "Consumer Cyclical": "可选消费",
  "Consumer Defensive": "必需消费", Industrials: "工业", Energy: "能源", Utilities: "公用事业",
  "Real Estate": "地产", Telecommunications: "通信", "Communication Services": "通信",
  "Basic Materials": "材料", Materials: "材料", Miscellaneous: "其他", Other: "其他",
};

function heat(p: number): { bg: string; fg: string } {
  if (p >= -0.05 && p <= 0.05) return { bg: "hsl(220 6% 27%)", fg: "rgba(255,255,255,.8)" };
  const t = Math.min(1, Math.abs(p) / 3);
  return p < 0 ? { bg: `hsl(0 ${50 + t * 26}% ${40 - t * 18}%)`, fg: "#fff" } : { bg: `hsl(150 ${44 + t * 26}% ${34 - t * 15}%)`, fg: "#fff" };
}
const fp = (p: number) => `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
const fcap = (b: number) => (b >= 1000 ? `$${(b / 1000).toFixed(1)}T` : `$${Math.round(b)}B`);

export default function SectorSessions() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [session, setSession] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/sector-sessions")
        .then((r) => r.json())
        .then((j) => { if (alive) { setRows(j.sectors || []); setSession(j.session || ""); } })
        .catch(() => { if (alive) setRows([]); });
    load();
    const id = setInterval(load, 60_000); // 每分钟跟实时刷新
    return () => { alive = false; clearInterval(id); };
  }, []);

  const sqrtSum = rows?.reduce((s, r) => s + Math.sqrt(Math.max(1, r.capB)), 0) || 1;

  return (
    <section className="mt-8">
      <header className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-ink">板块热力</h2>
        {session && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${session === "休市" ? "bg-surface-2 text-faint" : "bg-up-soft text-up"}`}>
            实时 · {session}
          </span>
        )}
        <span className="text-xs text-faint">行高=市值 · 颜色=当前涨跌 · 跟实时行情 · 点板块进扫描</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-faint">
          {[-3, -1, 0, 1, 3].map((v) => <i key={v} className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: heat(v).bg }} />)}
          <span className="ml-1">−3% → +3%</span>
        </span>
      </header>

      <div className="overflow-hidden rounded-2xl border border-line bg-base/40 p-2">
        <div className="mb-1 grid grid-cols-[minmax(150px,210px)_1fr] gap-1 px-1 text-[11px] text-faint">
          <span className="pl-1">板块 · 市值</span>
          <span className="text-center">{session ? `${session}涨跌` : "涨跌"}</span>
        </div>
        {!rows ? (
          <div className="flex h-[360px] items-center justify-center text-sm text-faint">加载板块…</div>
        ) : rows.length === 0 ? (
          <div className="flex h-[360px] items-center justify-center text-sm text-faint">暂无数据</div>
        ) : (
          <div className="flex flex-col gap-1">
            {rows.map((r) => {
              const h = Math.max(30, Math.round((Math.sqrt(Math.max(1, r.capB)) / sqrtSum) * 470));
              const c = heat(r.pct);
              return (
                <Link
                  key={r.sector}
                  href={`/scan?market=us`}
                  prefetch={false}
                  className="grid grid-cols-[minmax(150px,210px)_1fr] gap-1 transition hover:brightness-110"
                  style={{ height: h }}
                  title={`${ZH[r.sector] || r.sector} · ${fcap(r.capB)} · ${fp(r.pct)}`}
                >
                  <div className="flex items-center justify-between gap-2 overflow-hidden rounded-md bg-surface px-2.5">
                    <span className="truncate text-[13px] text-ink">{ZH[r.sector] || r.sector}</span>
                    <span className="shrink-0 text-[12px] text-faint tnum">{fcap(r.capB)}</span>
                  </div>
                  <div className="flex items-center justify-center rounded-md text-[14px] font-medium tnum" style={{ background: c.bg, color: c.fg }}>
                    {fp(r.pct)}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-faint">
        市值加权 · 跟随实时行情(每分钟刷新){session ? ` · 当前${session}` : ""} · 板块按 GICS · 非投资建议
      </p>
    </section>
  );
}
