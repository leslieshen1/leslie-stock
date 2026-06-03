import Link from "next/link";
import type { UsPanel, Stance } from "@/lib/us-panel";

const MASTERS: { key: keyof UsPanel["panel"]; name: string; tag: string }[] = [
  { key: "buffett", name: "巴菲特", tag: "价值 · 护城河" },
  { key: "duan", name: "段永平", tag: "价值 · 商业模式" },
  { key: "serenity", name: "Serenity", tag: "alpha · 供应链瓶颈" },
  { key: "druckenmiller", name: "德鲁肯米勒", tag: "alpha · 宏观流动性" },
  { key: "sentiment", name: "情绪资金面", tag: "盘口 · 资金流" },
];

function scoreColor(s: number): string {
  if (s >= 70) return "text-up";
  if (s >= 55) return "text-accent";
  if (s >= 40) return "text-muted";
  return "text-down";
}
function scoreBar(s: number): string {
  if (s >= 70) return "bg-up";
  if (s >= 55) return "bg-accent";
  if (s >= 40) return "bg-muted";
  return "bg-down";
}

function StanceCard({ name, tag, st }: { name: string; tag: string; st: Stance }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <span className="text-sm font-semibold text-ink">{name}</span>
          <span className="ml-2 text-[10px] text-faint">{tag}</span>
        </div>
        <span className={`font-mono text-lg font-semibold tabular-nums ${scoreColor(st.score)}`}>{st.score}</span>
      </div>
      <span className="inline-flex rounded border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink">
        {st.verdict}
      </span>
      <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full ${scoreBar(st.score)}`} style={{ width: `${Math.max(2, Math.min(100, st.score))}%` }} />
      </div>
      <p className="mt-2 text-sm font-medium leading-snug text-ink">{st.judgment}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">{st.reasoning}</p>
    </div>
  );
}

function ChainChips({ syms }: { syms?: string[] }) {
  if (!syms || syms.length === 0) return <span className="text-faint">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {syms.map((s) => (
        <Link
          key={s}
          href={`/stock/${s}?market=us`}
          className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted transition hover:border-accent/40 hover:text-accent"
        >
          {s}
        </Link>
      ))}
    </span>
  );
}

export default function FiveMasterPanel({ data }: { data: UsPanel }) {
  return (
    <section className="mb-8">
      <header className="mb-3 flex items-baseline gap-3">
        <h2 className="text-lg font-semibold text-ink">五方独立判读</h2>
        <span className="text-xs text-faint">各用各的标尺,可以互相打架——分歧本身是信号</span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {MASTERS.map((m) => (
          <StanceCard key={m.key} name={m.name} tag={m.tag} st={data.panel[m.key]} />
        ))}

        {/* 产业链定位 */}
        <div className="rounded-xl border border-line bg-base/40 p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-faint">产业链定位</div>
          <p className="mt-1 text-sm font-medium text-ink">
            {data.chain.industry}
            <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{data.chain.layer}</span>
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{data.chain.role}</p>
          <div className="mt-2.5 space-y-1.5 text-xs">
            <div className="flex gap-2">
              <span className="shrink-0 text-faint">上游</span>
              <ChainChips syms={data.chain.upstream} />
            </div>
            <div className="flex gap-2">
              <span className="shrink-0 text-faint">下游</span>
              <ChainChips syms={data.chain.downstream} />
            </div>
          </div>
        </div>
      </div>

      {data.divergence && (
        <div className="mt-3 rounded-xl border border-accent/30 bg-accent-soft p-3">
          <span className="text-xs font-semibold text-accent">⚖ 五方分歧　</span>
          <span className="text-sm leading-relaxed text-ink">{data.divergence}</span>
        </div>
      )}
    </section>
  );
}
