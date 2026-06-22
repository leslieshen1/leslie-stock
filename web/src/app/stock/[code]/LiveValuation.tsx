"use client";

import { useEffect, useState } from "react";
import { yahooSym } from "@/lib/quote-sym";
import { useLang } from "@/lib/i18n";

// 分析师目标上涨空间 + 52周位置 —— 基准必须用实时价(与页头 LivePrice 同源 /api/quote),
// 不能用 us-fundamentals 的上一收盘价 f.px,否则同页两个价、两套涨幅(NVDA 静态 +46% 实时应 +40%)。
// 与页头 LivePrice 同款 20s 轮询、同一个 yahooSym 符号:基准随实时价一起更新,不会盘中冻在挂载时那一刻。
const RECO: Record<string, { zh: string; en: string }> = {
  strong_buy: { zh: "强烈买入", en: "Strong Buy" },
  buy: { zh: "买入", en: "Buy" },
  hold: { zh: "持有", en: "Hold" },
  sell: { zh: "卖出", en: "Sell" },
  strong_sell: { zh: "强烈卖出", en: "Strong Sell" },
};

export default function LiveValuation({
  tgt, px, wkHi, wkLo, reco, code, market,
}: {
  tgt?: number; px?: number; wkHi?: number; wkLo?: number; reco?: string;
  code: string; market: "a" | "hk" | "us" | "kr";
}) {
  const { t } = useLang();
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
        /* 拿不到就退回静态收盘价 */
      }
    };
    const id = setInterval(poll, 20_000);
    poll();
    return () => { alive = false; clearInterval(id); };
  }, [ysym]);

  // 实时价优先;未到位时(首帧/失败)回退静态上一收盘价,与页头 LivePrice 同一种子,首帧两者一致
  const basis = livePx ?? px ?? null;
  const upside = tgt && basis ? Math.round(((tgt - basis) / basis) * 100) : null;
  const pos =
    basis && wkHi && wkLo && wkHi > wkLo
      ? Math.max(0, Math.min(1, (basis - wkLo) / (wkHi - wkLo)))
      : null;

  if (upside == null && pos == null && !(reco && RECO[reco])) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
      {upside != null && (
        <span className="text-muted">
          {t("分析师目标", "Analyst Target")} <span className="font-mono text-ink">${tgt}</span>{" "}
          <span className={upside >= 0 ? "text-up" : "text-down"}>
            ({upside >= 0 ? "+" : ""}
            {upside}%)
          </span>
        </span>
      )}
      {reco && RECO[reco] && (
        // 第三方(Yahoo)分析师共识评级,显式归因,避免裸"买入/强烈买入"被误读为本站买卖指令
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{t("分析师评级", "Analyst Rating")} · {t(RECO[reco].zh, RECO[reco].en)}</span>
      )}
      {pos != null && (
        <span className="flex items-center gap-2 text-faint">
          {t("52周", "52-wk")}
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
