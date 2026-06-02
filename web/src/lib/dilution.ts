import fs from "node:fs";
import path from "node:path";
import type { DilutionFlag } from "./dilution-types";

export type { DilutionFlag } from "./dilution-types";

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
