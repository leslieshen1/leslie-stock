// 个人持仓系统核心:流水 → 持仓聚合(加权平均成本)+ 平仓段(lot)检测。
// 数据全存 Upstash(sg:pf: 前缀,私密,Bearer STATS_TOKEN 才可读写);纯函数在此,方便前后端共用。
// 单用户工具:流水量小,每类数据一个 key(JSON 字符串),读写各 1 命令,配额友好。

export type Market = "us" | "a" | "hk" | "perp"; // perp = 合约板块(USDT 本位永续,≈$,支持多空+杠杆)
export type Side = "BUY" | "SELL";
export type Dir = "LONG" | "SHORT";

export type Trade = {
  id: string;          // t + ts36,录入时生成
  market: Market;
  sym: string;         // 美股 ticker / A股6位 / 港股数字 / 合约标的
  name?: string;
  side: Side;          // 现货:买/卖;合约:BUY=开仓、SELL=平仓(价格都是真实成交价)
  price: number;
  qty: number;
  date: string;        // YYYY-MM-DD(成交日)
  reason?: string;     // 买/卖理由 —— 复盘的原料
  ts: number;          // 录入时间戳(排序用)
  dir?: Dir;           // 仅合约:方向(空单盈亏自动反向)
  lev?: number;        // 仅合约:杠杆倍数(展示与复盘用;盈亏额由价差×数量决定,与杠杆无关)
};

export type Position = {
  market: Market;
  sym: string;
  name: string;
  qty: number;
  avgCost: number;     // 加权平均成本(合约=开仓均价;卖出不摊薄)
  invested: number;    // qty * avgCost(合约=名义开仓额)
  realized: number;    // 该标的累计已实现盈亏(含历史平仓段;空单已反向)
  firstDate: string;   // 当前持仓段的首笔买入日
  lastReason: string;  // 最近一笔买入理由(表格里展示)
  dir?: Dir;           // 仅合约:当前段方向
  lev?: number;        // 仅合约:杠杆
};

// 平仓段:从某段首笔 BUY 到把数量清零的那笔 SELL,一个完整的"一笔操作"——复盘的单位。
export type ClosedLot = {
  lotId: string;       // = 清零那笔 SELL 的 trade id
  market: Market;
  sym: string;
  name: string;
  openDate: string;    // 段首笔买入(开仓)日
  closeDate: string;   // 清零卖出(平仓)日
  holdDays: number;
  buyAmt: number;      // 段内开仓总额(名义)
  sellAmt: number;     // 段内平仓总额
  realized: number;    // 多/现货 = sellAmt-buyAmt;空单 = buyAmt-sellAmt
  retPct: number;      // realized / buyAmt * 100(价差口径;保证金收益 = retPct × lev)
  trades: Trade[];     // 段内全部流水(复盘时给 AI 看)
  dir?: Dir;
  lev?: number;
};

export const CCY: Record<Market, string> = { us: "$", a: "¥", hk: "HK$", perp: "$" };

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
  const acc = new Map<string, { qty: number; avgCost: number; realized: number; seg: Trade[]; name: string; lastReason: string; dir?: Dir; lev?: number }>();
  const positions: Position[] = [];
  const lots: ClosedLot[] = [];
  const totalRealized = new Map<string, number>(); // key → 含历史段的累计已实现

  for (const t of sorted) {
    const k = `${t.market}|${t.sym}`;
    const s = acc.get(k) || { qty: 0, avgCost: 0, realized: 0, seg: [], name: t.name || t.sym, lastReason: "" as string, dir: undefined as Dir | undefined, lev: undefined as number | undefined };
    if (t.name) s.name = t.name;
    if (t.side === "BUY") {
      if (s.qty <= 1e-9) { s.dir = t.dir; s.lev = t.lev; } // 段首笔开仓定方向/杠杆
      else { if (t.dir) s.dir = t.dir; if (t.lev) s.lev = t.lev; }
      s.avgCost = s.qty + t.qty > 0 ? (s.avgCost * s.qty + t.price * t.qty) / (s.qty + t.qty) : t.price;
      s.qty += t.qty;
      if (t.reason) s.lastReason = t.reason;
      s.seg.push(t);
    } else {
      const preSell = s.qty; // 卖出前持仓,判碎股尾巴用
      const sellQty = Math.min(t.qty, s.qty); // 超卖在 API 层已拒,这里兜底
      const short = t.market === "perp" && s.dir === "SHORT";
      s.realized += (short ? s.avgCost - t.price : t.price - s.avgCost) * sellQty; // 空单反向
      s.qty -= sellQty;
      s.seg.push(t);
      // 碎股尾巴:美股/合约支持小数股,手填卖出量几乎不可能与买入精确对齐,常留极小残留(如买 4.2718 卖 4.27)。
      // 剩余不足 1 股且占卖前持仓不到 0.5% → 视同卖清,并入本平仓段(A股整数股天然不触发)。
      const dust = s.qty > 1e-9 && s.qty < 1 && s.qty < preSell * 0.005;
      if (s.qty <= 1e-9 || dust) {
        // 段清零 → 生成平仓段
        const buys = s.seg.filter((x) => x.side === "BUY");
        const sells = s.seg.filter((x) => x.side === "SELL");
        const buyAmt = buys.reduce((a, x) => a + x.price * x.qty, 0);
        const sellAmt = sells.reduce((a, x) => a + x.price * x.qty, 0);
        const openDate = buys[0]?.date || t.date;
        const realized = short ? buyAmt - sellAmt : sellAmt - buyAmt;
        lots.push({
          lotId: t.id, market: t.market, sym: t.sym, name: s.name,
          openDate, closeDate: t.date, holdDays: dayDiff(openDate, t.date),
          buyAmt: r2(buyAmt), sellAmt: r2(sellAmt), realized: r2(realized),
          retPct: buyAmt > 0 ? r2((realized / buyAmt) * 100) : 0,
          trades: s.seg, dir: s.dir, lev: s.lev,
        });
        totalRealized.set(k, (totalRealized.get(k) || 0) + s.realized);
        s.qty = 0; s.avgCost = 0; s.realized = 0; s.seg = []; s.dir = undefined; s.lev = undefined;
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
      dir: s.dir, lev: s.lev,
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
  if (!t.market || !["us", "a", "hk", "perp"].includes(t.market)) return "market 不合法";
  if (!t.sym || !/^[A-Za-z0-9.\-]{1,12}$/.test(t.sym)) return "代码不合法";
  if (t.side !== "BUY" && t.side !== "SELL") return "side 不合法";
  if (t.market === "perp" && t.side === "BUY" && t.dir !== "LONG" && t.dir !== "SHORT") return "合约开仓需指定方向(LONG/SHORT)";
  if (t.lev != null && !(typeof t.lev === "number" && t.lev >= 1 && t.lev <= 200)) return "杠杆不合法";
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
