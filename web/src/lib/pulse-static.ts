// 静态 JSON 读取（server-side，Vercel 友好）
// 取代 pulse-db.ts 在生产路径上的 SQLite 依赖
import "server-only";
import { promises as fs } from "fs";
import path from "path";

export interface TrendPoint {
  date: string;
  close: number | null;
  heat: number | null;
}

export interface CoverageRow {
  ticker: string;
  snapshot_date: string;
  ok: number;
  error: string | null;
  metrics: {
    valuation_pct: boolean;
    momentum_20d: boolean;
    rsi: boolean;
    sentiment: boolean;
  };
  fundamentals: Record<string, boolean>;
}

export interface FetchRunRow {
  id: number;
  run_date: string;
  started_at: string;
  finished_at: string | null;
  total: number;
  ok_count: number;
  partial_count: number;
  missing_count: number;
  duration_sec: number;
}

export interface CoveragePayload {
  snapshot_date: string | null;
  rows: CoverageRow[];
  runs: FetchRunRow[];
}

export interface EventItem {
  date: string;
  type: "earnings" | "dividend" | "split" | "news";
  payload: Record<string, unknown> | null;
}

const DATA_DIR = path.join(process.cwd(), "public", "data");

async function readJson<T>(filename: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, filename), "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function loadTrends(): Promise<Record<string, TrendPoint[]>> {
  return readJson<Record<string, TrendPoint[]>>("trends.json", {});
}

export async function loadCoverage(): Promise<CoveragePayload> {
  return readJson<CoveragePayload>("coverage.json", { snapshot_date: null, rows: [], runs: [] });
}

export async function loadEvents(): Promise<Record<string, EventItem[]>> {
  return readJson<Record<string, EventItem[]>>("events.json", {});
}
