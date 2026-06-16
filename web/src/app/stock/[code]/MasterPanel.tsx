import Link from "next/link";
import type { UsPanel, Stance } from "@/lib/us-panel";
import { MASTERS } from "@/lib/masters";
import MasterRadar from "./MasterRadar";

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

function StanceCard({ name, school, st }: { name: string; school: string; st: Stance }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <span className="text-sm font-semibold text-ink">{name}</span>
          <span className="ml-2 text-[10px] text-faint">{school}</span>
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

function EmptyCard({ name, school }: { name: string; school: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line-2 bg-base/30 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <span className="text-sm font-semibold text-muted">{name}</span>
          <span className="ml-2 text-[10px] text-faint">{school}</span>
        </div>
        <span className="text-xs text-faint">未覆盖</span>
      </div>
      <p className="text-xs text-faint">这只票还没跑过{name}的判读。</p>
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

export default function MasterPanel({ data }: { data: UsPanel }) {
  const covered = MASTERS.filter((m) => data.panel[m.key]).length;
  return (
    <section className="mb-8">
      <header className="mb-3 flex items-baseline gap-3">
        <h2 className="text-lg font-semibold text-ink">{covered} 方独立评分</h2>
        <span className="text-xs text-faint">五位投资人各按自身框架独立评分,分歧越大越值得关注</span>
      </header>

      {/* 法务标注:人设是 AI 按公开方法论的模拟,非本人真实观点/持仓(放量前必须显著) */}
      <p className="mb-3 rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-[11px] leading-relaxed text-muted">
        <span className="font-semibold text-faint">AI 方法论模拟</span> —— 以下五方判读由 AI 依据各投资人公开的投资方法论生成,
        <span className="font-medium text-ink">并非本人真实观点、发言或持仓</span>,亦不代表其本人。仅供研究参考,非投资建议。
      </p>

      {/* 雷达图 hero:5 方评分即 5 维,形状本身就是分歧 */}
      <div className="mb-4 flex flex-col items-center gap-2 rounded-2xl border border-line bg-base/40 p-3 sm:flex-row sm:gap-5 sm:p-4">
        <div className="shrink-0">
          <MasterRadar panel={data.panel} />
        </div>
        <div className="flex-1 self-stretch sm:border-l sm:border-line sm:pl-5">
          {data.divergence ? (
            <>
              <div className="text-xs font-semibold text-accent">分歧焦点</div>
              <p className="mt-1.5 text-sm leading-relaxed text-ink">{data.divergence}</p>
            </>
          ) : (
            <p className="text-sm leading-relaxed text-muted">
              雷达各顶点为一方评分,越靠外评分越高;形状越规整代表五方越一致,越不规则代表分歧越大。
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {MASTERS.map((m) => {
          const st = data.panel[m.key];
          return st ? (
            <StanceCard key={m.key} name={m.name} school={m.school} st={st} />
          ) : (
            <EmptyCard key={m.key} name={m.name} school={m.school} />
          );
        })}

        {/* 产业链定位 */}
        <div className="rounded-xl border border-line bg-base/40 p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-faint">产业链定位</div>
          <p className="mt-1 text-sm font-medium text-ink">
            {data.chain.industry}
            <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{data.chain.layer}</span>
          </p>
          {/* 用干净的公司介绍 desc,不再用被 Serenity thesis 污染的 chain.role */}
          {data.desc && <p className="mt-1 text-xs leading-relaxed text-muted">{data.desc}</p>}
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

    </section>
  );
}
