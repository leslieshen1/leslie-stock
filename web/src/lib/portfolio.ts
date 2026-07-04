// 个人持仓系统核心:流水 → 持仓聚合(加权平均成本)+ 平仓段(lot)检测。
// 数据全存 Upstash(sg:pf: 前缀,私密,Bearer STATS_TOKEN 才可读写);纯函数在此,方便前后端共用。
// 单用户工具:流水量小,每类数据一个 key(JSON 字符串),读写各 1 命令,配额友好。

export type Market = "us" | "a" | "hk";
export type Side = "BUY" | "SELL";

export type Trade = {
  id: string;          // t + ts36,录入时生成
  market: Market;
  sym: string;         // 美股 ticker / A股6位 / 港股数字
  name?: string;
  side: Side;
  price: number;
  qty: number;
  date: string;        // YYYY-MM-DD(成交日)
  reason?: string;     // 买/卖理由 —— 复盘的原料
  ts: number;          // 录入时间戳(排序用)
};

export type Position = {
  market: Market;
  sym: string;
  name: string;
  qty: number;
  avgCost: number;     // 加权平均成本(卖出不摊薄)
  invested: number;    // qty * avgCost
  realized: number;    // 该标的累计已实现盈亏(含历史平仓段)
  firstDate: string;   // 当前持仓段的首笔买入日
  lastReason: string;  // 最近一笔买入理由(表格里展示)
};

// 平仓段:从某段首笔 BUY 到把数量清零的那笔 SELL,一个完整的"一笔操作"——复盘的单位。
export type ClosedLot = {
  lotId: string;       // = 清零那笔 SELL 的 trade id
  market: Market;
  sym: string;
  name: string;
  openDate: string;    // 段首笔买入日
  closeDate: string;   // 清零卖出日
  holdDays: number;
  buyAmt: number;      // 段内买入总额
  sellAmt: number;     // 段内卖出总额
  realized: number;    // sellAmt - buyAmt
  retPct: number;      // realized / buyAmt * 100
  trades: Trade[];     // 段内全部流水(复盘时给 AI 看)
};

export const CCY: Record<Market, string> = { us: "$", a: "¥", hk: "HK$" };

// Upstash 键空间(与 stats 的 sg: 同库不同前缀)
export const PF = {
  trades: "sg:pf:trades",   // JSON Trade[]
  daily: "sg:pf:daily",     // JSON {date,md,genAt}[](留最近 40 篇)
  reviews: "sg:pf:reviews", // JSON Review[](ClosedLot 摘要 + AI md)
  nav: "sg:pf:nav",         // JSON {date, slices:{us,a,hk:{mv,cost,pnl}}}[](前端每日回传快照)
};

function dayDiff(a: string, b: string): number {
  return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000));
}

/** 流水聚合:当前持仓 + 平仓段列表。按 (market|sym) 分组、时间顺序回放。 */
export function aggregate(trades: Trade[]): { positions: Position[]; lots: ClosedLot[] } {
  const sorted = [...trades].sort((x, y) => x.date.localeCompare(y.date) || x.ts - y.ts);
  const acc = new Map<string, { qty: number; avgCost: number; realized: number; seg: Trade[]; name: string; lastReason: string }>();
  const positions: Position[] = [];
  const lots: ClosedLot[] = [];
  const totalRealized = new Map<string, number>(); // key → 含历史段的累计已实现

  for (const t of sorted) {
    const k = `${t.market}|${t.sym}`;
    const s = acc.get(k) || { qty: 0, avgCost: 0, realized: 0, seg: [], name: t.name || t.sym, lastReason: "" };
    if (t.name) s.name = t.name;
    if (t.side === "BUY") {
      s.avgCost = s.qty + t.qty > 0 ? (s.avgCost * s.qty + t.price * t.qty) / (s.qty + t.qty) : t.price;
      s.qty += t.qty;
      if (t.reason) s.lastReason = t.reason;
      s.seg.push(t);
    } else {
      const sellQty = Math.min(t.qty, s.qty); // 超卖在 API 层已拒,这里兜底
      s.realized += (t.price - s.avgCost) * sellQty;
      s.qty -= sellQty;
      s.seg.push(t);
      if (s.qty <= 1e-9) {
        // 段清零 → 生成平仓段
        const buys = s.seg.filter((x) => x.side === "BUY");
        const sells = s.seg.filter((x) => x.side === "SELL");
        const buyAmt = buys.reduce((a, x) => a + x.price * x.qty, 0);
        const sellAmt = sells.reduce((a, x) => a + x.price * x.qty, 0);
        const openDate = buys[0]?.date || t.date;
        lots.push({
          lotId: t.id, market: t.market, sym: t.sym, name: s.name,
          openDate, closeDate: t.date, holdDays: dayDiff(openDate, t.date),
          buyAmt: r2(buyAmt), sellAmt: r2(sellAmt), realized: r2(sellAmt - buyAmt),
          retPct: buyAmt > 0 ? r2(((sellAmt - buyAmt) / buyAmt) * 100) : 0,
          trades: s.seg,
        });
        totalRealized.set(k, (totalRealized.get(k) || 0) + s.realized);
        s.qty = 0; s.avgCost = 0; s.realized = 0; s.seg = [];
      }
    }
    acc.set(k, s);
  }

  for (const [k, s] of acc) {
    if (s.qty <= 1e-9) continue;
    const [market, sym] = k.split("|") as [Market, string];
    positions.push({
      market, sym, name: s.name, qty: r2(s.qty), avgCost: r2(s.avgCost),
      invested: r2(s.qty * s.avgCost),
      realized: r2((totalRealized.get(k) || 0) + s.realized),
      firstDate: s.seg.find((x) => x.side === "BUY")?.date || "",
      lastReason: s.lastReason,
    });
  }
  positions.sort((a, b) => b.invested - a.invested);
  lots.sort((a, b) => b.closeDate.localeCompare(a.closeDate));
  return { positions, lots };
}

export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 校验一笔待录入的交易;返回错误信息或 null。sell 需不超过该标的当前持有量。 */
export function validateTrade(t: Partial<Trade>, existing: Trade[]): string | null {
  if (!t.market || !["us", "a", "hk"].includes(t.market)) return "market 不合法";
  if (!t.sym || !/^[A-Za-z0-9.\-]{1,12}$/.test(t.sym)) return "代码不合法";
  if (t.side !== "BUY" && t.side !== "SELL") return "side 不合法";
  if (!(typeof t.price === "number" && t.price > 0 && t.price < 1e7)) return "价格不合法";
  if (!(typeof t.qty === "number" && t.qty > 0 && t.qty < 1e9)) return "数量不合法";
  if (!t.date || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) return "日期不合法";
  if (t.side === "SELL") {
    const { positions } = aggregate(existing);
    const held = positions.find((p) => p.market === t.market && p.sym === t.sym)?.qty || 0;
    if (t.qty! > held + 1e-9) return `卖出 ${t.qty} 超过当前持有 ${held}`;
  }
  return null;
}
