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

// 聚合判读是自动刷新任务的权威数据源，模块级只读一次。逐股文件只作为历史兼容回退，
// 避免 a-panels/ 的旧快照遮住已写入 a-analyses.json 的最新判读。
const AGG_CACHE: Record<string, Record<string, UsPanel> | null> = {};
function loadAggregate(kind: "us" | "a" | "kr" | "hk"): Record<string, UsPanel> {
  if (AGG_CACHE[kind] !== undefined && AGG_CACHE[kind] !== null) return AGG_CACHE[kind]!;
  const file = kind === "a" ? "a-analyses.json" : kind === "kr" ? "kr-analyses.json" : kind === "hk" ? "hk-analyses.json" : "us-analyses.json";
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
  const isHk = market === "hk";  // 港股代码也是数字,同样靠 market 区分走独立 hk-panels/hk-analyses(避开 A 股命名空间)
  const isA = !isKr && !isHk && /^\d+$/.test(c);
  const kind = isKr ? "kr" : isHk ? "hk" : isA ? "a" : "us";
  const dir = isKr ? "kr-panels" : isHk ? "hk-panels" : isA ? "a-panels" : "us-panels";
  const candidates = [
    safeUnder(path.join(process.cwd(), "public", "data", dir), `${s}.json`),
    safeUnder(path.resolve(process.cwd(), "..", "web", "public", "data", dir), `${s}.json`),
  ].filter((p): p is string => !!p);
  let perStock: UsPanel | null = null;
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf-8");
      const j = JSON.parse(raw) as UsPanel;
      if (j.panel) {
        perStock = j;
        break;
      }
    } catch {
      // try next
    }
  }

  const fromAgg = loadAggregate(kind)[s];
  if (!fromAgg?.panel) return perStock;

  // 聚合文件保存最新评分，但部分市场只写评分字段。A 股 a-analyses.json 目前没有
  // chain/desc，直接返回会让详情页读取 chain.industry 时整页崩溃。用逐股文件补齐
  // 展示字段；两边都缺时给出可渲染的空产业链，避免一条脏数据拖垮整个页面。
  const aggregate = fromAgg as UsPanel & { cap?: number; layer?: string | number };
  return {
    ...perStock,
    ...aggregate,
    mcapYi: aggregate.mcapYi ?? aggregate.cap ?? perStock?.mcapYi ?? null,
    desc: aggregate.desc ?? perStock?.desc,
    chain: aggregate.chain ?? perStock?.chain ?? {
      industry: aggregate.sector ?? "",
      layer: aggregate.layer == null ? "" : String(aggregate.layer),
      role: "",
      upstream: [],
      downstream: [],
    },
  };
}
