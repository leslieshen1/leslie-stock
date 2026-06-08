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

// 读 us-fundamentals.json —— 与 stock-type.ts 同款(每次读新、不 memo,serverless 上稳)
export function loadFundamentals(code: string): Fundamentals | null {
  try {
    const p = path.join(process.cwd(), "public", "data", "us-fundamentals.json");
    const map = (JSON.parse(fs.readFileSync(p, "utf-8")).stocks || {}) as Record<string, Fundamentals>;
    return map[code] || map[code.toUpperCase()] || null;
  } catch {
    return null;
  }
}
