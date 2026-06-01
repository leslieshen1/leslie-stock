import fs from "node:fs";
import path from "node:path";
import type { WhalesData, TickerHolder } from "./whales-types";

export type {
  ChangeType, Holding, InvestorType, Investor, TickerHolder, WhalesData,
} from "./whales-types";
export { CHANGE_META, TYPE_META } from "./whales-types";

// 数据目录：web/data（部署）→ ../data（本地）
const WEB_DATA = path.join(process.cwd(), "data");
const SIBLING_DATA = path.resolve(process.cwd(), "..", "data");
const DATA_ROOT = fs.existsSync(WEB_DATA) ? WEB_DATA : SIBLING_DATA;
const WHALES_PATH = path.join(DATA_ROOT, "whales.json");

export function loadWhales(): WhalesData {
  try {
    return JSON.parse(fs.readFileSync(WHALES_PATH, "utf-8")) as WhalesData;
  } catch {
    return { investors: [], by_ticker: {} };
  }
}

/** 给定 ticker，返回谁在持仓（已按仓位占比降序）。 */
export function getStockHolders(ticker: string): TickerHolder[] {
  const d = loadWhales();
  return d.by_ticker[ticker] ?? [];
}
