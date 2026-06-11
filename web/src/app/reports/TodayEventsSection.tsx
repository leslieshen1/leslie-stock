// 今日大事 —— 盘报 tab 第二段(服务端数据,30 分钟缓存)。
import type { ReactNode } from "react";
import type { TodayEvents } from "@/lib/today-events";
import { T } from "@/lib/i18n";

const WD_EN: Record<string, string> = {
  "周一": "Mon", "周二": "Tue", "周三": "Wed", "周四": "Thu", "周五": "Fri", "周六": "Sat", "周日": "Sun",
};

function Est({ est, prev }: { est: string; prev: string }) {
  if (!est && !prev) return null;
  return (
    <span className="tnum shrink-0 text-[11px] text-faint">
      {est && <><T zh="预期" en="Est" /> <span className="text-muted">{est}</span></>}
      {est && prev && " · "}
      {prev && <><T zh="前值" en="Prev" /> <span className="text-muted">{prev}</span></>}
    </span>
  );
}

function EarnList({ title, rows, small }: { title: ReactNode; rows: TodayEvents["bmo"]; small: string[] }) {
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
            <T zh="小盘同日:" en="Small caps: " />{small.map((s) => `$${s}`).join(" ")}
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
          <span className="h-1.5 w-1.5 rounded-full bg-accent" /><T zh="今日大事" en="Today's Events" /> · {ev.date.slice(5).replace("-", "/")} <T zh={ev.weekday} en={WD_EN[ev.weekday] ?? ev.weekday} />
        </span>
        {ev.lead && (
          <span className="text-xs font-medium text-ink">
            <T zh="主角:" en="In focus: " /><span className="text-accent">{ev.lead}</span>
          </span>
        )}
        <span className="ml-auto text-[10px] text-faint"><T zh="全美东时间 · 30 分钟自动刷新" en="All times ET · auto-refreshes every 30 min" /></span>
      </div>

      {ev.ipos.length > 0 && (
        <div className="mb-3 space-y-1">
          {ev.ipos.map((i) => (
            <div key={i.sym + i.date} className="flex items-baseline gap-2.5 text-xs">
              <span className="tnum w-11 shrink-0 text-faint">{i.isToday ? <T zh="今天" en="Today" /> : i.date.slice(5).replace("-", "/")}</span>
              <span className="shrink-0 rounded bg-accent/15 px-1 py-px text-[9px] font-semibold text-accent">IPO</span>
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">
                {i.name}({i.sym}) · {i.exch}
              </span>
              <span className="tnum shrink-0 text-[11px] text-faint">
                {i.price && <><T zh="定价" en="Priced" /> <span className="text-muted">${i.price}</span> · </>}
                <T zh="募资" en="Raising" /> <span className="text-muted">${i.valB >= 1 ? i.valB.toFixed(0) + "B" : (i.valB * 1000).toFixed(0) + "M"}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {ev.macro.length > 0 && (
        <div className="mb-4 space-y-1">
          {ev.macro.map((m, i) => (
            <div key={i} className="flex items-baseline gap-2.5 text-xs">
              <span className="tnum w-11 shrink-0 text-faint">{m.t}</span>
              {m.hi ? (
                <span className="shrink-0 rounded bg-accent/15 px-1 py-px text-[9px] font-semibold text-accent"><T zh="重磅" en="Major" /></span>
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
        <EarnList title={<T zh="盘前财报" en="Pre-market earnings" />} rows={ev.bmo} small={ev.smallBmo} />
        <EarnList title={<T zh="盘后财报" en="After-hours earnings" />} rows={ev.amc} small={ev.smallAmc} />
      </div>
    </section>
  );
}
