import { STOCK_TYPES, type StockTypeKey } from "@/lib/stock-types";
import { T } from "@/lib/i18n";

const TONE: Record<string, string> = {
  up: "text-up", accent: "text-accent", amber: "text-[#e0a23d]", muted: "text-muted", moat: "text-accent",
};

// "先告诉你这是哪类股、该用什么尺子量" —— 在五方判读之上的第二条轴
// 注:类型名/标语/指标来自 @/lib/stock-types 的固定分类表(V1 仅中文),此处只双语化外层 UI 框架。
export default function StockTypeCard({ types }: { types: StockTypeKey[] }) {
  const primary = types[0] ? STOCK_TYPES[types[0]] : null;
  if (!primary) return null;
  const secondary = types[1] ? STOCK_TYPES[types[1]] : null;

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-lg leading-none">{primary.emoji}</span>
        <span className="text-base font-semibold text-ink">
          <T zh="这是" en="This is a" /> <span className={TONE[primary.tone]}>{primary.name}</span>
          {secondary && <> × <span className={TONE[secondary.tone]}>{secondary.name}</span></>}
        </span>
        <span className="text-xs text-faint">· <T zh="主场" en="Home court" /> {primary.master}</span>
      </div>
      <p className="mt-1.5 text-sm text-muted">{primary.tagline}</p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-faint"><T zh="该看" en="Watch" /></span>
        {primary.watch.map((w) => (
          <span key={w} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-medium text-ink">{w}</span>
        ))}
      </div>

      <div className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-down-soft/40 px-3 py-2">
        <span className="text-down">⚠️</span>
        <span className="text-[12px] leading-relaxed text-down/90">{primary.avoid}</span>
      </div>

      {secondary && (
        <div className="mt-2 text-[11px] text-faint">
          <T zh="兼具" en="Also" /> <span className={TONE[secondary.tone]}>{secondary.name}</span>
          <T zh=":也看 " en=" — watch " />{secondary.watch.slice(0, 2).join(" / ")} · <T zh={`${secondary.master} 的菜`} en={`${secondary.master}'s territory`} />
        </div>
      )}

      <p className="mt-3 text-[10px] text-faint">
        <T
          zh="类型决定用什么尺子量 —— PE 只是众多指标之一,每类股该看的东西不一样"
          en="The type decides which ruler to use — P/E is just one of many; each type calls for different metrics"
        />
      </p>
    </div>
  );
}
