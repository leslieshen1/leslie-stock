"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// 盘前/盘后异动条 —— 只在延伸时段出现(盘前/盘后)。轮询 /api/premarket-movers。
// 整盘看板里 screener 盘前只有收盘价,这里专门给一批大票的真盘前涨跌,补上"盘前在动什么"。
type Mover = { sym: string; price: number | null; pct: number | null; prevPct: number | null };
type Payload = { session: string; label: string; gainers: Mover[]; losers: Mover[]; ts: number };

export default function PremarketStrip() {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/premarket-movers", { cache: "no-store" });
        const j = (await r.json()) as Payload;
        if (alive) setData(j);
      } catch {
        /* 静默 */
      }
    };
    const id = setInterval(poll, 45_000);
    poll();
    return () => { alive = false; clearInterval(id); };
  }, []);

  // 只在盘前/盘后显示(盘中/休市不出现,避免和看板的盘中/收盘口径打架)
  if (!data || (data.session !== "pre" && data.session !== "post")) return null;
  const all = [...data.gainers, ...data.losers.filter((l) => !data.gainers.some((g) => g.sym === l.sym))];
  if (!all.length) return null;

  const Item = ({ m }: { m: Mover }) => {
    const up = (m.pct ?? 0) >= 0;
    return (
      <Link
        href={`/stock/${m.sym}?market=us`}
        className="flex shrink-0 items-baseline gap-1.5 border-l border-line/50 pl-3 pr-1 first:border-0 first:pl-0 hover:opacity-80"
      >
        <span className="font-medium text-ink">{m.sym}</span>
        <span className={`tnum text-[11px] font-medium ${up ? "text-up" : "text-down"}`}>
          {up ? "+" : ""}{(m.pct ?? 0).toFixed(1)}%
        </span>
      </Link>
    );
  };

  return (
    <div className="mb-2.5 overflow-x-auto rounded-lg border border-accent/30 bg-surface [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex items-center gap-x-3 whitespace-nowrap px-3.5 py-1.5 text-[11.5px]">
        <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
          {data.label}
        </span>
        {all.map((m) => (
          <Item key={m.sym} m={m} />
        ))}
        <span className="shrink-0 pl-1 text-[10px] text-faint">较昨收</span>
      </div>
    </div>
  );
}
