"use client";

import { useEffect, useState } from "react";
import { yahooSym } from "@/lib/quote-sym";

const RECO: Record<string, string> = {
  strong_buy: "强烈买入", buy: "买入", hold: "持有", sell: "卖出", strong_sell: "强烈卖出",
};

// 估值行:分析师目标上涨空间 + 评级 + 52 周位置。
// 关键修复:上涨空间与 52 周位置的「当前价」基准取实时价(/api/quote),不再用静态上一收盘价 px ——
// 否则同页页头实时价、这里目标涨幅算成两套数(NVDA 实测 px 204.87 → +46%,实时 212.45 应 +40%)。
// /api/quote 只回 price/pct(不回 52 周高低)→ wkHi/wkLo 仍用静态值,只把分子/分母里的当前价换实时价。
// 实时价到位前(首帧 / 拉取失败)回退 px;页头 LivePrice 也用同一个 px 做种子并轮询同一端点,两者锁步。
export default function LiveValuation({
  tgt, px, wkHi, wkLo, reco, code, market,
}: {
  tgt?: number; px?: number; wkHi?: number; wkLo?: number; reco?: string;
  code: string; market: "a" | "hk" | "us";
}) {
  const ysym = yahooSym(code, market);
  const [livePx, setLivePx] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`/api/quote?syms=${encodeURIComponent(ysym)}`, { cache: "no-store" });
        const j = await r.json();
        const p = j.quotes?.[ysym.toUpperCase()]?.price;
        if (alive && typeof p === "number") setLivePx(p);
      } catch {
        /* 静默:保持回退到 px */
      }
    };
    const id = setInterval(poll, 20_000);
    poll();
    return () => { alive = false; clearInterval(id); };
  }, [ysym]);

  // 实时价优先;未到位时回退静态上一收盘价(与页头同一种子,首帧两者一致)
  const base = livePx ?? px ?? null;
  const upside = tgt && base ? Math.round(((tgt - base) / base) * 100) : null;
  const pos =
    base && wkHi && wkLo && wkHi > wkLo
      ? Math.max(0, Math.min(1, (base - wkLo) / (wkHi - wkLo)))
      : null;

  if (upside == null && pos == null && !(reco && RECO[reco])) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
      {upside != null && (
        <span className="text-muted">
          分析师目标 <span className="font-mono text-ink">${tgt}</span>{" "}
          <span className={upside >= 0 ? "text-up" : "text-down"}>
            ({upside >= 0 ? "+" : ""}
            {upside}%)
          </span>
        </span>
      )}
      {reco && RECO[reco] && (
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
          {RECO[reco]}
        </span>
      )}
      {pos != null && (
        <span className="flex items-center gap-2 text-faint">
          52周
          <span className="relative h-1.5 w-24 rounded-full bg-surface-2">
            <span
              className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
              style={{ left: `${pos * 100}%` }}
            />
          </span>
          <span className="font-mono text-ink">{Math.round(pos * 100)}%</span>
        </span>
      )}
    </div>
  );
}
