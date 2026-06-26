"use client";

import { useState, type ComponentProps } from "react";
import PulseClient from "./pulse/PulseClient";
import SectorSessions from "@/components/SectorSessions";
import { useLang } from "@/lib/i18n";

// 热力图页三子视图:脉冲热力 / 产业链 / 板块。顶部导航不加 tab(已 7 个),改在页内轻量切换,
// 把原来一页往下滚三件事(粒子场 + 明星产业链 + 板块)拆清爽。
// 脉冲与产业链共用同一个 PulseClient 实例(只切 mode,不卸载 → 保状态、不重抓);板块=SectorSessions。
type PulseProps = Omit<ComponentProps<typeof PulseClient>, "mode">;

export default function HeatmapShell({ pulse }: { pulse: PulseProps }) {
  const { t } = useLang();
  const [view, setView] = useState<"pulse" | "chains" | "board">("pulse");
  const tabs = [
    { id: "pulse" as const, label: "脉冲热力", en: "Pulse", sub: "个股 × 镜头", subEn: "stocks × lens" },
    { id: "chains" as const, label: "产业链", en: "Chains", sub: "明星产业链 · 关系图", subEn: "star supply chains" },
    { id: "board" as const, label: "板块", en: "Sectors", sub: "美股 / A股 三段", subEn: "US / A board" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1 rounded-lg bg-surface-2 p-1">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setView(tb.id)}
            title={t(tb.sub, tb.subEn)}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
              view === tb.id ? "bg-accent text-black shadow" : "text-muted hover:text-ink"
            }`}
          >
            {t(tb.label, tb.en)}
          </button>
        ))}
      </div>

      <div className={view === "board" ? "hidden" : undefined}>
        <PulseClient {...pulse} mode={view === "chains" ? "chains" : "pulse"} />
      </div>
      {view === "board" && <SectorSessions />}
    </div>
  );
}
