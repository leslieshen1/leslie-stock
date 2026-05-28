// 每个 industry 的独立产业链结构（layers + ticker→layer 映射）
//
// AI 已有 LAYERS (L0-L7) 在 supply-chain.ts。其他 industry 在这里定义自己的 layer 结构：
//   - rare-metals: 4 层（矿山 → 冶炼 → 深加工 → 应用）
//   - humanoid:    6 层（永磁 / 减速器 / 丝杠关节 / 伺服电机 / 传感器 / 整机）
//   - defense:     5 层（特材 / 航发 / 军用电子 / 武器 UAV / 整机）
//   - biotech:     5 层（生物试剂 / API / 创新药 / CRO·CDMO / 医械）
//
// 每个 industry 自己的 layer id 用 namespace 前缀（RM- / HM- / DF- / BT-）避免和 AI 的 L0-L7 冲突。

import type { Layer, IndustryId, CompanyWithHeat } from "./supply-chain";

export interface IndustryLayer extends Omit<Layer, "id"> {
  id: string; // 不强制 LayerId，每个 industry 自己的命名空间
}

// ============================================================
// 各 industry 的 layer 结构
// ============================================================

export const RARE_METALS_LAYERS: IndustryLayer[] = [
  { id: "RM-U", name: "上游 · 矿山", nameEn: "Upstream · Mining",
    importance: 5, bottleneck: 5,
    summary: "稀土 / 锗 / 钨 / 锡 / 钼 / 铜钴 / 黄金（资源 chokepoint）" },
  { id: "RM-M", name: "中游 · 冶炼提纯", nameEn: "Midstream · Refining",
    importance: 4, bottleneck: 4,
    summary: "粗炼 → 5N / 6N 高纯，技术 + 环保双重门槛" },
  { id: "RM-D", name: "下游 · 深加工", nameEn: "Downstream · Processing",
    importance: 5, bottleneck: 5,
    summary: "合金 / 化合物 / 单晶 / 衬底 / 靶材（高附加值）" },
  { id: "RM-A", name: "应用 · 终端", nameEn: "Application · End-use",
    importance: 4, bottleneck: 3,
    summary: "光通信衬底 / 红外军工 / MRI / 航发零部件" },
];

export const HUMANOID_LAYERS: IndustryLayer[] = [
  { id: "HM-1", name: "永磁材料", nameEn: "Permanent Magnets",
    importance: 5, bottleneck: 5,
    summary: "钕铁硼 / 烧结永磁 — 关节扭矩底座" },
  { id: "HM-2", name: "减速器", nameEn: "Reducers",
    importance: 5, bottleneck: 5,
    summary: "谐波（小臂）+ RV（大关节）— 全球被日企垄断" },
  { id: "HM-3", name: "丝杠 · 关节", nameEn: "Ball/Roller Screws · Joints",
    importance: 5, bottleneck: 5,
    summary: "行星滚柱丝杠 — Tesla Optimus 28 个 / 台" },
  { id: "HM-4", name: "伺服 · 电机", nameEn: "Servo · Motors",
    importance: 4, bottleneck: 3,
    summary: "无框力矩 / 直驱电机 + 驱动器" },
  { id: "HM-5", name: "传感器", nameEn: "Sensors",
    importance: 4, bottleneck: 4,
    summary: "六维力 / 视觉 / IMU / 触觉" },
  { id: "HM-6", name: "整机 · 总成", nameEn: "Integrators",
    importance: 5, bottleneck: 2,
    summary: "Tesla / Figure / 1X / 小鹏 / 优必选" },
];

export const DEFENSE_LAYERS: IndustryLayer[] = [
  { id: "DF-M", name: "特种材料", nameEn: "Specialty Materials",
    importance: 5, bottleneck: 5,
    summary: "钛合金 / 高温合金 / 隐身材料 / 复合材料" },
  { id: "DF-P", name: "动力 · 航发", nameEn: "Propulsion · Aero-Engine",
    importance: 5, bottleneck: 5,
    summary: "航发整机 / 叶片 / 锻造 — 国产替代核心" },
  { id: "DF-E", name: "军用电子", nameEn: "Military Electronics",
    importance: 5, bottleneck: 4,
    summary: "雷达 / T-R 芯片 / IMU / 特种 IC / 红外探测" },
  { id: "DF-W", name: "武器 · UAV", nameEn: "Weapons · UAV",
    importance: 4, bottleneck: 3,
    summary: "导弹 / 无人机 / 含能材料 / 制导" },
  { id: "DF-S", name: "整机 · 平台", nameEn: "Platforms · OEM",
    importance: 4, bottleneck: 2,
    summary: "战机 / 直升机 / 运输机 / 舰船 总装" },
];

export const BIOTECH_LAYERS: IndustryLayer[] = [
  { id: "BT-R", name: "生物试剂 · 上游", nameEn: "Reagents · Upstream",
    importance: 4, bottleneck: 4,
    summary: "培养基 / 酶 / 抗体 / 重组蛋白（mRNA 上游）" },
  { id: "BT-A", name: "API · 原料药", nameEn: "Active Pharmaceutical Ingredients",
    importance: 3, bottleneck: 3,
    summary: "甾体 / 维生素 / 造影剂 / 特色 API" },
  { id: "BT-D", name: "创新药 · 研发", nameEn: "Drug Discovery",
    importance: 5, bottleneck: 3,
    summary: "ADC / 双抗 / 小分子 / 核药 / 血制品" },
  { id: "BT-C", name: "CRO / CDMO", nameEn: "CRO / CDMO",
    importance: 4, bottleneck: 3,
    summary: "外包研发 + 外包生产（一体化平台）" },
  { id: "BT-V", name: "医械 · 设备", nameEn: "Medical Devices",
    importance: 4, bottleneck: 4,
    summary: "影像（CT/MRI/超声）/ 植入 / IVD / 测序仪 / 内镜" },
];

// ============================================================
// Industry → Layers 查找
// ============================================================

export const INDUSTRY_LAYERS: Record<Exclude<IndustryId, "AI">, IndustryLayer[]> = {
  "rare-metals": RARE_METALS_LAYERS,
  "humanoid": HUMANOID_LAYERS,
  "defense": DEFENSE_LAYERS,
  "biotech": BIOTECH_LAYERS,
};

// ============================================================
// 每个 industry 的 ticker → layer mapping（手动维护）
// 从 INDUSTRIES.tickers 派生 + 深度分析时补充
// ============================================================

export const RARE_METALS_TICKER_LAYER: Record<string, string> = {
  // 上游矿山
  "000831": "RM-U", // 中国稀土
  "600392": "RM-U", // 盛和资源
  "600301": "RM-U", // 华锡有色（锡矿）
  "000960": "RM-U", // 锡业股份
  "002155": "RM-U", // 湖南黄金
  "601899": "RM-U", // 紫金矿业（铜金多金属）
  "600988": "RM-U", // 赤峰黄金
  "603993": "RM-U", // 洛阳钼业
  // 中游冶炼
  "600259": "RM-M", // 中稀有色（稀土冶炼）
  "600497": "RM-M", // 驰宏锌锗
  "603799": "RM-M", // 华友钴业
  "300618": "RM-M", // 寒锐钴业
  // 下游深加工
  "002428": "RM-D", // 云南锗业（InP / 锗深加工）⭐ 深度分析
  "002378": "RM-D", // 章源钨业
  "002842": "RM-D", // 翔鹭钨业
  "000657": "RM-D", // 中钨高新
  "000962": "RM-D", // 东方钽业
  "600459": "RM-D", // 贵研铂业
  "600160": "RM-D", // 巨化股份（氟化）
  "002709": "RM-D", // 天赐材料（锂电材料）
};

export const HUMANOID_TICKER_LAYER: Record<string, string> = {
  // 永磁
  "000831": "HM-1", // 中国稀土（也在 rare-metals）
  "000970": "HM-1", // 中科三环
  "300748": "HM-1", // 金力永磁
  "300127": "HM-1", // 银河磁体
  "600366": "HM-1", // 宁波韵升
  // 减速器
  "688017": "HM-2", // 绿的谐波
  "002472": "HM-2", // 双环传动（减速器齿轮）
  // 丝杠 / 关节
  "002050": "HM-3", // 三花智控
  "601689": "HM-3", // 拓普集团
  // 伺服 / 电机
  "601877": "HM-4", // 正泰电器
  // 传感器
  "300553": "HM-5", // 集智股份
  "688322": "HM-5", // 奥比中光-W
  "688686": "HM-5", // 奥普特
  "688400": "HM-5", // 凌云光
  // 整机
  "TSLA":   "HM-6", // 特斯拉 Optimus
};

export const DEFENSE_TICKER_LAYER: Record<string, string> = {
  // 特种材料
  "688122": "DF-M", // 西部超导 ⭐ 深度分析
  "688708": "DF-M", // 佳驰科技（吸波）
  "688281": "DF-M", // 华秦科技
  "300034": "DF-M", // 钢研高纳（高温合金）
  "300855": "DF-M", // 图南股份
  "688563": "DF-M", // 航材股份
  "688231": "DF-M", // 隆达股份
  // 航发
  "600893": "DF-P", // 航发动力
  "600765": "DF-P", // 中航重机（锻造）
  "688510": "DF-P", // 航亚科技
  "688237": "DF-P", // 超卓航科
  "300775": "DF-P", // 三角防务（锻件）
  // 军用电子
  "688522": "DF-E", // 纳睿雷达
  "600562": "DF-E", // 国睿科技
  "002025": "DF-E", // 航天电器
  "688582": "DF-E", // 芯动联科 IMU
  "003031": "DF-E", // 中瓷电子
  "002049": "DF-E", // 紫光国微
  "000733": "DF-E", // 振华科技
  "688709": "DF-E", // 成都华微
  "603712": "DF-E", // 七一二
  "001270": "DF-E", // 铖昌科技
  "300447": "DF-E", // 全信股份
  "688682": "DF-E", // 霍莱沃
  "688002": "DF-E", // 睿创微纳
  "688272": "DF-E", // 富吉瑞
  "300516": "DF-E", // 久之洋
  "002414": "DF-E", // 高德红外（也算 W）
  // 武器 / UAV
  "002389": "DF-W", // 航天彩虹
  "688297": "DF-W", // 中无人机
  "002246": "DF-W", // 北化股份（含能材料）
  // 整机
  "600038": "DF-S", // 中直股份
  "302132": "DF-S", // 中航成飞
  "000768": "DF-S", // 中航西飞
  "600372": "DF-S", // 中航机载
};

export const BIOTECH_TICKER_LAYER: Record<string, string> = {
  // 生物试剂 / 上游
  "688293": "BT-R", // 奥浦迈（培养基）
  "688137": "BT-R", // 近岸蛋白（mRNA 原料酶）
  // API
  "300401": "BT-A", // 花园生物（VD3 API）
  // 创新药 / 研发
  "688506": "BT-D", // 百利天恒（ADC）
  "688278": "BT-D", // 特宝生物
  "002675": "BT-D", // 东诚药业（核药）
  "688331": "BT-D", // 荣昌生物（ADC）
  "600161": "BT-D", // 天坛生物（血制品）
  "002252": "BT-D", // 上海莱士（血制品）
  "000403": "BT-D", // 派林生物（血制品）
  // CRO / CDMO（占位 — 后续补）
  // 医械
  "688271": "BT-V", // 联影医疗
  "688114": "BT-V", // 华大智造
  "688617": "BT-V", // 惠泰医疗
  "688050": "BT-V", // 爱博医疗
  "688212": "BT-V", // 澳华内镜
  "688301": "BT-V", // 奕瑞科技
};

export const INDUSTRY_TICKER_LAYER: Record<Exclude<IndustryId, "AI">, Record<string, string>> = {
  "rare-metals": RARE_METALS_TICKER_LAYER,
  "humanoid":    HUMANOID_TICKER_LAYER,
  "defense":     DEFENSE_TICKER_LAYER,
  "biotech":     BIOTECH_TICKER_LAYER,
};

// ============================================================
// Helpers
// ============================================================

export function getLayersFor(industry: IndustryId): IndustryLayer[] | null {
  if (industry === "AI") return null; // 调用方用 supply-chain.LAYERS
  return INDUSTRY_LAYERS[industry] ?? null;
}

/** 返回这只票在指定 industry 视角下的 layer id；不在产业链里 = null（PulseField 应隐藏它）。 */
export function getCompanyLayerInIndustry(ticker: string, industry: IndustryId): string | null {
  if (industry === "AI") return null; // 调用方用 company.layer 本身
  return INDUSTRY_TICKER_LAYER[industry]?.[ticker] ?? null;
}

/** 把一组 items 改写成「在当前 industry 下的视角」：
 *  - industry = AI：原样返回
 *  - 其他 industry：找到 ticker → layer 映射的，覆盖 layer 字段；找不到的过滤掉。 */
export function remapItemsForIndustry<T extends CompanyWithHeat>(
  items: T[],
  industry: IndustryId,
): T[] {
  if (industry === "AI") return items;
  const map = INDUSTRY_TICKER_LAYER[industry];
  if (!map) return items;
  const out: T[] = [];
  for (const it of items) {
    const newLayer = map[it.ticker];
    if (!newLayer) continue;
    out.push({ ...it, layer: newLayer as T["layer"] });
  }
  return out;
}
