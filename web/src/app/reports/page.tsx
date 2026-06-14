import { promises as fs } from "fs";
import path from "path";
import ReportsClient, { type Report } from "./ReportsClient";
import MarketCalendar, { type CalEvent } from "./MarketCalendar";
import TodayEventsSection from "./TodayEventsSection";
import { loadTodayEvents } from "@/lib/today-events";
import { T } from "@/lib/i18n";

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

type AheadEvent = { date: string; name: string; detail?: string; hi?: boolean };

export default async function ReportsPage() {
  const [reports, events, ahead, today] = await Promise.all([
    loadJSON<Report[]>("reports.json", "", []),
    loadJSON<CalEvent[]>("market-calendar.json", "events", []),
    loadJSON<AheadEvent[]>("ahead.json", "", []),
    loadTodayEvents(),
  ]);
  // 手动确定性大事(FOMC 等,ahead.json 与 BIG EVENTS 卡同源)并入日历;按日期排序
  const merged: CalEvent[] = [
    ...events,
    ...ahead.map((a) => ({
      date: a.date, timeET: "", kind: "macro" as const,
      title: a.name, detail: a.detail || "", hi: !!a.hi,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.timeET || "").localeCompare(b.timeET || ""));
  return (
    <main className="mx-auto max-w-6xl px-6 pb-10 pt-3">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink"><T zh="盘报" en="Reports" /></h1>
        <p className="text-xs text-faint"><T zh="市场日历 · 今日大事 · 盘前/收盘总结 · 非投资建议" en="Calendar · Today's Events · Pre-market & Close Notes · Not Financial Advice" /></p>
      </header>
      {/* 1/ 市场日历(未来 10 天盯什么 = 抓取日历 ∪ 手动大事,展示端按今日过滤) */}
      <MarketCalendar events={merged} />
      {/* 2/ 今日大事(实时,30 分钟缓存) */}
      <TodayEventsSection ev={today} />
      {/* 3/ 盘前 / 收盘总结 */}
      <ReportsClient reports={reports} />
    </main>
  );
}
