// 市场日历 —— 盘报顶部"接下来盯什么"。服务端渲染(force-dynamic,每次取当前 ET 日期算相对天)。
import { T } from "@/lib/i18n";

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

const REL_EN: Record<string, string> = { "今天": "Today", "明天": "Tomorrow", "后天": "In 2 days" };

function dayLabel(date: string, todayET: string) {
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayET}T00:00:00Z`)) / 86_400_000);
  const wd = new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", weekday: "short" }).format(new Date(`${date}T12:00:00Z`));
  const wdEn = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(new Date(`${date}T12:00:00Z`));
  const rel = diff === 0 ? "今天" : diff === 1 ? "明天" : diff === 2 ? "后天" : "";
  const [, m, d] = date.split("-");
  return { md: `${+m}/${+d}`, wd, wdEn, rel };
}

export default function MarketCalendar({ events }: { events: CalEvent[] }) {
  const todayET = fmtET(new Date());

  // "接下来盯什么" = 只看今天(ET)及以后。数据是抓取时刻的窗口,展示必须按"现在"过滤——
  // 否则隔天看就是馊的(2026-06-12 用户抓包:6/11 的 ADBE 还挂着)。同日去重(Finnhub 偶发重复行)。
  const seen = new Set<string>();
  const fresh = events.filter((e) => {
    if (e.date < todayET) return false;
    const k = `${e.date}|${e.kind}|${e.sym || e.title}|${e.timeET}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!fresh.length) return null;

  const byDate = new Map<string, CalEvent[]>();
  for (const e of fresh) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date)!.push(e);
  }

  return (
    <section className="mb-7 rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap gap-y-1 items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-faint">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" /><T zh="市场日历 · 接下来盯什么" en="Market Calendar · What to Watch Next" />
        <span className="w-full sm:w-auto sm:ml-1 text-[9px] normal-case text-faint"><T zh="🔴 = 重磅" en="🔴 = major" /></span>
      </div>
      <div className="space-y-3">
        {[...byDate].map(([date, evs]) => {
          const { md, wd, wdEn, rel } = dayLabel(date, todayET);
          return (
            <div key={date} className="flex gap-2 sm:gap-3">
              <div className="w-12 sm:w-14 shrink-0 pt-0.5">
                <div className={`text-sm font-semibold ${rel === "今天" ? "text-accent" : "text-ink"}`}>{md}</div>
                <div className="text-[10px] text-faint"><T zh={wd} en={wdEn} />{rel && <> · <T zh={rel} en={REL_EN[rel] ?? rel} /></>}</div>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                {evs.map((e, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-xs">
                    <span className="w-9 sm:w-11 shrink-0 tabular-nums text-faint">{e.timeET || "—"}</span>
                    <span className={`hidden sm:inline-block shrink-0 rounded px-1 py-0.5 text-[9px] ${e.kind === "macro" ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted"}`}>
                      {e.kind === "macro" ? <T zh="宏观" en="Macro" /> : <T zh="财报" en="Earnings" />}
                    </span>
                    <span className={`min-w-0 truncate ${e.hi ? "font-semibold text-ink" : "text-muted"}`}>
                      {e.hi && "🔴 "}{e.title}
                    </span>
                    {e.detail && <span className="hidden truncate text-faint sm:inline">{e.detail}</span>}
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
