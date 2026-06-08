import fs from "fs";
import path from "path";

// 紧凑基本面记录(短 key,来自 fetchers/fundamentals.py 的 Yahoo .info 抽取)
export type Fundamentals = {
  pe?: number; fpe?: number; ps?: number; evE?: number; evR?: number;
  peg?: number; pb?: number; gm?: number; om?: number; pm?: number;
  roe?: number; roa?: number; de?: number; divY?: number;
  revG?: number; earnG?: number; fcf?: number; beta?: number;
  reco?: string; tgt?: number; px?: number; wkHi?: number; wkLo?: number; mcapB?: number;
};

let _cache: Record<string, Fundamentals> | null = null;

function loadAll(): Record<string, Fundamentals> {
  if (_cache) return _cache;
  try {
    const p = path.join(process.cwd(), "public", "data", "us-fundamentals.json");
    _cache = (JSON.parse(fs.readFileSync(p, "utf-8")).stocks || {}) as Record<string, Fundamentals>;
  } catch {
    _cache = {};
  }
  return _cache;
}

export function loadFundamentals(code: string): Fundamentals | null {
  const all = loadAll();
  return all[code] || all[code.toUpperCase()] || null;
}
