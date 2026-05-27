// 三方评分：段永平 / 巴菲特 / Serenity (aleabit)
// 每个视角 4 个维度 × 25 = 100 分

import {
  type CompanyWithHeat,
  type Fundamentals,
  LAYERS,
} from "./supply-chain";

export interface DimensionScore {
  key: string;
  label: string;
  score: number;  // 0-25
  reason: string; // 简短归因
}

export interface PerspectiveScore {
  total: number;            // 0-100
  dims: DimensionScore[];   // 4 个维度
  tone: "buy" | "watch" | "avoid";
  oneLiner: string;
}

export interface TripleScore {
  duan: PerspectiveScore;
  buffett: PerspectiveScore;
  serenity: PerspectiveScore;
  consensus: number;        // min(三方)
  average: number;          // avg(三方)
  spread: number;           // max - min（分歧度）
  verdict: string;          // 综合判读
}

// ---- 工具 ----
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
/** 线性映射：x ∈ [a,b] → [out_a, out_b]，并 clamp */
function lerp(x: number | undefined | null, a: number, b: number, oa: number, ob: number): number {
  if (x == null || Number.isNaN(x)) return (oa + ob) / 2; // 数据缺失给中位
  const t = (x - a) / (b - a);
  return clamp(oa + t * (ob - oa), Math.min(oa, ob), Math.max(oa, ob));
}
function avail(f?: Fundamentals): f is Fundamentals {
  return !!f && Object.keys(f).length > 0;
}
function tone(total: number): "buy" | "watch" | "avoid" {
  if (total >= 65) return "buy";
  if (total >= 45) return "watch";
  return "avoid";
}

// ==================== 段永平 视角 ====================
// 核心信仰：商业模式 + 企业文化 + 合理估值。
// 维度：商业模式简单度 / 客户黏性 / 现金流质量 / 估值理性度
function scoreDuan(c: CompanyWithHeat): PerspectiveScore {
  const f = c.fundamentals;
  const dims: DimensionScore[] = [];

  // 1) 商业模式简单度 (0-25)
  // 段永平偏好：消费品 / 品牌 / OS / 网络效应 → AI 应用 / 终端 / 云稍好；半导体设备 / 周期股低分
  const layerScore = (() => {
    switch (c.layer) {
      case "L7": return 22; // 端侧入口（AAPL 类）最爱
      case "L5": return 18; // 云 + 模型 OS-level lockin
      case "L6": return 16; // 应用层
      case "L3": return 12; // AI 芯片（NVDA 例外但段永平避开）
      case "L0": return 10; // 能源
      case "L4": return 9;  // 数据中心硬件
      case "L1": return 7;  // 半导体设备（周期 + 资本密集）
      case "L2": return 7;  // 晶圆 / 封装 / HBM
      default:   return 12;
    }
  })();
  dims.push({
    key: "simplicity",
    label: "商业模式简单度",
    score: layerScore,
    reason: layerScore >= 18
      ? "OS / 品牌级生意，简单可懂"
      : layerScore >= 12
      ? "看得懂但有技术迭代风险"
      : "重资本 / 周期性 / 难评估终局",
  });

  // 2) 客户黏性 / 切换成本 (0-25)：用 moat (1-5) 直接换算
  const moatScore = c.moat * 5; // 5/10/15/20/25
  dims.push({
    key: "stickiness",
    label: "客户黏性",
    score: moatScore,
    reason: c.moat >= 4 ? "高切换成本 / 生态锁定" : c.moat === 3 ? "中等粘性" : "低粘性 / 易被替代",
  });

  // 3) 现金流质量 (0-25)：FCF margin + ROE
  let fcfDim = 12;
  let fcfReason = "现金流数据缺失";
  if (avail(f)) {
    const fcfM = f.fcfMargin ?? null;
    const roe = f.roe ?? null;
    const fcfPart = fcfM == null ? 7 : lerp(fcfM, 0, 0.30, 0, 14);  // 30% FCF margin 满分
    const roePart = roe == null ? 5 : lerp(roe, 0, 0.40, 0, 11);    // 40% ROE 满分
    fcfDim = Math.round(fcfPart + roePart);
    fcfReason = fcfM != null && roe != null
      ? `FCF margin ${(fcfM*100).toFixed(0)}% · ROE ${(roe*100).toFixed(0)}%`
      : "部分数据缺失";
  }
  dims.push({ key: "cashflow", label: "现金流质量", score: fcfDim, reason: fcfReason });

  // 4) 估值理性度 (0-25)：低 heat + 合理 fwd PE → 高分
  let valDim = 12;
  let valReason = "估值数据有限";
  if (avail(f) && f.forwardPE) {
    const fpe = f.forwardPE;
    // fwd PE: <15 满 25; 25 → 15; 50 → 5; >80 → 0
    const fpeScore = fpe < 15 ? 25 : fpe < 25 ? lerp(fpe, 15, 25, 25, 15)
                  : fpe < 50 ? lerp(fpe, 25, 50, 15, 5) : Math.max(0, lerp(fpe, 50, 100, 5, 0));
    // 再用 heat 扣分（短期过热）
    const heatPenalty = c.heat >= 85 ? -8 : c.heat >= 70 ? -4 : 0;
    valDim = clamp(Math.round(fpeScore + heatPenalty), 0, 25);
    valReason = `fwd PE ${fpe.toFixed(0)}x ${heatPenalty < 0 ? "· 短期过热扣分" : ""}`;
  } else {
    // fallback：用 heat 倒挂
    valDim = clamp(Math.round(25 - c.heat * 0.22), 0, 25);
    valReason = `仅用价格分位估算 (heat ${c.heat})`;
  }
  dims.push({ key: "valuation", label: "估值理性度", score: valDim, reason: valReason });

  const total = dims.reduce((s, d) => s + d.score, 0);
  const oneLiner = total >= 65
    ? "看得懂的好生意 + 合理估值，符合 Stop Doing"
    : total >= 45
    ? "生意尚可，但估值或粘性有让步"
    : "或不懂或太贵，列入 Stop Doing";
  return { total, dims, tone: tone(total), oneLiner };
}

// ==================== 巴菲特 视角 ====================
// 核心信仰：经济护城河 + 长期 ROE + 可预测性 + 资本配置
function scoreBuffett(c: CompanyWithHeat): PerspectiveScore {
  const f = c.fundamentals;
  const dims: DimensionScore[] = [];

  // 1) 经济护城河 (0-25)
  const moatScore = c.moat * 5;
  dims.push({
    key: "moat",
    label: "经济护城河",
    score: moatScore,
    reason: c.moat >= 4 ? "强护城河（品牌/规模/网络）" : c.moat === 3 ? "中等护城河" : "薄护城河 / 易被颠覆",
  });

  // 2) ROE / ROA / 长期回报率 (0-25)
  let roeDim = 12;
  let roeReason = "回报数据缺失";
  if (avail(f) && f.roe != null) {
    const roe = f.roe;
    // 0% → 0, 15% → 13, 30% → 22, 50%+ → 25
    const roeScore = roe < 0 ? 0 : roe < 0.15 ? lerp(roe, 0, 0.15, 0, 13)
                  : roe < 0.30 ? lerp(roe, 0.15, 0.30, 13, 22) : Math.min(25, lerp(roe, 0.30, 0.50, 22, 25));
    roeDim = Math.round(roeScore);
    roeReason = `ROE ${(roe * 100).toFixed(0)}%`;
  }
  dims.push({ key: "roe", label: "ROE / 长期回报", score: roeDim, reason: roeReason });

  // 3) 收益可预测性 (0-25)：营收 + 盈利稳定性的代理 (用 profit margin + low D/E)
  let predDim = 12;
  let predReason = "盈利质量数据有限";
  if (avail(f)) {
    const pm = f.profitMargin ?? 0.1;
    const de = f.debtToEquity ?? 80;
    const pmPart = pm < 0 ? 0 : lerp(pm, 0, 0.40, 0, 15); // 40% 利润率满分
    // D/E < 50 好；> 200 差
    const dePart = de < 30 ? 10 : de < 80 ? lerp(de, 30, 80, 10, 5)
                : de < 200 ? lerp(de, 80, 200, 5, 0) : 0;
    predDim = Math.round(pmPart + dePart);
    predReason = `净利率 ${(pm*100).toFixed(0)}% · D/E ${de.toFixed(0)}`;
  }
  dims.push({ key: "predictability", label: "收益可预测性", score: predDim, reason: predReason });

  // 4) 价格合理性 (0-25)：买好公司也要合理价格
  let priceDim = 12;
  let priceReason = "估值数据有限";
  if (avail(f) && (f.trailingPE || f.forwardPE)) {
    const pe = f.forwardPE ?? f.trailingPE!;
    // 巴菲特更严苛：fwd PE < 12 满分；> 40 0
    const peScore = pe < 12 ? 25 : pe < 20 ? lerp(pe, 12, 20, 25, 18)
                : pe < 30 ? lerp(pe, 20, 30, 18, 10) : pe < 50 ? lerp(pe, 30, 50, 10, 2) : 2;
    priceDim = Math.round(peScore);
    priceReason = `fwd/trail PE ${pe.toFixed(0)}x`;
  } else {
    priceDim = clamp(Math.round(25 - c.heat * 0.22), 0, 25);
    priceReason = `估值粗估 (heat ${c.heat})`;
  }
  dims.push({ key: "price", label: "价格合理性", score: priceDim, reason: priceReason });

  const total = dims.reduce((s, d) => s + d.score, 0);
  const oneLiner = total >= 65
    ? "Wonderful business at fair price"
    : total >= 45
    ? "好公司但价格不便宜，等回调"
    : "护城河或回报率不达标";
  return { total, dims, tone: tone(total), oneLiner };
}

// ==================== Serenity (aleabit) 视角 ====================
// 核心信仰：供应链瓶颈狙击 — 谁不可替代谁定价
function scoreSerenity(c: CompanyWithHeat): PerspectiveScore {
  const f = c.fundamentals;
  const dims: DimensionScore[] = [];

  // 1) 产业链瓶颈位置 (0-25)：layer.bottleneck × 5
  const layer = LAYERS.find(L => L.id === c.layer)!;
  const bottleScore = layer.bottleneck * 5;
  dims.push({
    key: "chokepoint",
    label: "产业链瓶颈位置",
    score: bottleScore,
    reason: layer.bottleneck >= 4 ? `${layer.name} · 高瓶颈层` : `${layer.name} · 一般层级`,
  });

  // 2) 产能 / 定价权 (0-25)：用毛利率代理（定价权高 → 毛利高）
  let pricingDim = 12;
  let pricingReason = "定价数据缺失";
  if (avail(f) && f.grossMargin != null) {
    const gm = f.grossMargin;
    // 30% → 8, 50% → 18, 70%+ → 25
    const gmScore = gm < 0.20 ? 4 : gm < 0.40 ? lerp(gm, 0.20, 0.40, 4, 13)
                  : gm < 0.60 ? lerp(gm, 0.40, 0.60, 13, 21) : Math.min(25, lerp(gm, 0.60, 0.80, 21, 25));
    pricingDim = Math.round(gmScore);
    pricingReason = `毛利率 ${(gm*100).toFixed(0)}%（定价权代理）`;
  } else if (avail(f) && f.operatingMargin != null) {
    const om = f.operatingMargin;
    pricingDim = Math.round(clamp(lerp(om, 0, 0.40, 0, 25), 0, 25));
    pricingReason = `经营利润率 ${(om*100).toFixed(0)}%（兜底）`;
  }
  dims.push({ key: "pricing", label: "产能 / 定价权", score: pricingDim, reason: pricingReason });

  // 3) 不可替代性 (0-25)：moat × 4 + 小市值偏好加分（≤ $50B）
  let irreScore = c.moat * 4;
  if (c.marketCapB <= 30) irreScore += 5;
  else if (c.marketCapB <= 80) irreScore += 2;
  irreScore = clamp(irreScore, 0, 25);
  dims.push({
    key: "irreplaceable",
    label: "客户依赖 / 不可替代",
    score: irreScore,
    reason: c.marketCapB <= 50
      ? "中小盘 + 不可替代加分"
      : c.moat >= 4 ? "护城河强但已被广泛持有" : "可替代性较高",
  });

  // 4) Catalyst + 财务趋势 (0-25)：营收增长 + 短期动量
  let catDim = 12;
  let catReason = "趋势数据缺失";
  if (avail(f) && f.revenueGrowth != null) {
    const rg = f.revenueGrowth;
    // 0% → 5, 30% → 15, 80%+ → 25
    const rgScore = rg < 0 ? 0 : rg < 0.10 ? lerp(rg, 0, 0.10, 0, 6)
                  : rg < 0.30 ? lerp(rg, 0.10, 0.30, 6, 15) : Math.min(20, lerp(rg, 0.30, 0.80, 15, 20));
    // 短期动量加分
    const momPart = lerp(c.momentum20d, 0, 100, -2, 5);
    catDim = clamp(Math.round(rgScore + momPart), 0, 25);
    catReason = `营收 +${(rg*100).toFixed(0)}% · 20D 动量分位 ${c.momentum20d}`;
  } else {
    // 兜底：用 momentum + sentiment
    catDim = Math.round(lerp(c.momentum20d * 0.6 + c.sentiment * 0.4, 0, 100, 0, 25));
    catReason = `动量+情绪 兜底`;
  }
  dims.push({ key: "catalyst", label: "Catalyst / 财务趋势", score: catDim, reason: catReason });

  const total = dims.reduce((s, d) => s + d.score, 0);
  const oneLiner = total >= 65
    ? "卡位 + 定价权 + 趋势 三点共振"
    : total >= 45
    ? "有瓶颈位置，但定价权或催化剂不足"
    : "非真瓶颈 / 没有 alpha 空间";
  return { total, dims, tone: tone(total), oneLiner };
}

// ==================== 综合 ====================
export function tripleScore(c: CompanyWithHeat): TripleScore {
  const duan = scoreDuan(c);
  const buf = scoreBuffett(c);
  const ser = scoreSerenity(c);
  const consensus = Math.min(duan.total, buf.total, ser.total);
  const average = Math.round((duan.total + buf.total + ser.total) / 3);
  const spread = Math.max(duan.total, buf.total, ser.total) - consensus;

  let verdict: string;
  if (consensus >= 60 && spread <= 18) {
    verdict = "三方共识好资产 — 核心仓候选";
  } else if (average >= 60 && spread > 25) {
    verdict = "三方分歧大 — 各方逻辑各异，看你信哪派";
  } else if (average >= 55) {
    verdict = "中性 — 至少一派强烈支持，需自行判断";
  } else if (Math.max(duan.total, buf.total, ser.total) < 45) {
    verdict = "三方均不看好 — 跳过";
  } else {
    verdict = "仅 1 派支持 — 风险敞口偏大";
  }

  return { duan, buffett: buf, serenity: ser, consensus, average, spread, verdict };
}
