import fs from "fs";
import path from "path";
import type { StockTypeKey } from "./stock-types";

// 读 stock-type-map.json(规则法标注),返回该票的类型(primary [+ secondary])。
// mtime 模块缓存:个股页热路径,避免每次重解析(文件变则自动重读)。
let _stCache: { mtime: number; map: Record<string, StockTypeKey[]> } | null = null;
export function loadStockTypes(code: string): StockTypeKey[] {
  try {
    const p = path.join(process.cwd(), "public", "data", "stock-type-map.json");
    const mtime = fs.statSync(p).mtimeMs;
    if (!_stCache || _stCache.mtime !== mtime) {
      _stCache = { mtime, map: JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, StockTypeKey[]> };
    }
    return (_stCache.map[code] || _stCache.map[code.toUpperCase()] || []) as StockTypeKey[];
  } catch {
    return [];
  }
}
