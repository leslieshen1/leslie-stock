import fs from "node:fs";
import path from "node:path";
import { safeCode, safeUnder } from "./sanitize";

export type Stance = { verdict: string; score: number; judgment: string; reasoning: string };
export type UsPanel = {
  rank?: number;
  name?: string;
  desc?: string;  // 中性公司介绍一句话(generate);chain.role 曾被 Serenity thesis 污染,不再当介绍用
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

// 聚合回退缓存:per-stock 文件(us-panels/ / a-panels/)缺失时,从已提交的聚合
// us-analyses.json / a-analyses.json 取(模块级只读一次)。us-panels/ 被 gitignore 未进 git → CI 部署没有
// per-stock 文件,否则所有美股详情页都"暂无深度分析"(2026-06-22 抓包)。
const AGG_CACHE: Record<string, Record<string, UsPanel> | null> = {};
function loadAggregate(kind: "us" | "a" | "kr"): Record<string, UsPanel> {
  if (AGG_CACHE[kind] !== undefined && AGG_CACHE[kind] !== null) return AGG_CACHE[kind]!;
  const file = kind === "a" ? "a-analyses.json" : kind === "kr" ? "kr-analyses.json" : "us-analyses.json";
  for (const p of [
    path.join(process.cwd(), "public", "data", file),
    path.resolve(process.cwd(), "..", "web", "public", "data", file),
  ]) {
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
      const stocks = ((j.stocks as Record<string, UsPanel>) ?? (j as unknown as Record<string, UsPanel>));
      AGG_CACHE[kind] = stocks;
      return stocks;
    } catch {
      // try next
    }
  }
  AGG_CACHE[kind] = {};
  return {};
}

export function loadUsPanel(sym: string, market?: string): UsPanel | null {
  const c = safeCode(sym);
  if (!c) return null;
  const s = c.toUpperCase();
  // 韩股(market=kr)代码也是 6 位数字,与 A 股命名空间冲突 → 靠 market 显式区分,走独立 kr-panels/ + kr-analyses.json。
  // 其余:A 股纯数字(如 600519)→ a-panels/;美股字母 → us-panels/。
  const isKr = market === "kr";
  const isA = !isKr && /^\d+$/.test(c);
  const dir = isKr ? "kr-panels" : isA ? "a-panels" : "us-panels";
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
  // per-stock 缺失 → 回退聚合(*-analyses.json 已提交,CI 部署也有)
  const fromAgg = loadAggregate(isKr ? "kr" : isA ? "a" : "us")[s];
  if (fromAgg?.panel) return fromAgg;
  return null;
}
