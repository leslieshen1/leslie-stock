// K线情景推演核心:相似形态回测(纯代码,非 AI)+ 技术面快照。
// 思路:取最近 win 根日收益率作"当前形态",在该股全历史滑窗里找最相似的 topK 段,
// 统计这些段之后 fwd 日的真实走势 → 分位数锥。诚实边界:样本有限、历史相似≠未来,只做概率参考。

export type Candle = { d: string; o: number; h: number; l: number; c: number; v: number };

export type TechSnapshot = {
  price: number;
  chg5: number; chg20: number; chg60: number;          // 区间涨跌 %
  ma5: number; ma20: number; ma60: number;             // 均线值
  maAlign: "bull" | "bear" | "mixed";                   // 均线多空排列(趋势维度)
  bollUp: number; bollMid: number; bollLow: number;    // BOLL(20,2)
  bollW: number;                                        // 布林带宽 %(收口/开口=波动预期)
  rsi14: number;
  macd: { dif: number; dea: number; hist: number };
  atrPct: number;                                       // ATR14/price %(近期真实波动幅度)
  histVol: number;                                      // 20日历史波动率(年化 %)
  volR5: number;                                        // 最近5日均量 / 前20日均量(量能)
  obvUp: boolean;                                       // OBV 近10日斜率为正(量能是否在推价)
  volPrice: string;                                     // 量价配合:放量涨/缩量涨/放量跌/缩量跌…
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
  const volR5 = v20 > 0 ? r2(v5 / v20) : 1;
  // ATR14(真实波幅):衡量近期波动的绝对幅度
  let tr = 0; const atrSpan = Math.min(14, n - 1);
  for (let j = n - atrSpan; j < n; j++) tr += Math.max(k[j].h - k[j].l, Math.abs(k[j].h - k[j - 1].c), Math.abs(k[j].l - k[j - 1].c));
  const atrPct = r2((tr / atrSpan / price) * 100);
  // 20日历史波动率(年化):日收益标准差 × √252
  const rets: number[] = [];
  for (let j = Math.max(1, n - 20); j < n; j++) rets.push(c[j] / c[j - 1] - 1);
  const rm = rets.reduce((a, b) => a + b, 0) / rets.length;
  const histVol = r2(Math.sqrt(rets.reduce((a, b) => a + (b - rm) ** 2, 0) / rets.length) * Math.sqrt(252) * 100);
  // OBV 能量潮:近10日斜率方向(量能是否在推价)
  let obv = 0; const obvSeq: number[] = [];
  for (let j = 1; j < n; j++) { obv += c[j] > c[j - 1] ? v[j] : c[j] < c[j - 1] ? -v[j] : 0; obvSeq.push(obv); }
  const obvUp = obvSeq.length > 10 ? obvSeq[obvSeq.length - 1] > obvSeq[obvSeq.length - 11] : false;
  // 量价配合:最近一根 K 的涨跌 × 放缩量
  const lastUp = c[i] >= c[i - 1];
  const volPrice = `${volR5 >= 1.15 ? "放量" : volR5 <= 0.85 ? "缩量" : "平量"}${lastUp ? "涨" : "跌"}`;
  // 均线多空排列(趋势维度)
  const maAlign: "bull" | "bear" | "mixed" = ma5 > ma20 && ma20 > ma60 ? "bull" : ma5 < ma20 && ma20 < ma60 ? "bear" : "mixed";
  // 52周
  const yr = k.slice(Math.max(0, n - 250));
  const hi52 = Math.max(...yr.map((x) => x.h));
  const lo52 = Math.min(...yr.map((x) => x.l));
  return {
    price: r2(price), chg5: chg(5), chg20: chg(20), chg60: chg(60),
    ma5, ma20, ma60, maAlign,
    bollUp: r2(mid + 2 * sd), bollMid: r2(mid), bollLow: r2(mid - 2 * sd),
    bollW: mid > 0 ? r2((4 * sd / mid) * 100) : 0,
    rsi14: rsi,
    macd: { dif: r2(dif[i]), dea: r2(dea[i]), hist: r2((dif[i] - dea[i]) * 2) },
    atrPct, histVol, volR5, obvUp, volPrice,
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

// ---- 样本外滚动回测(walk-forward):检验"相似形态"这套方法本身准不准 ----
// 站在历史每个时间点 t 只用 [0,t] 数据做预测(严格遮住未来),再揭开 t+fwd 真实结果比对,
// 全历史滚动几百次 → 方向命中率、与"闭眼押多数方向"基准的超额、概率锥校准度。诚实呈现,不粉饰。
export type Validation = {
  points: number;       // 有效回测点数
  dirAcc: number;       // 方向命中率(预测中位方向 vs 实际)
  baseUpRate: number;   // 历史 fwd 日上涨的自然频率
  naiveBest: number;    // 基准:闭眼永远押多数方向的命中率
  edge: number;         // dirAcc − naiveBest,>0 才算方法有方向价值
  cover80: number;      // 实际落在预测 p10~p90 内的比例(理想≈0.80,校准度)
  cover50: number;      // 实际落在 p25~p75 内的比例(理想≈0.50)
  mae: number;          // 预测中位 vs 实际的平均绝对误差 %
  verdict: string;      // 一句诚实结论
};

export function walkForwardValidate(k: Candle[], win = 20, fwd = 10, step = 3): Validation | { error: string } {
  const c = k.map((x) => x.c);
  const n = c.length;
  const warmup = win + fwd + 60; // analogBacktest 起跑所需最少历史
  if (n < warmup + 30) return { error: `历史不足以做样本外回测(${n} 根)` };

  let pts = 0, dirHit = 0, up = 0, in80 = 0, in50 = 0, aeSum = 0;
  for (let t = warmup; t <= n - 1 - fwd; t += step) {
    const bt = analogBacktest(k.slice(0, t + 1), win, fwd, 30); // 只喂 t 及之前
    if ("error" in bt) continue;
    const actual = (c[t + fwd] / c[t] - 1) * 100; // 揭开:真实 fwd 日收益
    const predMid = bt.fan.p50[fwd - 1];
    pts++;
    if (actual > 0) up++;
    if ((predMid >= 0) === (actual >= 0)) dirHit++;
    if (actual >= bt.fan.p10[fwd - 1] && actual <= bt.fan.p90[fwd - 1]) in80++;
    if (actual >= bt.fan.p25[fwd - 1] && actual <= bt.fan.p75[fwd - 1]) in50++;
    aeSum += Math.abs(actual - predMid);
  }
  if (pts < 20) return { error: `有效回测点太少(${pts})` };

  const dirAcc = dirHit / pts;
  const baseUpRate = up / pts;
  const naiveBest = Math.max(baseUpRate, 1 - baseUpRate);
  const edge = dirAcc - naiveBest;
  const cover80 = in80 / pts, cover50 = in50 / pts;

  const pct = (x: number) => (x * 100).toFixed(0);
  let verdict: string;
  if (edge >= 0.05) verdict = `方向命中 ${pct(dirAcc)}%,比"闭眼押多数方向"(${pct(naiveBest)}%)高 ${pct(edge)} 个点——这只票上形态有一定方向参考力。`;
  else if (edge <= 0.01) verdict = `方向命中 ${pct(dirAcc)}% ≈ 基准 ${pct(naiveBest)}%,形态匹配几乎没跑赢闭眼押方向——别把方向当信号,只看它给出的波动范围。`;
  else verdict = `方向仅比基准高 ${pct(edge)} 个点,优势很薄,当弱参考。`;
  if (cover80 < 0.72) verdict += ` 而且概率锥偏窄:真实只有 ${pct(cover80)}% 落在"80%"区间内(该有 80%),它系统性低估了尾部风险,别把锥的边界当铁顶铁底。`;
  else if (cover80 > 0.95) verdict += ` 概率锥偏宽,信息量有限。`;
  else verdict += ` 概率区间校准尚可(80% 区间实测覆盖 ${pct(cover80)}%)。`;

  return {
    points: pts, dirAcc: r2(dirAcc), baseUpRate: r2(baseUpRate), naiveBest: r2(naiveBest),
    edge: r2(edge), cover80: r2(cover80), cover50: r2(cover50), mae: r2(aeSum / pts), verdict,
  };
}
