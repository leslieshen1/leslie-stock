import fs from "node:fs";
import path from "node:path";

/** 印股票 / 稀释红旗。来自 fetchers/dilution_flags.py(SEC EDGAR 货架 + ATM)。 */
export type DilutionFlag = {
  tier: "active" | "armed";
  shelf: boolean;
  atm_1y: number;
  followon_1y: number;
  foreign: boolean;
  capacity_usd: number | null;
  ratio: number | null;
  last_takedown: string | null;
};

export function loadDilutionFlags(): Record<string, DilutionFlag> {
  const candidates = [
    path.join(process.cwd(), "public", "data", "dilution-flags.json"),
    path.resolve(process.cwd(), "..", "web", "public", "data", "dilution-flags.json"),
  ];
  for (const p of candidates) {
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf-8")) as {
        flags?: Record<string, DilutionFlag>;
      };
      if (j.flags) return j.flags;
    } catch {
      // try next
    }
  }
  return {};
}
