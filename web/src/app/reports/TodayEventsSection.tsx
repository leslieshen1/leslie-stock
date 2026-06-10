// 今日大事 —— 盘报 tab 第二段(服务端数据,30 分钟缓存)。
import type { TodayEvents } from "@/lib/today-events";

function Est({ est, prev }: { est: string; prev: string }) {
  if (!est && !prev) return null;
  return (
    <span className="tnum shrink-0 text-[11px] text-faint">
      {est && <>预期 <span className="text-muted">{est}</span></>}
      {est && prev && " · "}
      {prev && <>前值 <span className="text-muted">{prev}</span></>}
    </span>
  );
}

function EarnList({ title, rows, small }: { title: string; rows: TodayEvents["bmo"]; small: string[] }) {
  if (!rows.length && !small.length) return null;
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 text-[11px] font-medium text-muted">{title}</div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.sym} className="flex items-baseline gap-2 text-xs">
            <span className="tnum w-14 shrink-0 font-semibold text-ink">${r.sym}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{r.name || "—"}</span>
            {r.mcapB != null && r.mcapB >= 1 && (
              <span className="tnum shrink-0 text-faint">${Math.round(r.mcapB)}B</span>
            )}
            {r.eps != null && (
              <span className="tnum shrink-0 text-faint">EPS est {r.eps.toFixed(2)}</span>
            )}
          </div>
        ))}
        {small.length > 0 && (
          <div className="tnum pt-0.5 text-[11px] text-faint">
            小盘同日:{small.map((s) => `$${s}`).join(" ")}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TodayEventsSection({ ev }: { ev: TodayEvents | null }) {
  if (!ev || (!ev.macro.length && !ev.bmo.length && !ev.amc.length)) return null;
  return (
    <section className="mb-7 rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="kicker flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />今日大事 · {ev.date.slice(5).replace("-", "/")} {ev.weekday}
        </span>
        {ev.lead && (
          <span className="text-xs font-medium text-ink">
            主角:<span className="text-accent">{ev.lead}</span>
          </span>
        )}
        <span className="ml-auto text-[10px] text-faint">全美东时间 · 30 分钟自动刷新</span>
      </div>

      {ev.macro.length > 0 && (
        <div className="mb-4 space-y-1">
          {ev.macro.map((m, i) => (
            <div key={i} className="flex items-baseline gap-2.5 text-xs">
              <span className="tnum w-11 shrink-0 text-faint">{m.t}</span>
              {m.hi ? (
                <span className="shrink-0 rounded bg-accent/15 px-1 py-px text-[9px] font-semibold text-accent">重磅</span>
              ) : (
                <span className="w-[34px] shrink-0" />
              )}
              <span className={`min-w-0 flex-1 truncate ${m.hi ? "font-semibold text-ink" : "text-muted"}`}>{m.name}</span>
              <Est est={m.est} prev={m.prev} />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4 border-t border-line pt-3 sm:flex-row sm:gap-8">
        <EarnList title="盘前财报" rows={ev.bmo} small={ev.smallBmo} />
        <EarnList title="盘后财报" rows={ev.amc} small={ev.smallAmc} />
      </div>
    </section>
  );
}
