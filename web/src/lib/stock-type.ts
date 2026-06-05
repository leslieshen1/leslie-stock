import fs from "fs";
import path from "path";
import type { StockTypeKey } from "./stock-types";

// 读 stock-type-map.json(规则法标注),返回该票的类型(primary [+ secondary])
export function loadStockTypes(code: string): StockTypeKey[] {
  try {
    const p = path.join(process.cwd(), "public", "data", "stock-type-map.json");
    const map = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, StockTypeKey[]>;
    return (map[code] || map[code.toUpperCase()] || []) as StockTypeKey[];
  } catch {
    return [];
  }
}
