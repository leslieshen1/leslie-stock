import fs from "fs";
import path from "path";

// 财报日历(Finnhub,需 FINNHUB_KEY)。无 key 时文件不存在 → null,前端不显示。
export type EarningsEvent = {
  date: string; hour?: string;
  epsEst?: number | null; epsAct?: number | null;
  revEst?: number | null; revAct?: number | null;
};

export function loadEarnings(code: string): EarningsEvent | null {
  try {
    const p = path.join(process.cwd(), "public", "data", "earnings-calendar.json");
    const stocks = (JSON.parse(fs.readFileSync(p, "utf-8")).stocks || {}) as Record<string, EarningsEvent[]>;
    const list = stocks[code] || stocks[code.toUpperCase()];
    if (!list?.length) return null;
    return [...list].sort((a, b) => (a.date || "").localeCompare(b.date || ""))[0];
  } catch {
    return null;
  }
}
