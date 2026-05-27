"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { EnrichedWatchItem } from "@/lib/data";

type TabKey = "list" | "sector" | "concept" | "bottleneck";

export default function WatchlistDashboard({ items }: { items: EnrichedWatchItem[] }) {
  const [tab, setTab] = useState<TabKey>("list");

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-1">
          <TabButton active={tab === "list"} onClick={() => setTab("list")}>
            📋 列表
          </TabButton>
          <TabButton active={tab === "sector"} onClick={() => setTab("sector")}>
            🏭 板块
          </TabButton>
          <TabButton active={tab === "concept"} onClick={() => setTab("concept")}>
            🎯 概念
          </TabButton>
          <TabButton
            active={tab === "bottleneck"}
            onClick={() => setTab("bottleneck")}
          >
            ⚙️ 瓶颈
          </TabButton>
        </div>
        <p className="text-xs text-zinc-400">
          段巴 + Serenity 双视角 · 点击股票看完整报告
        </p>
      </div>

      {tab === "list" && <ListView items={items} />}
      {tab === "sector" && <SectorView items={items} />}
      {tab === "concept" && <ConceptView items={items} />}
      {tab === "bottleneck" && <BottleneckView items={items} />}
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-zinc-900 text-white"
          : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50"
      }`}
    >
      {children}
    </button>
  );
}

// ===================== 列表视图（按 status） =====================
function ListView({ items }: { items: EnrichedWatchItem[] }) {
  const ready = items.filter((w) => w.status === "ready_to_buy").sort((a, b) => b.score_pro - a.score_pro);
  const tracking = items.filter((w) => w.status === "tracking").sort((a, b) => b.score_pro - a.score_pro);
  const holdOff = items.filter((w) => w.status === "hold_off").sort((a, b) => b.score_pro - a.score_pro);

  return (
    <>
      {ready.length > 0 && (
        <Section title="🟢 Ready to Buy" subtitle="BG 框架已通过，等价格 / 时机" tone="green">
          {ready.map((w) => <ItemCard key={`${w.code}-${w.market}`} item={w} />)}
        </Section>
      )}
      {tracking.length > 0 && (
        <Section title="🟡 Tracking" subtitle="跟踪学习中，等更多信号" tone="yellow">
          {tracking.map((w) => <ItemCard key={`${w.code}-${w.market}`} item={w} />)}
        </Section>
      )}
      {holdOff.length > 0 && (
        <Section title="🔴 Hold Off" subtitle="估值高 / 时机不对 / 触发一票否决" tone="red">
          {holdOff.map((w) => <ItemCard key={`${w.code}-${w.market}`} item={w} />)}
        </Section>
      )}
    </>
  );
}

// ===================== 板块视图 =====================
function SectorView({ items }: { items: EnrichedWatchItem[] }) {
  const groups = useMemo(() => {
    const out: Record<string, EnrichedWatchItem[]> = {};
    for (const it of items) {
      const sec = it.sector || "未分类";
      out[sec] = out[sec] || [];
      out[sec].push(it);
    }
    Object.values(out).forEach((arr) => arr.sort((a, b) => b.score_pro - a.score_pro));
    return out;
  }, [items]);

  const sectors = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);

  return (
    <>
      {sectors.map((sec) => (
        <Section
          key={sec}
          title={`${sectorEmoji(sec)} ${sec}`}
          subtitle={`${groups[sec].length} 只`}
          tone="blue"
        >
          {groups[sec].map((w) => <ItemCard key={`${w.code}-${w.market}`} item={w} />)}
        </Section>
      ))}
    </>
  );
}

// ===================== 概念视图 =====================
function ConceptView({ items }: { items: EnrichedWatchItem[] }) {
  const groups = useMemo(() => {
    const out: Record<string, EnrichedWatchItem[]> = {};
    for (const it of items) {
      for (const c of it.concepts || []) {
        out[c] = out[c] || [];
        out[c].push(it);
      }
    }
    return out;
  }, [items]);

  const concepts = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <>
      <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-5">
        <p className="mb-3 text-sm font-medium text-zinc-700">所有概念标签（点击筛选）</p>
        <div className="flex flex-wrap gap-2">
          {concepts.map((c) => {
            const isActive = selected === c;
            return (
              <button
                key={c}
                onClick={() => setSelected(isActive ? null : c)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  isActive
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-300 hover:bg-white"
                }`}
              >
                {c} <span className="ml-1 text-[10px] opacity-60">{groups[c].length}</span>
              </button>
            );
          })}
        </div>
      </div>

      {selected ? (
        <Section title={`🎯 ${selected}`} subtitle={`${groups[selected].length} 只`} tone="violet">
          {groups[selected]
            .sort((a, b) => b.score_pro - a.score_pro)
            .map((w) => (
              <ItemCard key={`${w.code}-${w.market}-${selected}`} item={w} />
            ))}
        </Section>
      ) : (
        // 默认展开所有概念
        concepts.map((c) => (
          <Section key={c} title={`🎯 ${c}`} subtitle={`${groups[c].length} 只`} tone="violet">
            {groups[c]
              .sort((a, b) => b.score_pro - a.score_pro)
              .map((w) => (
                <ItemCard key={`${w.code}-${w.market}-${c}`} item={w} />
              ))}
          </Section>
        ))
      )}
    </>
  );
}

// ===================== 瓶颈视图（按 aleabit verdict 分组） =====================
function BottleneckView({ items }: { items: EnrichedWatchItem[] }) {
  // Serenity verdict 排序：高确信 → 类比 → 顺风 → 拥挤 → 不在射程 → 无分析
  const order: Array<{
    key: string;
    title: string;
    subtitle: string;
    tone: "green" | "yellow" | "red" | "blue" | "violet";
  }> = [
    {
      key: "high_conviction",
      title: "🎯 High Conviction",
      subtitle: "Serenity 完美命中 — 5+ 信号、Layer 3-4",
      tone: "violet",
    },
    {
      key: "aleabit_analogue",
      title: "🪞 Aleabit Analogue",
      subtitle: "中国/亚洲版她的标的思路",
      tone: "violet",
    },
    {
      key: "worth_watching",
      title: "💎 Worth Watching",
      subtitle: "4 信号命中，继续跟踪",
      tone: "blue",
    },
    {
      key: "macro_tailwind",
      title: "🌊 Macro Tailwind",
      subtitle: "宏观叙事相符，但市值/覆盖率不在 sweet spot",
      tone: "blue",
    },
    {
      key: "crowded_but_valid",
      title: "🚦 Crowded but Valid",
      subtitle: "thesis 有效但已被市场充分发现",
      tone: "yellow",
    },
    {
      key: "not_aleabit_territory",
      title: "❌ Not Aleabit Territory",
      subtitle: "不在 AI 供应链射程内（用段巴框架评估）",
      tone: "red",
    },
  ];

  const groups: Record<string, EnrichedWatchItem[]> = {};
  const noAnalysis: EnrichedWatchItem[] = [];
  for (const it of items) {
    if (it.aleabit_verdict) {
      groups[it.aleabit_verdict] = groups[it.aleabit_verdict] || [];
      groups[it.aleabit_verdict].push(it);
    } else {
      noAnalysis.push(it);
    }
  }
  Object.values(groups).forEach((arr) =>
    arr.sort((a, b) => (b.aleabit_score ?? 0) - (a.aleabit_score ?? 0))
  );

  return (
    <>
      <div className="mb-6 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-5 text-sm text-violet-900">
        <p className="mb-1 font-semibold">
          Serenity (@aleabitoreddit) · &ldquo;Trading Unknown Bottlenecks&rdquo;
        </p>
        <p className="text-xs text-violet-700 leading-relaxed">
          她的 thesis：在 AI capex 从几千亿 → $3-4 万亿/年扩张中，找到&ldquo;还没被定价为关键节点的关键节点&rdquo;。
          按她的 4 层供应链模型 + 7 信号 chokepoint checklist 给每只股打分。
          <strong className="ml-1 text-violet-900">不是投资建议，是框架复刻。</strong>
        </p>
      </div>

      {order.map((g) => {
        const list = groups[g.key];
        if (!list || list.length === 0) return null;
        return (
          <Section
            key={g.key}
            title={`${g.title} · ${list.length}`}
            subtitle={g.subtitle}
            tone={g.tone}
          >
            {list.map((w) => (
              <ItemCard key={`${w.code}-${w.market}-${g.key}`} item={w} />
            ))}
          </Section>
        );
      })}

      {noAnalysis.length > 0 && (
        <Section
          title={`⏳ 尚未做 Aleabit 分析 · ${noAnalysis.length}`}
          subtitle="对话中说&ldquo;按 Serenity 框架分析这只&rdquo;即可生成"
          tone="yellow"
        >
          {noAnalysis.map((w) => (
            <ItemCard key={`${w.code}-${w.market}-none`} item={w} />
          ))}
        </Section>
      )}
    </>
  );
}

// ===================== 共享组件 =====================

function Section({
  title,
  subtitle,
  tone,
  children,
}: {
  title: string;
  subtitle: string;
  tone: "green" | "yellow" | "red" | "blue" | "violet";
  children: React.ReactNode;
}) {
  const borderColor = {
    green: "border-l-emerald-500",
    yellow: "border-l-amber-500",
    red: "border-l-rose-500",
    blue: "border-l-sky-500",
    violet: "border-l-violet-500",
  }[tone];

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-zinc-800">{title}</h2>
        <p className="text-xs text-zinc-500">{subtitle}</p>
      </div>
      <div className="space-y-3">
        {Array.isArray(children) ? children.map((child, i) =>
          // wrap each card to apply border tone
          (typeof child === "object" && child !== null) ? (
            <div key={i} className={`border-l-4 ${borderColor} rounded-r-xl bg-transparent`}>{child}</div>
          ) : null
        ) : children}
      </div>
    </section>
  );
}

function ItemCard({ item: w }: { item: EnrichedWatchItem }) {
  const marketLabel = w.market === "a" ? "A 股" : w.market === "hk" ? "港股" : "美股";
  const marketColor =
    w.market === "a"
      ? "text-red-600"
      : w.market === "hk"
      ? "text-blue-600"
      : "text-violet-600";

  return (
    <Link
      href={`/stock/${w.code}?market=${w.market}`}
      className="group block rounded-xl border border-zinc-200 bg-white px-5 py-4 transition hover:border-zinc-300 hover:shadow-sm"
    >
      <div className="flex items-start gap-6">
        {/* 主信息区 */}
        <div className="flex-1 min-w-0">
          {/* 第一行：名称 + 代码 + 市场 */}
          <div className="flex items-baseline gap-2.5">
            <h3 className="text-base font-semibold text-zinc-900 truncate">
              {w.name}
            </h3>
            <span className="font-mono text-xs text-zinc-400">{w.code}</span>
            <span className={`text-[11px] font-medium ${marketColor}`}>
              {marketLabel}
            </span>
          </div>

          {/* 第二行：板块 · aleabit verdict · target / date */}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500">
            {w.sector && <span>{w.sector}</span>}
            {w.sector && w.aleabit_label && <span className="text-zinc-300">·</span>}
            {w.aleabit_label && (
              <span
                className={aleabitInlineColor(w.aleabit_verdict)}
                title={`Serenity 瓶颈狙击 · ${w.aleabit_score ?? "—"}/100`}
              >
                {w.aleabit_label}
              </span>
            )}
            {w.target_buy_price && (
              <>
                <span className="text-zinc-300">·</span>
                <span>
                  目标 <span className="font-medium text-zinc-700">{w.target_buy_price}</span>
                </span>
              </>
            )}
          </div>

          {/* 第三行：一句话观点（单行截断，hover 才展开） */}
          {w.my_view && (
            <p className="mt-2 text-[13px] text-zinc-600 line-clamp-1 group-hover:line-clamp-3 transition-all leading-relaxed">
              {w.my_view}
            </p>
          )}
        </div>

        {/* 分数区 — 紧凑横向 */}
        <div className="flex shrink-0 gap-5 pt-0.5">
          <ScoreCell label="Pro" value={w.score_pro} variant="pro" />
          <ScoreCell label="Alpha" value={w.score_alpha} variant="alpha" />
          {typeof w.aleabit_score === "number" && (
            <ScoreCell label="瓶颈" value={w.aleabit_score} variant="aleabit" />
          )}
        </div>
      </div>
    </Link>
  );
}

function ScoreCell({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "pro" | "alpha" | "aleabit";
}) {
  const colorClass =
    variant === "aleabit" ? aleabitScoreColor(value) : scoreColor(value);
  const labelColor =
    variant === "aleabit" ? "text-violet-400" : "text-zinc-400";

  return (
    <div className="text-right tabular-nums">
      <p className={`text-[10px] uppercase tracking-wider ${labelColor}`}>
        {label}
      </p>
      <p className={`font-mono text-xl font-semibold ${colorClass}`}>
        {value.toFixed(value % 1 === 0 ? 0 : 1)}
      </p>
    </div>
  );
}

function aleabitInlineColor(verdict?: string): string {
  switch (verdict) {
    case "high_conviction":
      return "text-violet-700 font-medium";
    case "worth_watching":
      return "text-violet-600";
    case "aleabit_analogue":
      return "text-fuchsia-600";
    case "macro_tailwind":
      return "text-sky-600";
    case "crowded_but_valid":
      return "text-amber-600";
    case "not_aleabit_territory":
      return "text-zinc-400";
    default:
      return "text-zinc-500";
  }
}

function aleabitScoreColor(score: number): string {
  if (score >= 75) return "text-violet-700";
  if (score >= 55) return "text-violet-500";
  if (score >= 30) return "text-zinc-500";
  return "text-zinc-400";
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-600";
  if (score >= 70) return "text-amber-600";
  if (score >= 60) return "text-orange-600";
  return "text-zinc-500";
}

function aleabitBadgeColor(verdict?: string): string {
  switch (verdict) {
    case "high_conviction":
      return "bg-violet-100 text-violet-800 ring-1 ring-violet-300";
    case "worth_watching":
      return "bg-violet-50 text-violet-700";
    case "aleabit_analogue":
      return "bg-fuchsia-50 text-fuchsia-700";
    case "macro_tailwind":
      return "bg-sky-50 text-sky-700";
    case "crowded_but_valid":
      return "bg-amber-50 text-amber-700";
    case "not_aleabit_territory":
      return "bg-zinc-100 text-zinc-500";
    default:
      return "bg-zinc-50 text-zinc-500";
  }
}

function sectorEmoji(sector: string): string {
  if (sector.includes("AI")) return "🤖";
  if (sector.includes("能源") || sector.includes("材料") || sector.includes("资源")) return "⚡";
  if (sector.includes("医药")) return "💊";
  if (sector.includes("互联网") || sector.includes("金融")) return "🌐";
  if (sector.includes("国防")) return "🛡️";
  return "📊";
}
