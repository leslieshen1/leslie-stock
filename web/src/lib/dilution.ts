import fs from "node:fs";
import path from "node:path";
import type { DilutionFlag } from "./dilution-types";

export type { DilutionFlag } from "./dilution-types";

// mtime 模块缓存:个股页热路径,避免每次重解析(文件变则自动重读)。
let _diluCache: { mtime: number; flags: Record<string, DilutionFlag> } | null = null;
export function loadDilutionFlags(): Record<string, DilutionFlag> {
  const candidates = [
    path.join(process.cwd(), "public", "data", "dilution-flags.json"),
    path.resolve(process.cwd(), "..", "web", "public", "data", "dilution-flags.json"),
  ];
  for (const p of candidates) {
    try {
      const mtime = fs.statSync(p).mtimeMs;
      if (!_diluCache || _diluCache.mtime !== mtime) {
        const j = JSON.parse(fs.readFileSync(p, "utf-8")) as { flags?: Record<string, DilutionFlag> };
        _diluCache = { mtime, flags: j.flags || {} };
      }
      return _diluCache.flags;
    } catch {
      // try next
    }
  }
  return {};
}
