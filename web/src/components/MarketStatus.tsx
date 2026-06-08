"use client";

import { useEffect, useState } from "react";
import { marketStatus, type MktState } from "@/lib/market-status";

const TONE: Record<MktState, string> = {
  open: "text-up border-up/30 bg-up-soft",
  pre: "text-[#e0a23d] border-[#e0a23d]/30 bg-[#e0a23d]/10",
  post: "text-[#e0a23d] border-[#e0a23d]/30 bg-[#e0a23d]/10",
  closed: "text-faint border-line bg-surface-2",
};
const DOT: Record<MktState, string> = {
  open: "bg-up animate-pulse",
  pre: "bg-[#e0a23d] animate-pulse",
  post: "bg-[#e0a23d] animate-pulse",
  closed: "bg-faint",
};

// 顶部盘口状态胶囊。客户端按美东时间算,每分钟刷新(避免 SSR 水合不一致 → 挂载后才渲染)。
export default function MarketStatus() {
  const [st, setSt] = useState<{ state: MktState; label: string } | null>(null);
  useEffect(() => {
    const tick = () => setSt(marketStatus(new Date()));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  if (!st) return null;
  return (
    <span
      title="美股交易时段(美东时间) · 休市时价格停在最近收盘价"
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${TONE[st.state]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[st.state]}`} />
      美股 {st.label}
    </span>
  );
}
