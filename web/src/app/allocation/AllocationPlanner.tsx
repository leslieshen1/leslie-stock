"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Download,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Scale,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import AllocationDonut3D, { type DonutTarget } from "./AllocationDonut3D";

type Category = "核心仓位" | "防守板块" | "进攻板块" | "现金";

type Asset = {
  id: string;
  ticker: string;
  name: string;
  category: Category;
  weight: number;
  risk: number;
  role: string;
  theme: string;
  research?: AssetResearch;
};

type AssetResearch = {
  current: string;
  starter: string;
  priority: string;
  confidence: "高" | "中" | "低";
  model: string;
  fundamental: string;
  historical: string;
};

const STORAGE_KEY = "stockgod-future-allocation-v2";
const AS_OF = "2026-08-11";

const CATEGORY_ORDER: Category[] = ["核心仓位", "防守板块", "进攻板块", "现金"];

const CATEGORY_META: Record<Category, { code: string; color: string }> = {
  核心仓位: { code: "CORE", color: "#c9b158" },
  防守板块: { code: "DEFENSIVE", color: "#79a06c" },
  进攻板块: { code: "OFFENSIVE", color: "#d27c50" },
  现金: { code: "CASH", color: "#50a38d" },
};

const DEFAULT_ASSETS: Asset[] = [
  {
    id: "qqq", ticker: "QQQ", name: "纳斯达克100", category: "核心仓位", theme: "全球科技", weight: 13, risk: 72, role: "美国创新资产底仓",
    research: { current: "$720.87", starter: "$650–690", priority: "$590–630", confidence: "中", model: "指数估值40% · 盈利30% · 历史20% · 流动性10%", fundamental: "龙头盈利仍强，但权重集中和估值扩张提高了容错要求。", historical: "现价接近近52周区间上沿；分批区按盈利增长消化估值后的回撤幅度设置。" },
  },
  {
    id: "a500", ticker: "563360", name: "中证A500 ETF", category: "核心仓位", theme: "中国宽基", weight: 9, risk: 45, role: "A股核心宽基",
    research: { current: "¥1.314", starter: "¥1.22–1.29", priority: "¥1.10–1.19", confidence: "中", model: "指数估值40% · 盈利质量25% · 历史25% · 政策周期10%", fundamental: "覆盖A股核心行业，判断重点是全指数盈利修复与自由现金流，而非单一题材。", historical: "参考近52周约¥1.09–1.43区间，并给新指数较短历史记录折价。" },
  },
  {
    id: "hsi", ticker: "159920", name: "恒生指数 ETF", category: "核心仓位", theme: "港股宽基", weight: 6, risk: 38, role: "港股综合底仓",
    research: { current: "¥1.512", starter: "¥1.40–1.48", priority: "¥1.30–1.38", confidence: "中", model: "指数估值40% · 盈利25% · 历史25% · 汇率10%", fundamental: "互联网盈利与股东回报改善，地产和金融权重仍压低整体估值。", historical: "参考近52周约¥1.33–1.69区间；低估不等于没有盈利周期风险。" },
  },
  {
    id: "dividend", ticker: "515180", name: "中证红利 ETF", category: "防守板块", theme: "高股息", weight: 7, risk: 45, role: "股息与现金流",
    research: { current: "¥1.424", starter: "¥1.34–1.40", priority: "¥1.27–1.33", confidence: "中", model: "股息率35% · 盈利质量25% · 历史30% · 利率10%", fundamental: "核心看股息能否由自由现金流覆盖，同时防止高股息背后的盈利下滑。", historical: "现价处于近52周约¥1.29–1.57的中部偏上，等待股息率重新扩张。" },
  },
  {
    id: "health", ticker: "512170", name: "医疗 ETF", category: "防守板块", theme: "医疗健康", weight: 7, risk: 35, role: "医疗需求与估值修复",
    research: { current: "¥0.354", starter: "¥0.33–0.36", priority: "¥0.29–0.32", confidence: "中", model: "指数估值35% · 盈利拐点30% · 历史25% · 政策10%", fundamental: "需求长期存在，但集采、研发兑现和医院端支付能力决定盈利修复速度。", historical: "处于近52周约¥0.29–0.40的中低区域，历史便宜需要盈利止跌确认。" },
  },
  {
    id: "xle", ticker: "XLE", name: "美国能源 ETF", category: "防守板块", theme: "传统能源", weight: 2, risk: 65, role: "传统能源现金流",
    research: { current: "$60.18", starter: "$53–57", priority: "$46–51", confidence: "中", model: "自由现金流35% · 油价周期30% · 历史25% · 地缘风险10%", fundamental: "看油气价格下的自由现金流、资本开支纪律与回购，而不是静态PE。", historical: "现价靠近近52周约$40.77–63.00上沿，当前安全边际偏薄。" },
  },
  {
    id: "gold", ticker: "518880", name: "黄金 ETF", category: "防守板块", theme: "黄金", weight: 6, risk: 70, role: "货币与极端风险缓冲",
    research: { current: "¥9.035", starter: "¥8.25–8.70", priority: "¥7.40–8.00", confidence: "低", model: "实际利率35% · 美元/流动性25% · 历史30% · 组合价值10%", fundamental: "黄金没有企业现金流，主要锚是实际利率、央行需求与美元流动性。", historical: "现价处在近52周约¥7.35–11.98的中部；区间受金价和汇率双重影响。" },
  },
  {
    id: "baba", ticker: "BABA", name: "阿里巴巴", category: "进攻板块", theme: "AI与云", weight: 8, risk: 50, role: "云计算与中国AI",
    research: { current: "$132.32", starter: "$115–128", priority: "$95–110", confidence: "中", model: "自由现金流30% · 云业务25% · 估值25% · 历史20%", fundamental: "核心变量是云收入与利润率、AI资本开支回报，以及电商现金流能否稳定。", historical: "现价位于近52周约$91.99–191.62中部，区间保留中国资产风险折价。" },
  },
  {
    id: "botz", ticker: "BOTZ", name: "全球机器人 ETF", category: "进攻板块", theme: "机器人", weight: 7, risk: 60, role: "全球自动化龙头",
    research: { current: "$37.42", starter: "$34–36", priority: "$31–33", confidence: "中", model: "成分估值35% · 订单/盈利25% · 历史30% · 汇率10%", fundamental: "重仓成熟自动化公司，需观察订单周期和利润，而非只看人形机器人叙事。", historical: "现价处于近52周约$31.86–41.69的偏上区域，等待估值与订单匹配。" },
  },
  {
    id: "cnrobot", ticker: "562500", name: "A股机器人 ETF", category: "进攻板块", theme: "机器人", weight: 7, risk: 55, role: "国产机器人产业链",
    research: { current: "¥1.030", starter: "¥0.95–1.01", priority: "¥0.88–0.94", confidence: "低", model: "成分估值35% · 订单兑现30% · 历史25% · 拥挤度10%", fundamental: "重点看减速器、伺服和本体公司的订单转收入，而不是发布会数量。", historical: "参考近52周约¥0.90–1.23区间；主题交易拥挤时历史分位容易失真。" },
  },
  {
    id: "kuaishou", ticker: "1024.HK", name: "快手", category: "进攻板块", theme: "AI传媒", weight: 3, risk: 34, role: "AI视频应用",
    research: { current: "HK$43.08", starter: "HK$42–48", priority: "HK$38–41", confidence: "中", model: "自由现金流30% · Kling商业化25% · 估值25% · 历史20%", fundamental: "广告与电商提供底盘，Kling需要用收入和留存证明AI投入能形成增量利润。", historical: "接近近52周约HK$39.72–91.91下沿，但下跌本身不能替代基本面确认。" },
  },
  {
    id: "yuewen", ticker: "0772.HK", name: "阅文集团", category: "进攻板块", theme: "AI传媒", weight: 2, risk: 32, role: "IP与内容资产",
    research: { current: "HK$20.90", starter: "HK$19–22", priority: "HK$17–19", confidence: "低", model: "IP现金流35% · 内容管线25% · 估值20% · 历史20%", fundamental: "价值来自IP复用率和影视、动画、游戏变现；项目制收入使单季利润波动较大。", historical: "接近近52周约HK$18.00–46.88下沿，需防止便宜来自内容管线走弱。" },
  },
  {
    id: "remx", ticker: "REMX", name: "稀有金属 ETF", category: "进攻板块", theme: "战略资源", weight: 4, risk: 55, role: "战略金属供给",
    research: { current: "$78.45", starter: "$68–76", priority: "$58–66", confidence: "低", model: "商品周期35% · 成分盈利25% · 历史30% · 政策10%", fundamental: "矿企利润取决于金属价格、成本曲线与扩产纪律，静态估值参考价值有限。", historical: "现价处于近52周约$55.01–111.55中部，分批区靠近周期成本支撑。" },
  },
  {
    id: "grid", ticker: "GRID", name: "全球电网 ETF", category: "进攻板块", theme: "电力基础设施", weight: 4, risk: 68, role: "电网升级与电气化",
    research: { current: "$185.17", starter: "$165–178", priority: "$145–160", confidence: "中", model: "订单增长35% · 成分估值30% · 历史25% · 利率10%", fundamental: "长期需求清晰，真正要跟踪的是设备商订单、产能和利润率能否覆盖高估值。", historical: "现价靠近近52周约$138.01–199.19上沿，优质不等于任何价格都合适。" },
  },
  {
    id: "btc", ticker: "BTC", name: "比特币", category: "进攻板块", theme: "数字资产", weight: 5, risk: 48, role: "非主权稀缺资产",
    research: { current: "$63,955", starter: "$55k–62k", priority: "$48k–54k", confidence: "低", model: "历史回撤40% · 全球流动性35% · 链上周期25%", fundamental: "没有企业现金流，不套用PE；锚定网络采用、长期持有者成本和全球美元流动性。", historical: "高波动资产采用宽区间与分层买入，历史周期只能作概率参考，不能当作底价。" },
  },
  {
    id: "crcl", ticker: "CRCL", name: "Circle", category: "进攻板块", theme: "数字资产", weight: 2, risk: 50, role: "稳定币基础设施",
    research: { current: "$67.05", starter: "$56–64", priority: "$48–55", confidence: "低", model: "USDC增长30% · 单位经济25% · 利率敏感20% · 历史15% · 监管10%", fundamental: "跟踪USDC流通量、储备收益减渠道分成，以及降息对收入的敏感度。", historical: "上市历史短，仅参考约$49.90–189.92的交易区间，因此降低历史因子权重。" },
  },
  {
    id: "coin", ticker: "COIN", name: "Coinbase", category: "进攻板块", theme: "数字资产", weight: 1, risk: 40, role: "加密交易与链上入口",
    research: { current: "$148.68", starter: "$130–150", priority: "$105–125", confidence: "低", model: "周期化盈利30% · 经常收入25% · 估值20% · 历史15% · 监管10%", fundamental: "交易收入仍有周期性，重点看订阅服务、USDC收入、托管和Base能否降低波动。", historical: "接近近52周约$139.11–402.16下沿，但熊市盈利可能同步恶化。" },
  },
  {
    id: "cash", ticker: "CASH", name: "人民币 / USDC", category: "现金", theme: "流动性", weight: 5, risk: 6, role: "流动性与选择权",
    research: { current: "面值", starter: "保持5%", priority: "极端波动时启用", confidence: "高", model: "流动性50% · 汇率25% · 对手方风险25%", fundamental: "人民币负责近端支出，USDC只作为美元流动性工具，并承担发行与托管风险。", historical: "现金不追求价格回报，价值来自回撤期仍有能力执行。" },
  },
  {
    id: "crypto-reserve", ticker: "RESERVE", name: "数字资产预留", category: "现金", theme: "数字资产", weight: 2, risk: 8, role: "等待BTC / CRCL / COIN更好价格",
    research: { current: "暂不配置", starter: "触发分批区", priority: "触发重点区", confidence: "高", model: "纪律100%", fundamental: "不是第四个币种，暂存人民币或USDC。", historical: "只在三个既定标的进入对应价格区间后转出，避免为凑满10%而买。" },
  },
];

type StoredAsset = Omit<Asset, "category"> & { category: string };

function migrateCategory(asset: StoredAsset): Category {
  if (CATEGORY_ORDER.includes(asset.category as Category)) return asset.category as Category;
  if (asset.id === "cash" || asset.ticker === "CASH") return "现金";
  if (asset.id === "dividend" || asset.id === "health" || asset.id === "xle" || asset.id === "gold") return "防守板块";
  if (asset.category === "核心指数") return "核心仓位";
  if (asset.category === "医疗" || asset.category === "防守资产") return "防守板块";
  return "进攻板块";
}

const RISK_BANDS = [
  { max: 24, label: "适合分批", short: "分批", color: "#3fb889", soft: "rgba(63,184,137,.12)" },
  { max: 44, label: "可以开始", short: "可买", color: "#8fbd66", soft: "rgba(143,189,102,.12)" },
  { max: 59, label: "中性观察", short: "观察", color: "#d0ad55", soft: "rgba(208,173,85,.12)" },
  { max: 74, label: "耐心等待", short: "等待", color: "#d9814f", soft: "rgba(217,129,79,.12)" },
  { max: 100, label: "高位等待", short: "高位", color: "#d95768", soft: "rgba(217,87,104,.12)" },
] as const;

function riskBand(risk: number) {
  return RISK_BANDS.find((band) => risk <= band.max) ?? RISK_BANDS[RISK_BANDS.length - 1];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatWeight(value: number) {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function researchFor(asset: Asset): AssetResearch {
  return asset.research ?? {
    current: "待更新",
    starter: "待研究",
    priority: "待研究",
    confidence: "低",
    model: "基本面 · 估值 · 历史 · 周期",
    fundamental: "自定义资产尚未建立基本面锚。",
    historical: "补齐至少一个完整周期后再设价格区间。",
  };
}

export default function AllocationPlanner() {
  const [assets, setAssets] = useState<Asset[]>(DEFAULT_ASSETS);
  const [hydrated, setHydrated] = useState(false);
  const [filter, setFilter] = useState<Category | "全部">("全部");
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<DonutTarget | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as StoredAsset[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setAssets(parsed.map((asset) => ({ ...asset, category: migrateCategory(asset) })));
        }
      }
    } catch {
      // Invalid local data falls back to the reviewed default allocation.
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(assets));
  }, [assets, hydrated]);

  useEffect(() => {
    if (!editingId) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEditingId(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [editingId]);

  const total = useMemo(() => assets.reduce((sum, asset) => sum + asset.weight, 0), [assets]);
  const weightedRisk = useMemo(() => {
    if (total <= 0) return 0;
    return assets.reduce((sum, asset) => sum + asset.weight * asset.risk, 0) / total;
  }, [assets, total]);
  const overallBand = riskBand(weightedRisk);

  const categoryTotals = useMemo(() => CATEGORY_ORDER.map((category) => {
    const categoryAssets = assets.filter((asset) => asset.category === category);
    const value = categoryAssets.reduce((sum, asset) => sum + asset.weight, 0);
    const risk = value > 0
      ? categoryAssets.reduce((sum, asset) => sum + asset.weight * asset.risk, 0) / value
      : 0;
    return { category, value, risk, count: categoryAssets.filter((asset) => asset.weight > 0).length };
  }), [assets]);

  const hoveredAsset = hoveredTarget?.kind === "asset"
    ? assets.find((asset) => asset.id === hoveredTarget.id)
    : undefined;
  const hoveredCategory = hoveredTarget?.kind === "category"
    ? categoryTotals.find((item) => item.category === hoveredTarget.id)
    : undefined;
  const hoveredBand = hoveredAsset
    ? riskBand(hoveredAsset.risk)
    : hoveredCategory
      ? riskBand(hoveredCategory.risk)
      : overallBand;

  const ringAssets = useMemo(() => assets
    .filter((asset) => asset.weight > 0)
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
    .map((asset) => ({
    id: asset.id,
    ticker: asset.ticker,
    name: asset.name,
    category: asset.category,
    categoryColor: CATEGORY_META[asset.category].color,
    weight: asset.weight,
    risk: asset.risk,
    color: riskBand(asset.risk).color,
  })), [assets]);

  const buyNow = useMemo(
    () => assets.filter((asset) => asset.risk <= 44 && asset.weight > 0 && asset.category !== "现金").sort((a, b) => a.risk - b.risk),
    [assets],
  );

  const shownAssets = useMemo(() => {
    const result = filter === "全部" ? assets : assets.filter((asset) => asset.category === filter);
    return [...result].sort((a, b) => b.weight - a.weight);
  }, [assets, filter]);

  function normalizeWeights() {
    if (total <= 0) return;
    const normalized = assets.map((asset) => ({ ...asset, weight: Number((asset.weight / total * 100).toFixed(1)) }));
    const difference = Number((100 - normalized.reduce((sum, asset) => sum + asset.weight, 0)).toFixed(1));
    if (normalized[0]) normalized[0].weight = Number((normalized[0].weight + difference).toFixed(1));
    setAssets(normalized);
  }

  function resetDefaults() {
    setAssets(DEFAULT_ASSETS);
    setFilter("全部");
  }

  function exportPlan() {
    const blob = new Blob([JSON.stringify({ asOf: AS_OF, assets }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `stockgod-allocation-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function importPlan(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as { assets?: Asset[] } | Asset[];
        const incoming = Array.isArray(parsed) ? parsed : parsed.assets;
        if (Array.isArray(incoming) && incoming.length > 0) setAssets(incoming);
      } catch {
        window.alert("无法读取这个配置文件");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  function saveAsset(asset: Asset) {
    setAssets((current) => current.some((item) => item.id === asset.id)
      ? current.map((item) => item.id === asset.id ? asset : item)
      : [...current, asset]);
    setEditingId(null);
  }

  function removeAsset(id: string) {
    setAssets((current) => current.filter((asset) => asset.id !== id));
    setEditingId(null);
  }

  function selectDonutTarget(target: DonutTarget) {
    if (target.kind === "asset") {
      setEditingId(target.id);
      return;
    }
    setFilter(target.id as Category);
  }

  const editingAsset = editingId && editingId !== "new" ? assets.find((asset) => asset.id === editingId) : undefined;

  return (
    <div className="allocation-root fixed inset-0 z-[90] overflow-y-auto overscroll-contain bg-[#0b0c0c] text-[#f1f0eb]">
      <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#0b0c0c]/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <a href="https://stockgod.xyz" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/[0.1] bg-white/[0.04] text-[#a3a39d] transition hover:text-white" title="返回我不是股神">
            <ArrowLeft className="h-4 w-4" />
          </a>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[15px] font-semibold text-[#f1f0eb]">未来仓位</h1>
              <span className="hidden rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[9px] text-[#787a75] sm:inline">PLAN 01</span>
            </div>
            <p className="mt-0.5 font-mono text-[9px] uppercase text-[#686a66]">Target allocation · {AS_OF}</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="mr-2 hidden items-center gap-1.5 text-[11px] text-[#777974] sm:flex">
              <Check className="h-3.5 w-3.5 text-[#3fb889]" />{hydrated ? "已保存" : "读取中"}
            </span>
            <button type="button" onClick={normalizeWeights} title="归一到100%" className="allocation-icon-button"><Scale /></button>
            <button type="button" onClick={exportPlan} title="导出配置" className="allocation-icon-button"><Download /></button>
            <label title="导入配置" className="allocation-icon-button cursor-pointer">
              <Upload />
              <input type="file" accept="application/json" onChange={importPlan} className="sr-only" />
            </label>
            <button type="button" onClick={resetDefaults} title="恢复默认" className="allocation-icon-button"><RotateCcw /></button>
            <button type="button" onClick={() => setEditingId("new")} className="ml-1 inline-flex h-9 items-center gap-2 rounded-md bg-[#f1f0eb] px-3 text-xs font-semibold text-[#111210] transition hover:bg-white">
              <Plus className="h-4 w-4" /><span className="hidden sm:inline">添加资产</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 pb-14 sm:px-6 lg:px-8">
        <section className="grid border-b border-white/[0.08] lg:grid-cols-[minmax(440px,0.88fr)_minmax(520px,1.12fr)]">
          <div className="flex min-h-[430px] items-center justify-center border-b border-white/[0.08] py-4 lg:min-h-[660px] lg:border-b-0 lg:border-r lg:border-white/[0.08] lg:pr-8">
            <div className="relative aspect-square w-full max-w-[520px]">
              {hydrated && (
                <AllocationDonut3D assets={ringAssets} onHover={setHoveredTarget} onSelect={selectDonutTarget} />
              )}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                {hoveredAsset ? (
                  <>
                    <span className="font-mono text-[10px] uppercase text-[#777974]">{hoveredAsset.ticker}</span>
                    <span className="mt-2 max-w-[145px] text-lg font-semibold leading-tight text-[#f1f0eb]">{hoveredAsset.name}</span>
                    <span className="mt-3 font-mono text-3xl font-medium tabular-nums" style={{ color: hoveredBand.color }}>{formatWeight(hoveredAsset.weight)}%</span>
                    <span className="mt-1 text-[11px] font-medium" style={{ color: hoveredBand.color }}>{hoveredBand.label} · {hoveredAsset.risk}</span>
                  </>
                ) : hoveredCategory ? (
                  <>
                    <span className="font-mono text-[9px] uppercase" style={{ color: CATEGORY_META[hoveredCategory.category].color }}>{CATEGORY_META[hoveredCategory.category].code}</span>
                    <span className="mt-2 max-w-[145px] text-lg font-semibold leading-tight text-[#f1f0eb]">{hoveredCategory.category}</span>
                    <span className="mt-3 font-mono text-3xl font-medium tabular-nums" style={{ color: hoveredBand.color }}>{formatWeight(hoveredCategory.value)}%</span>
                    <span className="mt-1 text-[10px] text-[#777974]">{hoveredCategory.count} 个标的 · 温度 {hoveredCategory.risk.toFixed(0)}</span>
                  </>
                ) : (
                  <>
                    <span className="font-mono text-[11px] uppercase text-[#6f716d]">组合买入温度</span>
                    <span className="mt-1 font-mono text-6xl font-medium tabular-nums" style={{ color: overallBand.color }}>{weightedRisk.toFixed(0)}</span>
                    <span className="mt-1 text-sm font-medium" style={{ color: overallBand.color }}>{overallBand.label}</span>
                    <span className="mt-5 font-mono text-[10px] text-[#747672]">{formatWeight(total)}% 已分配</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-center py-8 lg:py-10 lg:pl-10">
            <div className="flex items-end justify-between gap-6 border-b border-white/[0.08] pb-6">
              <div>
                <p className="text-[11px] text-[#737570]">当前状态</p>
                <p className="mt-2 text-2xl font-semibold text-[#f1f0eb]">{buyNow.length} 个标的进入可买区</p>
                <p className="mt-2 text-[10px] text-[#666863]">按基本面、估值与历史位置综合判断</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-2xl font-medium text-[#f1f0eb]">{Math.abs(100 - total).toFixed(1)}%</p>
                <p className="mt-1 text-[10px] text-[#6c6e69]">{Math.abs(total - 100) < 0.05 ? "比例完整" : total < 100 ? "待分配" : "超出目标"}</p>
              </div>
            </div>

            <div className="py-2">
              {buyNow.slice(0, 5).map((asset, index) => {
                const band = riskBand(asset.risk);
                return (
                  <button key={asset.id} type="button" onClick={() => setEditingId(asset.id)} className="group grid w-full grid-cols-[28px_minmax(0,1fr)_58px_64px_18px] items-center gap-3 border-b border-white/[0.06] py-3.5 text-left transition hover:bg-white/[0.025]">
                    <span className="font-mono text-[10px] text-[#5f615d]">0{index + 1}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-[#e8e7e2]">{asset.name}</span>
                      <span className="mt-0.5 block truncate font-mono text-[9px] text-[#686a66]">{asset.ticker} · {researchFor(asset).starter}</span>
                    </span>
                    <span className="text-right font-mono text-sm tabular-nums text-[#d8d7d2]">{formatWeight(asset.weight)}%</span>
                    <span className="rounded-sm px-2 py-1 text-center text-[10px] font-medium" style={{ color: band.color, background: band.soft }}>{band.short} {asset.risk}</span>
                    <ChevronRight className="h-4 w-4 text-[#4f514d] transition group-hover:text-[#989a95]" />
                  </button>
                );
              })}
            </div>

            <div className="mt-5 border-t border-white/[0.08] pt-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[10px] text-[#777974]">板块 / 细分标的</span>
                <span className="font-mono text-[8px] uppercase text-[#555753]">Sector breakdown</span>
              </div>
              <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
                {categoryTotals.filter(({ value }) => value > 0).map(({ category, value, risk, count }) => {
                  const categoryAssets = assets.filter((asset) => asset.category === category && asset.weight > 0);
                  const categoryActive = hoveredTarget?.kind === "category" && hoveredTarget.id === category;
                  const childActive = hoveredTarget?.kind === "asset" && categoryAssets.some((asset) => asset.id === hoveredTarget.id);
                  return (
                    <div
                      key={category}
                      onPointerLeave={() => setHoveredTarget(null)}
                      className={`border-l pl-3 transition ${categoryActive || childActive ? "border-white/30" : "border-white/[0.08]"}`}
                    >
                      <button
                        type="button"
                        onPointerEnter={() => setHoveredTarget({ kind: "category", id: category })}
                        onClick={() => setFilter(category)}
                        className="flex w-full items-start justify-between gap-3 py-1.5 text-left"
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-2 shrink-0" style={{ backgroundColor: CATEGORY_META[category].color }} />
                            <span className="truncate text-[11px] font-semibold text-[#e3e2dd]">{category}</span>
                          </span>
                          <span className="mt-1 block font-mono text-[8px] uppercase text-[#5c5e5a]">{CATEGORY_META[category].code} · {count} assets · R{risk.toFixed(0)}</span>
                        </span>
                        <span className="font-mono text-base font-medium tabular-nums text-[#ecebe6]">{formatWeight(value)}%</span>
                      </button>
                      <div className="mt-1 border-t border-white/[0.05]">
                        {categoryAssets.map((asset) => {
                          const band = riskBand(asset.risk);
                          const active = hoveredTarget?.kind === "asset" && hoveredTarget.id === asset.id;
                          return (
                            <button
                              key={asset.id}
                              type="button"
                              onPointerEnter={() => setHoveredTarget({ kind: "asset", id: asset.id })}
                              onClick={() => setEditingId(asset.id)}
                              className={`grid w-full grid-cols-[7px_48px_minmax(0,1fr)_30px] items-center gap-2 py-1.5 text-left transition ${active ? "text-white" : "text-[#92948e] hover:text-[#d7d6d1]"}`}
                            >
                              <span className="h-3 w-1" style={{ backgroundColor: band.color, boxShadow: active ? `0 0 10px ${band.color}` : "none" }} />
                              <span className="truncate font-mono text-[8px] uppercase text-[#696b67]">{asset.ticker}</span>
                              <span className="truncate text-[9px]">{asset.name}</span>
                              <span className="text-right font-mono text-[9px] tabular-nums">{formatWeight(asset.weight)}%</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between text-[10px] text-[#696b67]">
                <span>买入温度</span><span>便宜</span><span>等待</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {RISK_BANDS.map((band, index) => (
                  <div key={band.label}>
                    <div className="h-1.5" style={{ backgroundColor: band.color }} />
                    <div className="mt-2 flex justify-between font-mono text-[8px] text-[#5d5f5b]">
                      <span>{index === 0 ? 0 : RISK_BANDS[index - 1].max + 1}</span><span>{band.max}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid border-b border-white/[0.08] py-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
          <div>
            <p className="font-mono text-[9px] uppercase text-[#696b67]">Entry framework</p>
            <h2 className="mt-1.5 text-xl font-semibold text-[#f1f0eb]">买入区间怎么来</h2>
            <p className="mt-3 max-w-[220px] text-[11px] leading-5 text-[#6f716d]">不是按现价机械打折。不同资产使用不同锚，区间只在基本面没有恶化时有效。</p>
          </div>
          <div className="mt-6 grid border-t border-white/[0.08] sm:grid-cols-2 lg:mt-0 lg:grid-cols-4 lg:border-t-0">
            {[
              ["01", "基本面", "股票看收入、现金流和资产负债表；ETF穿透到成分盈利。"],
              ["02", "估值", "用周期化利润、股息率或单位经济，不拿单一PE包打天下。"],
              ["03", "历史", "参考52周与完整周期分位、最大回撤；短历史会主动降权。"],
              ["04", "周期", "利率、汇率、商品、监管与拥挤度决定安全边际宽度。"],
            ].map(([number, title, copy]) => (
              <div key={number} className="border-b border-white/[0.08] py-5 sm:px-5 sm:first:pl-0 lg:border-b-0 lg:border-l lg:first:border-l-0">
                <span className="font-mono text-[9px] text-[#555753]">{number}</span>
                <h3 className="mt-3 text-xs font-semibold text-[#deddd8]">{title}</h3>
                <p className="mt-2 text-[10px] leading-5 text-[#6f716d]">{copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="pt-8">
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-mono text-[9px] uppercase text-[#696b67]">Portfolio map</p>
              <h2 className="mt-1.5 text-xl font-semibold text-[#f1f0eb]">目标资产</h2>
            </div>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {(["全部", ...CATEGORY_ORDER] as const).map((category) => (
                <button key={category} type="button" onClick={() => setFilter(category)} className={`h-8 shrink-0 rounded-md px-3 text-[11px] transition ${filter === category ? "bg-[#f1f0eb] font-medium text-[#111210]" : "text-[#81837e] hover:bg-white/[0.05] hover:text-[#e8e7e2]"}`}>
                  {category}
                </button>
              ))}
            </div>
          </div>

          <div className="border-y border-white/[0.08]">
            <div className="hidden grid-cols-[78px_minmax(180px,1.15fr)_100px_minmax(170px,1fr)_minmax(160px,0.9fr)_70px_24px] gap-4 border-b border-white/[0.08] px-3 py-3 font-mono text-[8px] uppercase text-[#5f615d] md:grid">
              <span>代码</span><span>资产</span><span>板块</span><span>买入区间</span><span>买入温度</span><span className="text-right">目标</span><span />
            </div>
            <div className="divide-y divide-white/[0.06]">
              {shownAssets.map((asset) => {
                const band = riskBand(asset.risk);
                const research = researchFor(asset);
                return (
                  <button key={asset.id} type="button" onClick={() => setEditingId(asset.id)} className="group grid w-full grid-cols-[54px_minmax(0,1fr)_62px_18px] items-center gap-3 px-3 py-4 text-left transition hover:bg-white/[0.025] md:grid-cols-[78px_minmax(180px,1.15fr)_100px_minmax(170px,1fr)_minmax(160px,0.9fr)_70px_24px] md:gap-4">
                    <span className="font-mono text-[10px] uppercase text-[#7b7d78]">{asset.ticker}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-[#e9e8e3]">{asset.name}</span>
                      <span className="mt-1 block truncate text-[10px] text-[#636561] md:hidden">{research.current} · 分批 {research.starter}</span>
                      <span className="mt-1 hidden truncate text-[10px] text-[#636561] md:block">{asset.role}</span>
                    </span>
                    <span className="hidden text-[10px] text-[#747671] md:block">{asset.theme}</span>
                    <span className="hidden min-w-0 md:block">
                      <span className="block font-mono text-[10px] text-[#d9d8d3]">{research.current}</span>
                      <span className="mt-1 block truncate text-[9px] text-[#6f716d]">分批 {research.starter}</span>
                    </span>
                    <span className="hidden items-center gap-3 md:flex">
                      <span className="h-1.5 min-w-0 flex-1 bg-white/[0.06]"><span className="block h-full" style={{ width: `${asset.risk}%`, backgroundColor: band.color }} /></span>
                      <span className="w-14 text-right text-[10px] font-medium" style={{ color: band.color }}>{band.short} {asset.risk}</span>
                    </span>
                    <span className="text-right font-mono text-base font-medium tabular-nums text-[#f1f0eb]">{formatWeight(asset.weight)}%</span>
                    <ChevronRight className="h-4 w-4 text-[#4c4e4a] transition group-hover:text-[#a4a6a0]" />
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <footer className="flex items-center justify-between gap-4 pt-6 text-[10px] text-[#595b57]">
          <span>个人研究记录 · 非投资建议</span>
          <span className="font-mono">LOCAL / {hydrated ? "SAVED" : "LOADING"}</span>
        </footer>
      </main>

      {editingId && (
        <AssetEditor
          asset={editingId === "new" ? undefined : editingAsset}
          onClose={() => setEditingId(null)}
          onSave={saveAsset}
          onRemove={editingId === "new" ? undefined : removeAsset}
        />
      )}

      <style jsx global>{`
        .allocation-root { color-scheme: dark; }
        .allocation-icon-button {
          display: inline-flex;
          width: 36px;
          height: 36px;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(255,255,255,.08);
          border-radius: 6px;
          color: #777974;
          background: rgba(255,255,255,.025);
          transition: color .16s ease, background .16s ease, border-color .16s ease;
        }
        .allocation-icon-button:hover { color: #f1f0eb; background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.14); }
        .allocation-icon-button svg { width: 15px; height: 15px; }
        .allocation-range {
          appearance: none;
          height: 6px;
          background: linear-gradient(to right, var(--risk-color) 0 var(--risk-value), rgba(255,255,255,.08) var(--risk-value) 100%);
          cursor: pointer;
        }
        .allocation-range::-webkit-slider-thumb {
          appearance: none;
          width: 18px;
          height: 18px;
          border: 3px solid #151715;
          border-radius: 50%;
          background: var(--risk-color);
          box-shadow: 0 0 0 1px rgba(255,255,255,.18);
        }
        .allocation-range::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border: 3px solid #151715;
          border-radius: 50%;
          background: var(--risk-color);
        }
        @media (max-width: 639px) {
          .allocation-icon-button:nth-of-type(2),
          .allocation-icon-button:nth-of-type(3) { display: none; }
        }
      `}</style>
    </div>
  );
}

function AssetEditor({ asset, onClose, onSave, onRemove }: {
  asset?: Asset;
  onClose: () => void;
  onSave: (asset: Asset) => void;
  onRemove?: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Asset>(asset ?? {
    id: `asset-${Date.now()}`,
    ticker: "",
    name: "",
    category: "核心仓位",
    weight: 0,
    risk: 50,
    role: "",
    theme: "自定义",
  });
  const band = riskBand(draft.risk);
  const research = researchFor(draft);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) return;
    onSave({ ...draft, name: draft.name.trim(), ticker: draft.ticker.trim().toUpperCase() || "NEW" });
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-end bg-black/70 backdrop-blur-[2px] sm:items-stretch" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <form onSubmit={submit} className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg border-t border-white/[0.1] bg-[#141614] p-5 shadow-2xl sm:max-h-none sm:max-w-[430px] sm:rounded-none sm:border-l sm:border-t-0 sm:p-7">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-5">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-white/[0.05] text-[#a5a7a1]"><Pencil className="h-4 w-4" /></span>
            <div>
              <h2 className="text-sm font-semibold text-[#f1f0eb]">{asset ? "编辑资产" : "添加资产"}</h2>
              <p className="mt-0.5 font-mono text-[9px] uppercase text-[#666863]">Allocation settings</p>
            </div>
          </div>
          <button type="button" onClick={onClose} title="关闭" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[#747671] transition hover:bg-white/[0.06] hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid gap-5 py-6">
          <label>
            <span className="mb-2 block text-[10px] text-[#777974]">资产名称</span>
            <input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：标普500 ETF" className="h-11 w-full rounded-md border border-white/[0.1] bg-[#0d0f0d] px-3 text-sm text-[#f1f0eb] outline-none placeholder:text-[#4f514d] focus:border-white/[0.24]" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="mb-2 block text-[10px] text-[#777974]">代码</span>
              <input value={draft.ticker} onChange={(event) => setDraft({ ...draft, ticker: event.target.value })} placeholder="Ticker" className="h-11 w-full rounded-md border border-white/[0.1] bg-[#0d0f0d] px-3 font-mono text-xs uppercase text-[#f1f0eb] outline-none placeholder:text-[#4f514d] focus:border-white/[0.24]" />
            </label>
            <label>
              <span className="mb-2 block text-[10px] text-[#777974]">分类</span>
              <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as Category })} className="h-11 w-full rounded-md border border-white/[0.1] bg-[#0d0f0d] px-3 text-xs text-[#f1f0eb] outline-none focus:border-white/[0.24]">
                {CATEGORY_ORDER.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
          </div>
          <label>
            <span className="mb-2 block text-[10px] text-[#777974]">资产角色</span>
            <input value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} placeholder="这项资产在组合里负责什么" className="h-11 w-full rounded-md border border-white/[0.1] bg-[#0d0f0d] px-3 text-xs text-[#f1f0eb] outline-none placeholder:text-[#4f514d] focus:border-white/[0.24]" />
          </label>
          <label>
            <span className="mb-2 block text-[10px] text-[#777974]">细分板块</span>
            <input value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value })} placeholder="例如：机器人、AI与云" className="h-11 w-full rounded-md border border-white/[0.1] bg-[#0d0f0d] px-3 text-xs text-[#f1f0eb] outline-none placeholder:text-[#4f514d] focus:border-white/[0.24]" />
          </label>

          <div className="border-y border-white/[0.08] py-5">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <span className="block text-[10px] text-[#777974]">目标比例</span>
                <span className="mt-1 block text-xs text-[#5f615d]">组合中的长期目标</span>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setDraft({ ...draft, weight: clamp(Number((draft.weight - 0.5).toFixed(1)), 0, 100) })} title="减少0.5%" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/[0.1] text-[#8b8d87] hover:bg-white/[0.05]"><Minus className="h-4 w-4" /></button>
                <label className="flex h-11 w-24 items-center rounded-md border border-white/[0.1] bg-[#0d0f0d] px-2">
                  <input type="number" min="0" max="100" step="0.5" value={draft.weight} onChange={(event) => setDraft({ ...draft, weight: clamp(Number(event.target.value), 0, 100) })} aria-label={`${draft.name || "新资产"}目标比例`} className="w-full bg-transparent text-right font-mono text-xl text-[#f1f0eb] outline-none" />
                  <span className="ml-1 text-[10px] text-[#666863]">%</span>
                </label>
                <button type="button" onClick={() => setDraft({ ...draft, weight: clamp(Number((draft.weight + 0.5).toFixed(1)), 0, 100) })} title="增加0.5%" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/[0.1] text-[#8b8d87] hover:bg-white/[0.05]"><Plus className="h-4 w-4" /></button>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-5 flex items-end justify-between">
              <div>
                <span className="block text-[10px] text-[#777974]">买入温度</span>
                <span className="mt-1 block text-xs font-medium" style={{ color: band.color }}>{band.label}</span>
              </div>
              <span className="font-mono text-3xl font-medium" style={{ color: band.color }}>{draft.risk}</span>
            </div>
            <input type="range" min="0" max="100" step="1" value={draft.risk} onChange={(event) => setDraft({ ...draft, risk: clamp(Number(event.target.value), 0, 100) })} aria-label={`${draft.name || "新资产"}买入温度`} className="allocation-range w-full" style={{ "--risk-color": band.color, "--risk-value": `${draft.risk}%` } as React.CSSProperties} />
            <div className="mt-3 flex justify-between font-mono text-[8px] text-[#5e605c]"><span>0 · 适合分批</span><span>100 · 高位等待</span></div>
          </div>

          {asset && (
            <div className="border-t border-white/[0.08] pt-5">
              <div className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-2 text-[10px] font-medium text-[#a6a8a2]"><ShieldCheck className="h-3.5 w-3.5" />研究锚点</span>
                <span className="font-mono text-[8px] uppercase text-[#5c5e5a]">{AS_OF} · 置信度 {research.confidence}</span>
              </div>
              <div className="mt-4 grid grid-cols-3 border-y border-white/[0.08] py-4">
                <div>
                  <span className="block text-[9px] text-[#62645f]">当前参考</span>
                  <strong className="mt-1.5 block font-mono text-[12px] font-medium text-[#e8e7e2]">{research.current}</strong>
                </div>
                <div className="border-l border-white/[0.08] pl-3">
                  <span className="block text-[9px] text-[#62645f]">开始分批</span>
                  <strong className="mt-1.5 block font-mono text-[12px] font-medium text-[#8fbd66]">{research.starter}</strong>
                </div>
                <div className="border-l border-white/[0.08] pl-3">
                  <span className="block text-[9px] text-[#62645f]">重点配置</span>
                  <strong className="mt-1.5 block font-mono text-[12px] font-medium text-[#3fb889]">{research.priority}</strong>
                </div>
              </div>
              <p className="mt-4 font-mono text-[8px] leading-4 text-[#71736e]">{research.model}</p>
              <div className="mt-4 space-y-3 text-[10px] leading-5 text-[#898b85]">
                <p><span className="mr-2 font-medium text-[#c8c7c2]">基本面</span>{research.fundamental}</p>
                <p><span className="mr-2 font-medium text-[#c8c7c2]">历史</span>{research.historical}</p>
              </div>
              <p className="mt-4 border-l-2 border-[#d0ad55]/60 pl-3 text-[9px] leading-4 text-[#666863]">若核心基本面恶化，价格进入区间也不自动买入；先重算区间。</p>
            </div>
          )}
        </div>

        <div className="mt-2 flex gap-2 border-t border-white/[0.08] pt-5">
          {onRemove && asset && (
            <button type="button" onClick={() => onRemove(asset.id)} title="删除资产" className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[#d95768]/20 text-[#d95768] transition hover:bg-[#d95768]/10"><Trash2 className="h-4 w-4" /></button>
          )}
          <button type="submit" className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-[#f1f0eb] text-xs font-semibold text-[#111210] transition hover:bg-white">
            <Check className="h-4 w-4" />保存资产
          </button>
        </div>
      </form>
    </div>
  );
}
