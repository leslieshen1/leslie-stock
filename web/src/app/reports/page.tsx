import { promises as fs } from "fs";
import path from "path";
import ReportsClient, { type Report } from "./ReportsClient";

export const dynamic = "force-dynamic";

async function loadReports(): Promise<Report[]> {
  try {
    const p = path.join(process.cwd(), "public", "data", "reports.json");
    return JSON.parse(await fs.readFile(p, "utf-8")) as Report[];
  } catch {
    return [];
  }
}

export default async function ReportsPage() {
  const reports = await loadReports();
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">盘报 · Reports</h1>
        <p className="mt-1 text-sm text-muted">盘前 / 盘中 / 收盘 —— 只看大标的 + 热门标的 · 我不是股神 · 非投资建议</p>
      </header>
      <ReportsClient reports={reports} />
    </main>
  );
}
