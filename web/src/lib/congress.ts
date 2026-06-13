import fs from "node:fs";
import path from "node:path";
import type { CongressData } from "./congress-types";

export type {
  CongressSide, CongressTrade, CongressMember, CongressData,
} from "./congress-types";
export { PARTY_META } from "./congress-types";

const PUB = path.join(process.cwd(), "public", "data");

export function loadCongress(): CongressData {
  try {
    return JSON.parse(fs.readFileSync(path.join(PUB, "congress.json"), "utf-8")) as CongressData;
  } catch {
    return { updated: "", source: "", n_members: 0, n_trades: 0, members: [] };
  }
}

/** 列表视图用的精简投影：丢掉完整流水，每人只留最近 4 笔预览，省客户端体积。 */
export function loadCongressSummary(): CongressData {
  const d = loadCongress();
  return {
    ...d,
    members: d.members.map((m) => ({ ...m, trades: m.trades.slice(0, 4) })),
  };
}

/** 五方均分 map：ticker → 0-100 整数（us-panel-summary 的 sc 数组非空均值）。 */
export function loadAvgScores(): Record<string, number> {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(PUB, "us-panel-summary.json"), "utf-8")) as {
      stocks: Record<string, { sc: (number | null)[] }>;
    };
    const out: Record<string, number> = {};
    for (const [sym, v] of Object.entries(j.stocks)) {
      const xs = (v.sc || []).filter((x): x is number => typeof x === "number");
      if (xs.length) out[sym] = Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
    }
    return out;
  } catch {
    return {};
  }
}
