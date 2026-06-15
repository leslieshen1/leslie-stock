import fs from "node:fs";
import path from "node:path";
import { safeCode, safeUnder } from "./sanitize";

export type Stance = { verdict: string; score: number; judgment: string; reasoning: string };
export type UsPanel = {
  rank?: number;
  name?: string;
  mcapB?: number | null;
  mcapYi?: number | null;  // A股市值(亿 RMB);美股用 mcapB($B)
  sector?: string;
  // 开放式:masterKey → 该方判读。加股神=加一个 key,老数据缺哪方=显示"未覆盖"
  panel: Record<string, Stance | undefined>;
  chain: {
    industry: string;
    layer: string;
    role: string;
    upstream?: string[];
    downstream?: string[];
  };
  divergence: string;
};

export function loadUsPanel(sym: string): UsPanel | null {
  const c = safeCode(sym);
  if (!c) return null;
  const s = c.toUpperCase();
  // A 股代码是纯数字(如 600519)→ 找 a-panels/;美股是字母 → us-panels/。无冲突。
  const dir = /^\d+$/.test(c) ? "a-panels" : "us-panels";
  const candidates = [
    safeUnder(path.join(process.cwd(), "public", "data", dir), `${s}.json`),
    safeUnder(path.resolve(process.cwd(), "..", "web", "public", "data", dir), `${s}.json`),
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf-8");
      const j = JSON.parse(raw) as UsPanel;
      if (j.panel) return j;
    } catch {
      // try next
    }
  }
  return null;
}
