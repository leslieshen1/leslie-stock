import { promises as fs } from "fs";
import path from "path";
import ReportsClient, { type Report } from "./ReportsClient";
import MarketCalendar, { type CalEvent } from "./MarketCalendar";
import TodayEventsSection from "./TodayEventsSection";
import { loadTodayEvents } from "@/lib/today-events";

export const dynamic = "force-dynamic";

async function loadJSON<T>(file: string, key: string, fallback: T): Promise<T> {
  try {
    const p = path.join(process.cwd(), "public", "data", file);
    const j = JSON.parse(await fs.readFile(p, "utf-8"));
    return (key ? j[key] : j) ?? fallback;
  } catch {
    return fallback;
  }
}

export default async function ReportsPage() {
  const [reports, events, today] = await Promise.all([
    loadJSON<Report[]>("reports.json", "", []),
    loadJSON<CalEvent[]>("market-calendar.json", "events", []),
    loadTodayEvents(),
  ]);
  return (
    <main className="mx-auto max-w-3xl px-6 pb-10 pt-3">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">盘报</h1>
        <p className="text-xs text-faint">市场日历 · 今日大事 · 盘前/收盘总结 · 非投资建议</p>
      </header>
      {/* 1/ 市场日历(未来 10 天盯什么) */}
      <MarketCalendar events={events} />
      {/* 2/ 今日大事(实时,30 分钟缓存) */}
      <TodayEventsSection ev={today} />
      {/* 3/ 盘前 / 收盘总结 */}
      <ReportsClient reports={reports} />
    </main>
  );
}
