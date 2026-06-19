"use client";

import type { CompanyWithHeat } from "@/lib/supply-chain";

type Item = CompanyWithHeat & { pct?: number | null; livePrice?: number | null };

// 英伟达「硬关系核」—— 只留与 NVDA 直接的供货/买卡关系(剔掉电力底座/AI应用/端侧)。
// ticker 全部来自 supply-chain COMPANIES;每组 tie = 与英伟达的具体关系,这才是用户要"看出关系"的关键。
const GROUPS_UP: { tie: string; tieEn: string; t: string[] }[] = [
  { tie: "晶圆代工 · 独家造 NVDA 芯片", tieEn: "Foundry · sole maker of NVDA silicon", t: ["TSM"] },
  { tie: "HBM 内存 · NVDA 出货天花板", tieEn: "HBM memory · NVDA shipment ceiling", t: ["000660", "MU", "005930"] },
  { tie: "CoWoS 封装 + ABF 基板", tieEn: "CoWoS packaging + ABF substrate", t: ["3711", "AMKR", "600584", "002156", "3037"] },
  { tie: "内存接口 · DDR5 RCD", tieEn: "Memory interface · DDR5", t: ["688008"] },
  { tie: "再上游 · 设备 / EDA(供代工厂)", tieEn: "Further upstream · tools / EDA (feed the foundry)", t: ["ASML", "AMAT", "LRCX", "KLAC", "8035", "SNPS", "CDNS", "ARM"] },
];
const RIVALS = ["AMD", "AVGO", "MRVL", "688256", "688041"];
const GROUPS_DOWN: { tie: string; tieEn: string; t: string[] }[] = [
  { tie: "服务器 ODM · 组装 NVDA 机器", tieEn: "Server ODM · assemble NVDA boxes", t: ["DELL", "SMCI", "601138", "2317", "2382", "000977"] },
  { tie: "机柜周边 · 网络 / 光模块", tieEn: "Rack · networking / optics", t: ["ANET", "300308", "300502", "300394", "LITE", "COHR", "688498"] },
  { tie: "机柜周边 · 液冷 / 电源 / PCB", tieEn: "Rack · cooling / power / PCB", t: ["VRT", "002837", "301018", "300602", "2308", "002851", "002463", "300476", "600183"] },
  { tie: "Neocloud · 买卡出租算力", tieEn: "Neocloud · rent out the GPUs", t: ["CRWV", "NBIS", "APLD"] },
  { tie: "云厂商 · NVDA 最大买家", tieEn: "Hyperscalers · biggest buyers", t: ["MSFT", "GOOGL", "AMZN", "META", "ORCL", "9988", "700"] },
];

export default function NvidiaChain({
  byTicker,
  onOpen,
  lang,
}: {
  byTicker: Map<string, Item>;
  onOpen: (c: Item) => void;
  lang: string;
}) {
  const tt = (zh: string, en: string) => (lang === "en" ? en : zh);

  const chip = (tk: string) => {
    const it = byTicker.get(tk);
    if (!it) return null;
    const pct = it.pct;
    return (
      <button
        key={tk}
        onClick={() => onOpen(it)}
        title={it.ticker}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs transition hover:border-accent/50 hover:bg-surface-3"
      >
        <span className="font-medium text-ink">{it.name}</span>
        {pct != null && (
          <span className={`font-mono text-[10px] ${pct >= 0 ? "text-up" : "text-down"}`}>
            {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
          </span>
        )}
      </button>
    );
  };

  const renderGroup = (g: { tie: string; tieEn: string; t: string[] }) => {
    const chips = g.t.map(chip).filter(Boolean);
    if (!chips.length) return null;
    return (
      <div key={g.tie} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
        <div className="shrink-0 border-l-2 border-accent/30 pl-2 text-xs leading-snug text-muted sm:w-48">
          {tt(g.tie, g.tieEn)}
        </div>
        <div className="flex flex-wrap gap-1.5">{chips}</div>
      </div>
    );
  };

  const nvda = byTicker.get("NVDA");

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-faint">
        {tt("以英伟达为中心 · 上游供货 → NVDA → 下游买卡 · 硬关系核", "NVIDIA at the center · upstream supplies → NVDA → downstream buys")}
      </div>

      {/* 上游 */}
      <div className="space-y-2.5">
        <div className="text-sm font-semibold text-ink">{tt("① 上游 · 给英伟达供货", "① Upstream · supplies NVIDIA")}</div>
        {GROUPS_UP.map(renderGroup)}
      </div>

      <div className="text-center font-mono text-[11px] text-faint">↓ {tt("供货", "supplies")}</div>

      {/* NVDA 核心 */}
      <div className="flex flex-col items-center gap-1.5">
        <button
          onClick={() => nvda && onOpen(nvda)}
          className="rounded-xl border border-accent/60 bg-accent-soft px-6 py-3 text-center transition hover:border-accent"
        >
          <div className="text-lg font-semibold text-ink">★ 英伟达 NVDA</div>
          <div className="text-[11px] text-muted">GPU + NVLink + CUDA · {tt("算力核心", "compute core")}</div>
        </button>
        <div className="text-[10px] text-faint">
          {tt("竞品(非链):", "Rivals (not in chain): ")}
          <span className="text-muted">{RIVALS.map((tk) => byTicker.get(tk)?.name).filter(Boolean).join(" · ")}</span>
        </div>
      </div>

      <div className="text-center font-mono text-[11px] text-faint">↓ {tt("出货", "ships")}</div>

      {/* 下游 */}
      <div className="space-y-2.5">
        <div className="text-sm font-semibold text-ink">{tt("② 下游 · 买英伟达 / 围着它建", "② Downstream · buys NVIDIA")}</div>
        {GROUPS_DOWN.map(renderGroup)}
      </div>

      <div className="border-t border-line pt-2 text-[10px] leading-relaxed text-faint">
        {tt(
          "已剔除离英伟达较远的环节:电力底座(GE Vernova / Vistra)、AI 应用层、端侧(苹果 / 三星多用自研芯片)。点任一公司进详情。",
          "Trimmed distant links: power base, AI apps, edge (Apple / Samsung use own silicon). Click any name for details.",
        )}
      </div>
    </div>
  );
}
