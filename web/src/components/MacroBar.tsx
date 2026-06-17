"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";

// 首页/Wire 顶部宏观条 —— 实时轮询 /api/macro(Yahoo,~30s),变化闪烁。
export type MacroSeries = {
  sym: string; name: string; kind: string; price: number | null; pct: number | null;
};

// 宏观标的名是固定 UI 标签(非 AI 内容)。数据层(api/macro)只发中文 name,这里按 sym 映射 EN,
// 不改数据流/轮询。落到表里没匹配上(理论不会)就回退中文 name。
const NAME_EN: Record<string, string> = {
  "^TNX": "UST 10Y", "^IRX": "UST 13W", "^FVX": "UST 5Y", "^TYX": "UST 30Y",
  "^GSPC": "S&P 500", "^IXIC": "Nasdaq", "^DJI": "Dow Jones", "^RUT": "Russell 2000",
  "^VIX": "VIX", "DX-Y.NYB": "Dollar Index", "GC=F": "Gold", "CL=F": "WTI Crude",
  "BTC-USD": "Bitcoin", "ETH-USD": "Ethereum",
};

function fmtVal(s: MacroSeries): string {
  if (s.price == null) return "—";
  if (s.kind === "rate") return `${s.price.toFixed(2)}%`;
  if (s.price >= 1000) return Math.round(s.price).toLocaleString("en-US");
  return s.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MacroBar({ series: initial }: { series: MacroSeries[] }) {
  const { lang } = useLang();
  const [series, setSeries] = useState<MacroSeries[]>(initial);
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  const prev = useRef<Record<string, number>>({});

  useEffect(() => {
    for (const s of initial) if (s.price != null) prev.current[s.sym] = s.price;
    let alive = true;
    let flashTimer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await fetch("/api/macro", { cache: "no-store" });
        const j = await r.json();
        if (!alive || !j.series?.length) return;
        const f: Record<string, "up" | "down"> = {};
        for (const s of j.series as MacroSeries[]) {
          const p = prev.current[s.sym];
          if (p != null && s.price != null && s.price !== p) f[s.sym] = s.price > p ? "up" : "down";
          if (s.price != null) prev.current[s.sym] = s.price;
        }
        setSeries(j.series);
        if (Object.keys(f).length) {
          setFlash(f);
          flashTimer = setTimeout(() => alive && setFlash({}), 900);
        }
      } catch {
        /* 静默,保留上次值 */
      }
    };
    const id = setInterval(poll, 30_000);
    poll();
    return () => { alive = false; clearInterval(id); clearTimeout(flashTimer); };
  }, [initial]);

  if (!series?.length) return null;
  return (
    <div
      className="mb-2.5 overflow-x-auto rounded-lg border border-line bg-surface [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{
        WebkitMaskImage: "linear-gradient(90deg, #000 0%, #000 96%, transparent 100%)",
        maskImage: "linear-gradient(90deg, #000 0%, #000 96%, transparent 100%)",
      }}
    >
      <div className="flex items-center gap-x-4 whitespace-nowrap px-3.5 py-1.5 text-[11.5px]">
        <span className="kicker flex shrink-0 items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-up animate-pulse" />Macro
        </span>
        {series.map((s) => {
          const up = (s.pct ?? 0) >= 0;
          const fl = flash[s.sym];
          return (
            <span
              key={s.sym}
              className={`flex shrink-0 items-baseline gap-1.5 rounded-md border-l border-line/50 pl-4 pr-1 transition-colors duration-700 first:border-0 first:pl-0 ${
                fl === "up" ? "bg-up/15" : fl === "down" ? "bg-down/15" : ""
              }`}
            >
              <span className="text-muted">{lang === "en" ? (NAME_EN[s.sym] ?? s.name) : s.name}</span>
              <span className="tnum font-medium text-ink">{fmtVal(s)}</span>
              {s.pct != null && (
                <span className={`tnum text-[11px] ${up ? "text-up" : "text-down"}`}>
                  {up ? "+" : ""}{s.pct.toFixed(2)}%
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
