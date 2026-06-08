"use client";

import { useEffect, useRef, useState } from "react";
import { marketStatus, type MktState } from "@/lib/market-status";

// Yahoo 符号:US 直用代码;A股 6→.SS / 0·3→.SZ;港股补零 .HK
function yahooSym(code: string, market: string): string {
  if (market === "a") {
    if (/^6/.test(code)) return `${code}.SS`;
    if (/^[039]/.test(code)) return `${code}.SZ`;
    return code;
  }
  if (market === "hk") return `${code.replace(/\D/g, "").padStart(4, "0")}.HK`;
  return code.toUpperCase();
}

export default function LivePrice({
  code, market, initialPrice,
}: {
  code: string; market: "a" | "hk" | "us"; initialPrice?: number | null;
}) {
  const ysym = yahooSym(code, market);
  const [q, setQ] = useState<{ price: number | null; pct: number | null }>({
    price: initialPrice ?? null, pct: null,
  });
  const [flash, setFlash] = useState<"" | "up" | "down">("");
  const [mkt, setMkt] = useState<MktState | null>(null);
  const prev = useRef<number | null>(initialPrice ?? null);

  useEffect(() => {
    const tick = () => setMkt(marketStatus(new Date()).state);
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await fetch(`/api/quote?syms=${encodeURIComponent(ysym)}`, { cache: "no-store" });
        const j = await r.json();
        const nq = j.quotes?.[ysym.toUpperCase()];
        if (!alive || !nq || nq.price == null) return;
        if (prev.current != null && nq.price !== prev.current) {
          setFlash(nq.price > prev.current ? "up" : "down");
          t = setTimeout(() => alive && setFlash(""), 900);
        }
        prev.current = nq.price;
        setQ(nq);
      } catch {
        /* 静默 */
      }
    };
    const id = setInterval(poll, 20_000);
    poll();
    return () => { alive = false; clearInterval(id); clearTimeout(t); };
  }, [ysym]);

  if (q.price == null) return null;
  const up = (q.pct ?? 0) >= 0;
  const sym = market === "us" ? "$" : "";
  return (
    <div className="flex items-baseline gap-2.5">
      <span
        className={`tnum text-2xl font-semibold transition-colors duration-700 ${
          flash === "up" ? "text-up" : flash === "down" ? "text-down" : "text-ink"
        }`}
      >
        {sym}{q.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      {q.pct != null && (
        <span className={`tnum text-sm font-medium ${up ? "text-up" : "text-down"}`}>
          {up ? "+" : ""}{q.pct.toFixed(2)}%
        </span>
      )}
      <span className="flex items-center gap-1 text-[10px] tracking-wider text-faint">
        <span className={`h-1.5 w-1.5 rounded-full ${mkt === "open" ? "bg-up animate-pulse" : "bg-faint"}`} />
        {mkt === "open" ? "实时" : mkt === "pre" ? "盘前" : mkt === "post" ? "盘后" : "休市"}
      </span>
    </div>
  );
}
