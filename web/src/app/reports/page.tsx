import { promises as fs } from "fs";
import path from "path";
import ReportsClient, { type Report } from "./ReportsClient";
import MarketCalendar, { type CalEvent } from "./MarketCalendar";

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
  const [reports, events] = await Promise.all([
    loadJSON<Report[]>("reports.json", "", []),
    loadJSON<CalEvent[]>("market-calendar.json", "events", []),
  ]);
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">盘报 · Reports</h1>
        <p className="mt-1 text-sm text-muted">盘前 / 盘中 / 收盘 —— 只看大标的 + 热门标的 · 我不是股神 · 非投资建议</p>
      </header>
      <MarketCalendar events={events} />
      <ReportsClient reports={reports} />
    </main>
  );
}
