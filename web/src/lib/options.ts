import fs from "fs";
import path from "path";

// 期权 gamma 敞口(Polygon,需 POLYGON_KEY)。无 key 时文件不存在 → null,前端不显示。
export type OptionsGex = {
  gex?: number | null; callGamma?: number; putGamma?: number;
  spot?: number | null; contracts?: number;
};

export function loadOptions(code: string): OptionsGex | null {
  try {
    const p = path.join(process.cwd(), "public", "data", "us-options.json");
    const stocks = (JSON.parse(fs.readFileSync(p, "utf-8")).stocks || {}) as Record<string, OptionsGex>;
    return stocks[code] || stocks[code.toUpperCase()] || null;
  } catch {
    return null;
  }
}
