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

type Q = {
  price: number | null;
  pct: number | null;
  session?: "pre" | "regular" | "post" | "closed";
  prevClose?: number | null;
};

export default function LivePrice({
  code, market, initialPrice,
}: {
  code: string; market: "a" | "hk" | "us"; initialPrice?: number | null;
}) {
  const ysym = yahooSym(code, market);
  const [q, setQ] = useState<Q>({ price: initialPrice ?? null, pct: null });
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
        const nq = j.quotes?.[ysym.toUpperCase()] as Q | undefined;
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
  const cur = market === "us" ? "$" : "";
  // 美股优先用 API 的 session(权威);A/港股回退到客户端美东时段(沿用旧行为)
  const sess: "pre" | "regular" | "post" | "closed" | MktState =
    market === "us" && q.session ? q.session : (mkt ?? "closed");
  const live = sess === "regular" || sess === "open";
  const sessLabel =
    sess === "pre" ? "盘前" : live ? "实时" : sess === "post" ? "盘后" : "休市";
  const ext = sess === "pre" || sess === "post"; // 延伸时段:显示昨收做基准
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span
        className={`tnum text-2xl font-semibold transition-colors duration-700 ${
          flash === "up" ? "text-up" : flash === "down" ? "text-down" : "text-ink"
        }`}
      >
        {cur}{q.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      {q.pct != null && (
        <span className={`tnum text-sm font-medium ${up ? "text-up" : "text-down"}`}>
          {up ? "+" : ""}{q.pct.toFixed(2)}%
        </span>
      )}
      <span className="flex items-center gap-1 text-[10px] tracking-wider text-faint">
        <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-up animate-pulse" : "bg-faint"}`} />
        {sessLabel}
      </span>
      {ext && q.prevClose != null && (
        <span className="tnum text-[10px] text-faint">昨收 {cur}{q.prevClose.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      )}
    </div>
  );
}
