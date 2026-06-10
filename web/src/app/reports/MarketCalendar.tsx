// 市场日历 —— 盘报顶部"接下来盯什么"。服务端渲染(force-dynamic,每次取当前 ET 日期算相对天)。
export type CalEvent = {
  date: string;
  timeET: string;
  kind: "macro" | "earnings";
  title: string;
  detail: string;
  hi: boolean;
  sym?: string;
};

const fmtET = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

function dayLabel(date: string, todayET: string) {
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayET}T00:00:00Z`)) / 86_400_000);
  const wd = new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", weekday: "short" }).format(new Date(`${date}T12:00:00Z`));
  const rel = diff === 0 ? "今天" : diff === 1 ? "明天" : diff === 2 ? "后天" : "";
  const [, m, d] = date.split("-");
  return { md: `${+m}/${+d}`, wd, rel };
}

export default function MarketCalendar({ events }: { events: CalEvent[] }) {
  if (!events.length) return null;
  const todayET = fmtET(new Date());

  const byDate = new Map<string, CalEvent[]>();
  for (const e of events) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date)!.push(e);
  }

  return (
    <section className="mb-7 rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-faint">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />市场日历 · 接下来盯什么
        <span className="ml-1 text-[9px] normal-case text-faint">🔴 = 重磅</span>
      </div>
      <div className="space-y-3">
        {[...byDate].map(([date, evs]) => {
          const { md, wd, rel } = dayLabel(date, todayET);
          return (
            <div key={date} className="flex gap-3">
              <div className="w-14 shrink-0 pt-0.5">
                <div className={`text-sm font-semibold ${rel === "今天" ? "text-accent" : "text-ink"}`}>{md}</div>
                <div className="text-[10px] text-faint">{wd}{rel && ` · ${rel}`}</div>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                {evs.map((e, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-xs">
                    <span className="w-11 shrink-0 tabular-nums text-faint">{e.timeET || "—"}</span>
                    <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] ${e.kind === "macro" ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted"}`}>
                      {e.kind === "macro" ? "宏观" : "财报"}
                    </span>
                    <span className={`shrink-0 ${e.hi ? "font-semibold text-ink" : "text-muted"}`}>
                      {e.hi && "🔴 "}{e.title}
                    </span>
                    {e.detail && <span className="truncate text-faint">{e.detail}</span>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
