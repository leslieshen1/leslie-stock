// K线情景推演核心:相似形态回测(纯代码,非 AI)+ 技术面快照。
// 思路:取最近 win 根日收益率作"当前形态",在该股全历史滑窗里找最相似的 topK 段,
// 统计这些段之后 fwd 日的真实走势 → 分位数锥。诚实边界:样本有限、历史相似≠未来,只做概率参考。

export type Candle = { d: string; o: number; h: number; l: number; c: number; v: number };

export type TechSnapshot = {
  price: number;
  chg5: number; chg20: number; chg60: number;          // 区间涨跌 %
  ma5: number; ma20: number; ma60: number;             // 均线值
  bollUp: number; bollMid: number; bollLow: number;    // BOLL(20,2)
  rsi14: number;
  macd: { dif: number; dea: number; hist: number };
  volR5: number;                                        // 最近5日均量 / 前20日均量
  hi52: number; lo52: number;                           // 52周高低
  posIn52: number;                                      // 现价在52周区间的位置 0-100
};

export type AnalogMatch = { endDate: string; sim: number; fwd: number[] }; // fwd = 未来各日累计涨跌 %

export type Backtest = {
  win: number; fwd: number; samples: number; topK: number;
  matches: AnalogMatch[];                               // 按相似度降序
  fan: { p10: number[]; p25: number[]; p50: number[]; p75: number[]; p90: number[] }; // 每个未来日的分位(累计 %)
  horizon: { upProb: number; median: number; mean: number; best: number; worst: number }; // 第 fwd 日
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function sma(vals: number[], p: number, i: number): number {
  let s = 0;
  for (let j = i - p + 1; j <= i; j++) s += vals[j];
  return s / p;
}

function ema(vals: number[], p: number): number[] {
  const k = 2 / (p + 1);
  const out: number[] = [];
  let prev = vals[0];
  for (let i = 0; i < vals.length; i++) {
    prev = i === 0 ? vals[0] : vals[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function techSnapshot(k: Candle[]): TechSnapshot {
  const c = k.map((x) => x.c);
  const n = c.length;
  const i = n - 1;
  const price = c[i];
  const chg = (p: number) => (n > p ? r2((price / c[i - p] - 1) * 100) : 0);
  const ma5 = r2(sma(c, Math.min(5, n), i));
  const ma20 = r2(sma(c, Math.min(20, n), i));
  const ma60 = r2(sma(c, Math.min(60, n), i));
  // BOLL(20,2)
  const p20 = c.slice(Math.max(0, n - 20));
  const mid = p20.reduce((a, b) => a + b, 0) / p20.length;
  const sd = Math.sqrt(p20.reduce((a, b) => a + (b - mid) ** 2, 0) / p20.length);
  // RSI14(Wilder)
  let gain = 0, loss = 0;
  const span = Math.min(14, n - 1);
  for (let j = n - span; j < n; j++) {
    const d = c[j] - c[j - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  const rsi = loss === 0 ? 100 : r2(100 - 100 / (1 + gain / loss));
  // MACD(12,26,9)
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const dif = c.map((_, j) => e12[j] - e26[j]);
  const dea = ema(dif, 9);
  // 量
  const v = k.map((x) => x.v);
  const v5 = sma(v, Math.min(5, n), i);
  const v20 = n > 25 ? sma(v, 20, i - 5) : v5;
  // 52周
  const yr = k.slice(Math.max(0, n - 250));
  const hi52 = Math.max(...yr.map((x) => x.h));
  const lo52 = Math.min(...yr.map((x) => x.l));
  return {
    price: r2(price), chg5: chg(5), chg20: chg(20), chg60: chg(60),
    ma5, ma20, ma60,
    bollUp: r2(mid + 2 * sd), bollMid: r2(mid), bollLow: r2(mid - 2 * sd),
    rsi14: rsi,
    macd: { dif: r2(dif[i]), dea: r2(dea[i]), hist: r2((dif[i] - dea[i]) * 2) },
    volR5: v20 > 0 ? r2(v5 / v20) : 1,
    hi52: r2(hi52), lo52: r2(lo52),
    posIn52: hi52 > lo52 ? Math.round(((price - lo52) / (hi52 - lo52)) * 100) : 50,
  };
}

/** 日收益率序列,z-score 归一化(比形状不比幅度的绝对值,但保留相对波动结构) */
function retVec(c: number[], from: number, len: number): number[] {
  const v: number[] = [];
  for (let j = from + 1; j <= from + len; j++) v.push(c[j] / c[j - 1] - 1);
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1e-9;
  return v.map((x) => (x - m) / sd);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1e-9);
}

const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return r2(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
};

export function analogBacktest(k: Candle[], win = 20, fwd = 10, topK = 30): Backtest | { error: string } {
  const c = k.map((x) => x.c);
  const n = c.length;
  if (n < win + fwd + 60) return { error: `历史数据不足(${n} 根,至少需要 ${win + fwd + 60} 根日线)` };

  const cur = retVec(c, n - 1 - win, win); // 当前窗口:最近 win 个收益率
  const cands: { end: number; sim: number }[] = [];
  // 历史滑窗:窗口末端 end,需留出 fwd 天前向数据,且与当前窗口不重叠
  for (let end = win; end <= n - 1 - fwd; end++) {
    if (end > n - 1 - win - fwd) break; // 避开与当前窗口重叠的近期段
    const vec = retVec(c, end - win, win);
    cands.push({ end, sim: cosine(cur, vec) });
  }
  if (!cands.length) return { error: "没有可比历史窗口" };
  cands.sort((a, b) => b.sim - a.sim);

  // 去重:相邻窗口(间隔 < win/2)只留相似度最高的一个,避免同一段行情重复计数
  const picked: { end: number; sim: number }[] = [];
  for (const cd of cands) {
    if (picked.length >= topK) break;
    if (picked.some((p) => Math.abs(p.end - cd.end) < win / 2)) continue;
    picked.push(cd);
  }

  const matches: AnalogMatch[] = picked.map((p) => {
    const base = c[p.end];
    const fwdPath: number[] = [];
    for (let t = 1; t <= fwd; t++) fwdPath.push(r2((c[p.end + t] / base - 1) * 100));
    return { endDate: k[p.end].d, sim: r2(p.sim), fwd: fwdPath };
  });

  const fan = { p10: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p90: [] as number[] };
  for (let t = 0; t < fwd; t++) {
    const col = matches.map((m) => m.fwd[t]).sort((a, b) => a - b);
    fan.p10.push(quantile(col, 0.1)); fan.p25.push(quantile(col, 0.25)); fan.p50.push(quantile(col, 0.5));
    fan.p75.push(quantile(col, 0.75)); fan.p90.push(quantile(col, 0.9));
  }
  const last = matches.map((m) => m.fwd[fwd - 1]);
  const sortedLast = [...last].sort((a, b) => a - b);
  return {
    win, fwd, samples: cands.length, topK: matches.length, matches, fan,
    horizon: {
      upProb: r2(last.filter((x) => x > 0).length / last.length),
      median: quantile(sortedLast, 0.5),
      mean: r2(last.reduce((a, b) => a + b, 0) / last.length),
      best: r2(Math.max(...last)), worst: r2(Math.min(...last)),
    },
  };
}
