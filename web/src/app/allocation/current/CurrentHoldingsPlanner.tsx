"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleDollarSign,
  Globe2,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Target,
  WalletCards,
  X,
} from "lucide-react";
import AllocationDonut3D, { type DonutTarget } from "../AllocationDonut3D";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  DEFAULT_ASSETS,
  STORAGE_KEY,
  type Asset,
  type Category,
} from "../AllocationPlanner";

type HoldingMap = Record<string, number>;
type Market = "a" | "hk" | "us" | "kr";
type CurrentCategory = Category | "未分类";
type ClassificationConfidence = "指数已核对" | "规则初分";
type HoldingAsset = Omit<Asset, "category"> & {
  category: CurrentCategory;
  market: Market;
  source: "target" | "search";
  region: string;
  assetClass: string;
  exposure: string;
  benchmark: string;
  overlapKey: string;
  drivers: string;
  classificationConfidence: ClassificationConfidence;
};

type ClassificationProfile = Pick<HoldingAsset,
  "name" | "category" | "theme" | "role" | "risk" | "region" | "assetClass" |
  "exposure" | "benchmark" | "overlapKey" | "drivers" | "classificationConfidence"
>;

type SearchResult = {
  code: string;
  name: string;
  market: Market;
  sector: string;
  thesis: string;
};

type StoredHoldings = {
  amounts: HoldingMap;
  customAssets: HoldingAsset[];
};

const HOLDINGS_STORAGE_KEY = "stockgod-current-holdings-v1";
const CURRENT_CATEGORY_ORDER: CurrentCategory[] = [...CATEGORY_ORDER, "未分类"];
const CURRENT_CATEGORY_META: Record<CurrentCategory, { code: string; color: string }> = {
  ...CATEGORY_META,
  未分类: { code: "UNASSIGNED", color: "#7d817b" },
};

const CLASSIFICATION_PROFILES: Record<string, ClassificationProfile> = {
  "a:562350": {
    name: "电力ETF银华", category: "防守板块", theme: "电力公用事业", risk: 50,
    role: "公用事业现金流与用电增长", region: "A股", assetClass: "股票ETF",
    exposure: "电力公用事业", benchmark: "中证全指电力公用事业指数", overlapKey: "H30199",
    drivers: "电价机制 · 煤价与水情 · 利率 · 全社会用电量", classificationConfidence: "指数已核对",
  },
  "a:159611": {
    name: "电力ETF广发", category: "防守板块", theme: "电力公用事业", risk: 50,
    role: "公用事业现金流与用电增长", region: "A股", assetClass: "股票ETF",
    exposure: "电力公用事业", benchmark: "中证全指电力公用事业指数", overlapKey: "H30199",
    drivers: "电价机制 · 煤价与水情 · 利率 · 全社会用电量", classificationConfidence: "指数已核对",
  },
  "a:513260": {
    name: "恒生科技ETF汇添富", category: "进攻板块", theme: "港股科技", risk: 58,
    role: "平台互联网与新兴科技增长", region: "港股", assetClass: "跨境QDII ETF",
    exposure: "恒生科技", benchmark: "恒生科技指数", overlapKey: "HSTECH",
    drivers: "平台盈利 · AI资本开支 · 南向资金 · 港元流动性", classificationConfidence: "指数已核对",
  },
  "a:515180": {
    name: "红利ETF易方达", category: "防守板块", theme: "高股息价值", risk: 45,
    role: "股息现金流与价值因子", region: "A股", assetClass: "股票ETF",
    exposure: "高股息价值", benchmark: "中证红利指数", overlapKey: "CSI_DIVIDEND",
    drivers: "股息率 · 自由现金流 · 利率 · 周期股盈利", classificationConfidence: "指数已核对",
  },
  "a:512170": {
    name: "医疗ETF华宝", category: "防守板块", theme: "医疗健康", risk: 35,
    role: "医疗需求与估值修复", region: "A股", assetClass: "股票ETF",
    exposure: "医疗产业", benchmark: "中证医疗指数", overlapKey: "CSI_MEDICAL",
    drivers: "集采政策 · 医疗支付 · 研发兑现 · 盈利拐点", classificationConfidence: "指数已核对",
  },
  "a:562500": {
    name: "机器人ETF华夏", category: "进攻板块", theme: "机器人", risk: 55,
    role: "国产机器人产业链", region: "A股", assetClass: "股票ETF",
    exposure: "机器人产业", benchmark: "中证机器人指数", overlapKey: "CSI_ROBOT",
    drivers: "产业资本开支 · 订单兑现 · 国产化率 · 主题估值", classificationConfidence: "指数已核对",
  },
};

const RISK_BANDS = [
  { max: 24, label: "适合分批", short: "分批", color: "#3fb889" },
  { max: 44, label: "可以开始", short: "可买", color: "#8fbd66" },
  { max: 59, label: "中性观察", short: "观察", color: "#d0ad55" },
  { max: 74, label: "耐心等待", short: "等待", color: "#d9814f" },
  { max: 100, label: "高位等待", short: "高位", color: "#d95768" },
] as const;

function riskBand(risk: number) {
  return RISK_BANDS.find((band) => risk <= band.max) ?? RISK_BANDS[RISK_BANDS.length - 1];
}

function formatWeight(value: number) {
  if (!Number.isFinite(value)) return "0";
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function formatMoney(value: number, compact = false) {
  if (compact && value >= 10000) {
    const tenThousands = value / 10000;
    return `¥${Number.isInteger(tenThousands) ? tenThousands.toFixed(0) : tenThousands.toFixed(1)}万`;
  }
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

function validHoldingMap(value: unknown): HoldingMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([id, amount]) => [id, Number(amount)] as const)
      .filter(([, amount]) => Number.isFinite(amount) && amount > 0),
  );
}

function inferMarket(ticker: string): Market {
  const code = ticker.toUpperCase();
  if (code.endsWith(".HK")) return "hk";
  if (/^\d{6}$/.test(code)) return "a";
  return "us";
}

function normalizedCode(ticker: string) {
  return ticker.toUpperCase().replace(/\.HK$/, "");
}

function assetKey(asset: Pick<HoldingAsset, "ticker" | "market">) {
  return `${asset.market}:${normalizedCode(asset.ticker)}`;
}

function classifyHoldingAsset(asset: Omit<HoldingAsset,
  "region" | "assetClass" | "exposure" | "benchmark" | "overlapKey" | "drivers" | "classificationConfidence"
> & Partial<HoldingAsset>): HoldingAsset {
  const key = assetKey(asset as HoldingAsset);
  const profile = CLASSIFICATION_PROFILES[key];
  if (profile) return { ...asset, ...profile } as HoldingAsset;

  const region = asset.market === "a" ? "A股" : asset.market === "hk" ? "港股" : asset.market === "us" ? "美股" : "全球";
  const isFund = /ETF|基金/i.test(`${asset.name} ${asset.theme}`);
  return {
    ...asset,
    region: asset.region || region,
    assetClass: asset.assetClass || (isFund ? "基金/ETF" : "股票"),
    exposure: asset.exposure || asset.theme || "待研究",
    benchmark: asset.benchmark || "未核实",
    overlapKey: asset.overlapKey || key,
    drivers: asset.drivers || "盈利 · 估值 · 流动性",
    classificationConfidence: asset.classificationConfidence || "规则初分",
  } as HoldingAsset;
}

function targetToHoldingAsset(asset: Asset): HoldingAsset {
  return classifyHoldingAsset({ ...asset, market: inferMarket(asset.ticker), source: "target" });
}

function validStoredHoldings(value: unknown): StoredHoldings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { amounts: {}, customAssets: [] };
  const stored = value as Partial<StoredHoldings>;
  if (stored.amounts) {
    const customAssets = Array.isArray(stored.customAssets)
      ? stored.customAssets.filter((asset) => asset && asset.id && asset.ticker && asset.name)
      : [];
    return { amounts: validHoldingMap(stored.amounts), customAssets: customAssets.map((asset) => classifyHoldingAsset(asset)) };
  }
  return { amounts: validHoldingMap(value), customAssets: [] };
}

export default function CurrentHoldingsPlanner() {
  const [assets, setAssets] = useState<Asset[]>(DEFAULT_ASSETS);
  const [holdings, setHoldings] = useState<HoldingMap>({});
  const [customAssets, setCustomAssets] = useState<HoldingAsset[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<DonutTarget | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    try {
      const savedAssets = window.localStorage.getItem(STORAGE_KEY);
      const savedHoldings = window.localStorage.getItem(HOLDINGS_STORAGE_KEY);
      if (savedAssets) {
        const parsedAssets = JSON.parse(savedAssets) as Asset[];
        if (Array.isArray(parsedAssets) && parsedAssets.length > 0) setAssets(parsedAssets);
      }
      if (savedHoldings) {
        const stored = validStoredHoldings(JSON.parse(savedHoldings));
        setHoldings(stored.amounts);
        setCustomAssets(stored.customAssets);
      }
    } catch {
      // Invalid local data falls back to the reviewed target plan and an empty account.
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(HOLDINGS_STORAGE_KEY, JSON.stringify({ amounts: holdings, customAssets } satisfies StoredHoldings));
  }, [customAssets, holdings, hydrated]);

  useEffect(() => {
    if (!editingId) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEditingId(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [editingId]);

  const targetAssets = useMemo(() => assets.map(targetToHoldingAsset), [assets]);
  const allAssets = useMemo(() => {
    const targetKeys = new Set(targetAssets.map(assetKey));
    return [...targetAssets, ...customAssets.filter((asset) => !targetKeys.has(assetKey(asset))).map(classifyHoldingAsset)];
  }, [customAssets, targetAssets]);

  const total = useMemo(
    () => allAssets.reduce((sum, asset) => sum + (holdings[asset.id] ?? 0), 0),
    [allAssets, holdings],
  );

  const currentAssets = useMemo(() => allAssets
    .filter((asset) => (holdings[asset.id] ?? 0) > 0)
    .map((asset) => ({
      ...asset,
      amount: holdings[asset.id],
      actualWeight: total > 0 ? holdings[asset.id] / total * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount), [allAssets, holdings, total]);

  const targetTotal = useMemo(() => assets.reduce((sum, asset) => sum + asset.weight, 0), [assets]);

  const categoryRows = useMemo(() => CURRENT_CATEGORY_ORDER.map((category) => {
    const amount = currentAssets
      .filter((asset) => asset.category === category)
      .reduce((sum, asset) => sum + asset.amount, 0);
    const actualWeight = total > 0 ? amount / total * 100 : 0;
    const rawTarget = category === "未分类" ? 0 : assets
      .filter((asset) => asset.category === category)
      .reduce((sum, asset) => sum + asset.weight, 0);
    const targetWeight = targetTotal > 0 ? rawTarget / targetTotal * 100 : 0;
    return { category, amount, actualWeight, targetWeight, gap: actualWeight - targetWeight };
  }), [assets, currentAssets, targetTotal, total]);

  const exposureRows = useMemo(() => {
    const grouped = new Map<string, {
      key: string;
      category: CurrentCategory;
      exposure: string;
      region: string;
      assetClass: string;
      benchmark: string;
      drivers: string;
      confidence: ClassificationConfidence;
      amount: number;
      assets: typeof currentAssets;
    }>();
    currentAssets.forEach((asset) => {
      const row = grouped.get(asset.overlapKey);
      if (row) {
        row.amount += asset.amount;
        row.assets.push(asset);
        return;
      }
      grouped.set(asset.overlapKey, {
        key: asset.overlapKey,
        category: asset.category,
        exposure: asset.exposure,
        region: asset.region,
        assetClass: asset.assetClass,
        benchmark: asset.benchmark,
        drivers: asset.drivers,
        confidence: asset.classificationConfidence,
        amount: asset.amount,
        assets: [asset],
      });
    });
    return [...grouped.values()]
      .map((row) => ({ ...row, actualWeight: total > 0 ? row.amount / total * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount);
  }, [currentAssets, total]);

  const duplicateExposure = exposureRows.find((row) => row.assets.length > 1);

  const ringAssets = useMemo(() => [...currentAssets]
    .sort((a, b) => CURRENT_CATEGORY_ORDER.indexOf(a.category) - CURRENT_CATEGORY_ORDER.indexOf(b.category))
    .map((asset) => ({
      id: asset.id,
      ticker: asset.ticker,
      name: asset.name,
      category: asset.category,
      categoryColor: CURRENT_CATEGORY_META[asset.category].color,
      weight: asset.actualWeight,
      risk: asset.risk,
      color: riskBand(asset.risk).color,
    })), [currentAssets]);

  const hoveredAsset = hoveredTarget?.kind === "asset"
    ? currentAssets.find((asset) => asset.id === hoveredTarget.id)
    : undefined;
  const hoveredCategory = hoveredTarget?.kind === "category"
    ? categoryRows.find((row) => row.category === hoveredTarget.id)
    : undefined;

  const largestExposure = exposureRows[0];
  const largestCategoryGap = [...categoryRows].sort((a, b) => a.gap - b.gap)[0];
  const nextCandidates = useMemo(() => assets
    .filter((asset) => asset.weight > 0 && asset.category !== "现金")
    .map((asset) => {
      const targetWeight = targetTotal > 0 ? asset.weight / targetTotal * 100 : 0;
      const actualWeight = total > 0 ? (holdings[asset.id] ?? 0) / total * 100 : 0;
      const gap = targetWeight - actualWeight;
      const score = gap * (asset.risk <= 44 ? 1.25 : asset.risk <= 59 ? 1 : 0.62);
      return { asset, gap, score };
    })
    .filter((item) => item.gap > 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3), [assets, holdings, targetTotal, total]);

  const visibleRows = showAll
    ? [...allAssets].sort((a, b) => (holdings[b.id] ?? 0) - (holdings[a.id] ?? 0) || b.weight - a.weight)
    : currentAssets;

  function saveHolding(incoming: HoldingAsset, amount: number) {
    const targetMatch = targetAssets.find((asset) => assetKey(asset) === assetKey(incoming));
    const asset = targetMatch ?? incoming;
    if (!targetMatch && amount > 0) {
      setCustomAssets((current) => current.some((item) => item.id === asset.id)
        ? current.map((item) => item.id === asset.id ? asset : item)
        : [...current, asset]);
    }
    setHoldings((current) => {
      if (!Number.isFinite(amount) || amount <= 0) {
        const next = { ...current };
        delete next[asset.id];
        return next;
      }
      return { ...current, [asset.id]: Math.round(amount * 100) / 100 };
    });
    if (amount <= 0 && asset.source === "search") {
      setCustomAssets((current) => current.filter((item) => item.id !== asset.id));
    }
    setEditingId(null);
  }

  function resetHoldings() {
    if (Object.keys(holdings).length === 0 || window.confirm("清空全部当前持仓？目标配置不会受影响。")) {
      setHoldings({});
      setCustomAssets([]);
      setEditingId(null);
      setHoveredTarget(null);
    }
  }

  function openNewHolding() {
    setEditingId("new");
  }

  return (
    <div className="allocation-root fixed inset-0 z-[90] overflow-y-auto overscroll-contain bg-[#0b0c0c] text-[#f1f0eb]">
      <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#0b0c0c]/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <a href="https://stockgod.xyz" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/[0.1] bg-white/[0.04] text-[#a3a39d] transition hover:text-white" title="返回我不是股神">
            <ArrowLeft className="h-4 w-4" />
          </a>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold text-[#f1f0eb]">仓位管理</h1>
            <p className="mt-0.5 font-mono text-[9px] uppercase text-[#686a66]">Actual portfolio</p>
          </div>
          <nav className="ml-2 hidden h-9 items-center rounded-md border border-white/[0.08] bg-white/[0.025] p-0.5 md:flex" aria-label="仓位视图">
            <span className="inline-flex h-7 items-center gap-1.5 rounded bg-[#f1f0eb] px-2.5 text-[10px] font-medium text-[#111210]">
              <WalletCards className="h-3.5 w-3.5" />当前持仓
            </span>
            <a href="/allocation" className="inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[10px] text-[#777974] transition hover:text-[#e8e7e2]">
              <Target className="h-3.5 w-3.5" />目标配置
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="mr-2 hidden items-center gap-1.5 text-[11px] text-[#777974] sm:flex">
              <Check className="h-3.5 w-3.5 text-[#3fb889]" />{hydrated ? "已保存" : "读取中"}
            </span>
            <a href="/allocation" title="查看目标配置" className="allocation-icon-button md:hidden"><Target /></a>
            <button type="button" onClick={resetHoldings} title="清空当前持仓" className="allocation-icon-button"><RotateCcw /></button>
            <button type="button" onClick={openNewHolding} className="ml-1 inline-flex h-9 items-center gap-2 rounded-md bg-[#f1f0eb] px-3 text-xs font-semibold text-[#111210] transition hover:bg-white">
              <Plus className="h-4 w-4" /><span className="hidden sm:inline">录入持仓</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 pb-14 sm:px-6 lg:px-8">
        <section className="grid border-b border-white/[0.08] lg:grid-cols-[minmax(440px,0.88fr)_minmax(520px,1.12fr)]">
          <div className="flex min-h-[430px] items-center justify-center border-b border-white/[0.08] py-4 lg:min-h-[650px] lg:border-b-0 lg:border-r lg:border-white/[0.08] lg:pr-8">
            <div className="relative aspect-square w-full max-w-[520px]">
              {hydrated && ringAssets.length > 0 && (
                <AllocationDonut3D assets={ringAssets} onHover={setHoveredTarget} onSelect={(target) => {
                  if (target.kind === "asset") setEditingId(target.id);
                }} />
              )}
              {hydrated && ringAssets.length === 0 && (
                <div className="absolute inset-[18%] rounded-full border border-dashed border-white/[0.12] before:absolute before:inset-[25%] before:rounded-full before:border before:border-white/[0.08]" />
              )}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                {hoveredAsset ? (
                  <>
                    <span className="font-mono text-[10px] uppercase text-[#777974]">{hoveredAsset.ticker}</span>
                    <span className="mt-2 max-w-[150px] text-lg font-semibold leading-tight text-[#f1f0eb]">{hoveredAsset.name}</span>
                    <span className="mt-3 font-mono text-3xl font-medium tabular-nums" style={{ color: riskBand(hoveredAsset.risk).color }}>{formatWeight(hoveredAsset.actualWeight)}%</span>
                    <span className="mt-1 text-[11px] text-[#777974]">{formatMoney(hoveredAsset.amount)}</span>
                  </>
                ) : hoveredCategory ? (
                  <>
                    <span className="font-mono text-[9px] uppercase" style={{ color: CURRENT_CATEGORY_META[hoveredCategory.category].color }}>{CURRENT_CATEGORY_META[hoveredCategory.category].code}</span>
                    <span className="mt-2 text-lg font-semibold text-[#f1f0eb]">{hoveredCategory.category}</span>
                    <span className="mt-3 font-mono text-3xl font-medium tabular-nums text-[#f1f0eb]">{formatWeight(hoveredCategory.actualWeight)}%</span>
                    <span className="mt-1 text-[11px] text-[#777974]">{formatMoney(hoveredCategory.amount)}</span>
                  </>
                ) : total > 0 ? (
                  <>
                    <span className="font-mono text-[10px] uppercase text-[#6f716d]">当前总仓位</span>
                    <span className="mt-2 max-w-[180px] font-mono text-4xl font-medium tabular-nums text-[#f1f0eb] sm:text-5xl">{formatMoney(total, true)}</span>
                    <span className="mt-3 text-[11px] text-[#747672]">{currentAssets.length} 个标的 · 100% 已录入持仓</span>
                  </>
                ) : (
                  <>
                    <CircleDollarSign className="h-6 w-6 text-[#5f615d]" />
                    <span className="mt-4 text-base font-semibold text-[#d9d8d3]">还没有当前持仓</span>
                    <span className="mt-2 text-[10px] text-[#686a66]">录入第一笔金额后生成圆环</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-center py-8 lg:py-10 lg:pl-10">
            <div className="flex items-end justify-between gap-6 border-b border-white/[0.08] pb-6">
              <div>
                <p className="text-[11px] text-[#737570]">真实持仓</p>
                <p className="mt-2 text-2xl font-semibold text-[#f1f0eb]">{total > 0 ? formatMoney(total) : "等待第一笔录入"}</p>
                <p className="mt-2 text-[10px] text-[#666863]">按当前人民币等值金额计算，不含未填写资产</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-2xl font-medium text-[#f1f0eb]">{currentAssets.length}</p>
                <p className="mt-1 text-[10px] text-[#6c6e69]">持仓标的</p>
              </div>
            </div>

            {total > 0 ? (
              <div className="divide-y divide-white/[0.07]">
                <AdviceRow
                  index="01"
                  label="穿透集中度"
                  title={`${largestExposure.exposure}合计占当前持仓 ${formatWeight(largestExposure.actualWeight)}%`}
                  copy={largestExposure.assets.length > 1 ? `由 ${largestExposure.assets.length} 只基金共同构成，但底层指数相同，分散度应按一份暴露计算。` : largestExposure.actualWeight > 40 ? "单一经济暴露偏高。后续资金优先补充相关性更低的资产，不必为调比例机械卖出。" : "最大经济暴露仍在可观察范围，继续看板块之间的相关性。"}
                />
                <AdviceRow
                  index="02"
                  label="结构偏离"
                  title={`${largestCategoryGap.category}低于目标 ${formatWeight(Math.abs(largestCategoryGap.gap))} 个百分点`}
                  copy={`当前 ${formatWeight(largestCategoryGap.actualWeight)}%，长期目标 ${formatWeight(largestCategoryGap.targetWeight)}%。偏离只反映已录入资金，不代表必须一次补齐。`}
                />
                <AdviceRow
                  index="03"
                  label="下一笔优先级"
                  title={nextCandidates.length > 0 ? nextCandidates.map(({ asset }) => asset.name).join(" / ") : "当前结构接近目标"}
                  copy={nextCandidates.length > 0 ? "按目标缺口和买入温度共同排序；高温标的即使缺口大，也不为凑比例追买。" : "暂时没有明显结构缺口，下一笔继续看价格和基本面。"}
                />
              </div>
            ) : (
              <button type="button" onClick={openNewHolding} className="mt-6 flex min-h-48 flex-col items-center justify-center border border-dashed border-white/[0.1] text-[#777974] transition hover:border-white/[0.2] hover:text-[#e8e7e2]">
                <Plus className="h-5 w-5" />
                <span className="mt-3 text-sm font-medium">录入第一笔持仓</span>
              </button>
            )}

            {total > 0 && (
              <div className="mt-6 border-t border-white/[0.08] pt-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[10px] text-[#777974]">当前板块 / 长期目标</span>
                  <span className="font-mono text-[8px] uppercase text-[#555753]">Actual vs target</span>
                </div>
                <div className="space-y-3">
                  {categoryRows.map((row) => (
                    <button key={row.category} type="button" onPointerEnter={() => setHoveredTarget({ kind: "category", id: row.category })} onPointerLeave={() => setHoveredTarget(null)} className="grid w-full grid-cols-[90px_minmax(0,1fr)_58px_58px] items-center gap-3 text-left">
                      <span className="flex items-center gap-2 text-[10px] text-[#c9c8c3]"><span className="h-2 w-2" style={{ backgroundColor: CURRENT_CATEGORY_META[row.category].color }} />{row.category}</span>
                      <span className="h-1.5 bg-white/[0.06]"><span className="block h-full" style={{ width: `${Math.min(row.actualWeight, 100)}%`, backgroundColor: CURRENT_CATEGORY_META[row.category].color }} /></span>
                      <span className="text-right font-mono text-[10px] text-[#e6e5e0]">{formatWeight(row.actualWeight)}%</span>
                      <span className="text-right font-mono text-[9px] text-[#656762]">/ {formatWeight(row.targetWeight)}%</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {total > 0 && (
          <section className="border-b border-white/[0.08] py-8">
            <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="font-mono text-[9px] uppercase text-[#696b67]">Exposure look-through</p>
                <h2 className="mt-1.5 text-xl font-semibold text-[#f1f0eb]">持仓穿透分类</h2>
                <p className="mt-2 text-[10px] leading-5 text-[#686a66]">仓位角色 → 经济暴露 → 具体基金。相同底层指数合并计算，不把基金数量误当成分散度。</p>
              </div>
              <div className="flex shrink-0 items-baseline gap-2 border-l border-white/[0.1] pl-4">
                <strong className="font-mono text-2xl font-medium text-[#f1f0eb]">{exposureRows.length}</strong>
                <span className="text-[10px] text-[#6d6f6a]">份独立经济暴露 / {currentAssets.length} 只基金</span>
              </div>
            </div>

            {duplicateExposure && (
              <div className="mb-5 grid gap-2 border-l-2 border-[#d0ad55] bg-[#d0ad55]/[0.055] px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <p className="text-[11px] leading-5 text-[#d7d5cd]">
                  <strong className="font-medium text-[#e5c56c]">重复暴露：</strong>
                  {duplicateExposure.assets.map((asset) => asset.name).join(" + ")}跟踪同一底层指数，合计占当前持仓 {formatWeight(duplicateExposure.actualWeight)}%。
                </p>
                <span className="font-mono text-[9px] uppercase text-[#8f8a70]">Same benchmark × {duplicateExposure.assets.length}</span>
              </div>
            )}

            <div className="border-y border-white/[0.08]">
              <div className="hidden grid-cols-[150px_minmax(230px,1fr)_minmax(190px,.9fr)_110px] gap-5 border-b border-white/[0.08] px-3 py-3 font-mono text-[8px] uppercase text-[#5f615d] lg:grid">
                <span>仓位角色 / 暴露</span><span>底层指数 / 核心驱动</span><span>具体持仓</span><span className="text-right">占比 / 金额</span>
              </div>
              <div className="divide-y divide-white/[0.06]">
                {exposureRows.map((row) => (
                  <div key={row.key} className="grid gap-4 px-3 py-5 lg:grid-cols-[150px_minmax(230px,1fr)_minmax(190px,.9fr)_110px] lg:gap-5">
                    <div>
                      <span className="inline-flex items-center gap-2 text-[9px] text-[#858781]"><span className="h-2 w-2" style={{ backgroundColor: CURRENT_CATEGORY_META[row.category].color }} />{row.category}</span>
                      <strong className="mt-1.5 block text-[13px] font-medium text-[#ecebe6]">{row.exposure}</strong>
                      <span className="mt-1 block text-[9px] text-[#62645f]">{row.region} · {row.assetClass}</span>
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-[#d5d4cf]">{row.benchmark}</span>
                        <span className={`rounded-sm px-1.5 py-0.5 text-[8px] ${row.confidence === "指数已核对" ? "bg-[#3fb889]/10 text-[#6fc59f]" : "bg-white/[0.05] text-[#757772]"}`}>{row.confidence}</span>
                      </div>
                      <span className="mt-2 block text-[9px] leading-5 text-[#656762]">{row.drivers}</span>
                    </div>
                    <div className="space-y-1.5">
                      {row.assets.map((asset) => (
                        <div key={asset.id} className="flex items-center justify-between gap-3 text-[10px]">
                          <span className="truncate text-[#b5b5af]">{asset.name}</span>
                          <span className="shrink-0 font-mono text-[#646661]">{asset.ticker}</span>
                        </div>
                      ))}
                    </div>
                    <div className="text-left lg:text-right">
                      <strong className="font-mono text-[15px] font-medium text-[#e9e8e3]">{formatWeight(row.actualWeight)}%</strong>
                      <span className="mt-1 block font-mono text-[9px] text-[#656762]">{formatMoney(row.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="pt-8">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[9px] uppercase text-[#696b67]">Position ledger</p>
              <h2 className="mt-1.5 text-xl font-semibold text-[#f1f0eb]">持仓明细</h2>
            </div>
            <button type="button" onClick={() => setShowAll((value) => !value)} className="h-8 rounded-md px-3 text-[10px] text-[#8a8c86] transition hover:bg-white/[0.05] hover:text-[#e8e7e2]">
              {showAll ? "只看已持有" : "显示全部目标资产"}
            </button>
          </div>

          <div className="border-y border-white/[0.08]">
            <div className="hidden grid-cols-[82px_minmax(190px,1fr)_105px_130px_82px_82px_24px] gap-4 border-b border-white/[0.08] px-3 py-3 font-mono text-[8px] uppercase text-[#5f615d] md:grid">
              <span>代码</span><span>资产</span><span>板块</span><span className="text-right">当前金额</span><span className="text-right">当前</span><span className="text-right">目标</span><span />
            </div>
            <div className="divide-y divide-white/[0.06]">
              {visibleRows.length > 0 ? visibleRows.map((asset) => {
                const amount = holdings[asset.id] ?? 0;
                const actualWeight = total > 0 ? amount / total * 100 : 0;
                const normalizedTarget = targetTotal > 0 ? asset.weight / targetTotal * 100 : 0;
                return (
                  <button key={asset.id} type="button" onClick={() => setEditingId(asset.id)} className="group grid w-full grid-cols-[58px_minmax(0,1fr)_84px_18px] items-center gap-3 px-3 py-4 text-left transition hover:bg-white/[0.025] md:grid-cols-[82px_minmax(190px,1fr)_105px_130px_82px_82px_24px] md:gap-4">
                    <span className="font-mono text-[10px] uppercase text-[#7b7d78]">{asset.ticker}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-[#e9e8e3]">{asset.name}</span>
                      <span className="mt-1 block truncate text-[10px] text-[#636561] md:hidden">{amount > 0 ? formatMoney(amount) : "未录入"} · {asset.weight > 0 ? `目标 ${formatWeight(normalizedTarget)}%` : "目标未设置"}</span>
                      <span className="mt-1 hidden truncate text-[10px] text-[#636561] md:block">{asset.role}</span>
                    </span>
                    <span className="hidden text-[10px] text-[#747671] md:block">{asset.category}</span>
                    <span className={`hidden text-right font-mono text-[12px] md:block ${amount > 0 ? "text-[#e8e7e2]" : "text-[#555753]"}`}>{amount > 0 ? formatMoney(amount) : "—"}</span>
                    <span className="hidden text-right font-mono text-[11px] text-[#e8e7e2] md:block">{amount > 0 ? `${formatWeight(actualWeight)}%` : "—"}</span>
                    <span className="text-right font-mono text-[11px] text-[#777974]">{asset.weight > 0 ? `${formatWeight(normalizedTarget)}%` : "未设置"}</span>
                    <ChevronRight className="h-4 w-4 text-[#4c4e4a] transition group-hover:text-[#a4a6a0]" />
                  </button>
                );
              }) : (
                <div className="px-3 py-12 text-center text-[11px] text-[#666863]">暂无已录入持仓</div>
              )}
            </div>
          </div>
        </section>

        <footer className="flex items-center justify-between gap-4 pt-6 text-[10px] text-[#595b57]">
          <span>当前金额为人民币等值 · 个人记录 · 非投资建议</span>
          <span className="font-mono">LOCAL / {hydrated ? "SAVED" : "LOADING"}</span>
        </footer>
      </main>

      {editingId && (
        <HoldingEditor
          assets={allAssets}
          targetAssets={targetAssets}
          selectedId={editingId === "new" ? null : editingId}
          holdings={holdings}
          onClose={() => setEditingId(null)}
          onSave={saveHolding}
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
      `}</style>
    </div>
  );
}

function AdviceRow({ index, label, title, copy }: { index: string; label: string; title: string; copy: string }) {
  return (
    <div className="grid grid-cols-[30px_minmax(0,1fr)] gap-3 py-4 sm:grid-cols-[30px_96px_minmax(0,1fr)]">
      <span className="pt-0.5 font-mono text-[9px] text-[#5f615d]">{index}</span>
      <span className="hidden pt-0.5 text-[10px] text-[#777974] sm:block">{label}</span>
      <div>
        <p className="text-[13px] font-medium text-[#e8e7e2]">{title}</p>
        <p className="mt-1.5 text-[10px] leading-5 text-[#696b67]">{copy}</p>
      </div>
    </div>
  );
}

function HoldingEditor({ assets, targetAssets, selectedId, holdings, onClose, onSave }: {
  assets: HoldingAsset[];
  targetAssets: HoldingAsset[];
  selectedId: string | null;
  holdings: HoldingMap;
  onClose: () => void;
  onSave: (asset: HoldingAsset, amount: number) => void;
}) {
  const initialAsset = selectedId ? assets.find((item) => item.id === selectedId) ?? null : null;
  const [selectedAsset, setSelectedAsset] = useState<HoldingAsset | null>(initialAsset);
  const [draftAmount, setDraftAmount] = useState(initialAsset && holdings[initialAsset.id] ? String(holdings[initialAsset.id]) : "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const amount = selectedAsset ? holdings[selectedAsset.id] ?? 0 : 0;
  const localSearchResults = useMemo(() => {
    const knownProfiles = Object.entries(CLASSIFICATION_PROFILES).map(([key, profile]) => {
      const [market, code] = key.split(":") as [Market, string];
      return { code, name: profile.name, market, sector: profile.theme, thesis: profile.role } satisfies SearchResult;
    });
    const configuredAssets = [...targetAssets, ...assets].map((asset) => ({
      code: normalizedCode(asset.ticker),
      name: asset.name,
      market: asset.market,
      sector: asset.theme,
      thesis: asset.role,
    } satisfies SearchResult));
    const unique = new Map<string, SearchResult>();
    [...knownProfiles, ...configuredAssets].forEach((item) => unique.set(`${item.market}:${item.code}`, item));
    return [...unique.values()];
  }, [assets, targetAssets]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    const lowered = q.toLowerCase();
    const localMatches = localSearchResults.filter((item) =>
      `${item.code} ${item.name} ${item.sector} ${item.thesis}`.toLowerCase().includes(lowered),
    );
    setResults(localMatches);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=20`, { signal: controller.signal });
        const body = await response.json() as { results?: SearchResult[] };
        const merged = new Map<string, SearchResult>();
        [...localMatches, ...(body.results || [])].forEach((item) => merged.set(`${item.market}:${normalizedCode(item.code)}`, item));
        setResults([...merged.values()].slice(0, 20));
      } catch {
        if (!controller.signal.aborted) setResults(localMatches);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [localSearchResults, query]);

  function selectResult(result: SearchResult) {
    const code = normalizedCode(result.code);
    const targetMatch = targetAssets.find((asset) => asset.market === result.market && normalizedCode(asset.ticker) === code);
    const existingMatch = assets.find((asset) => asset.market === result.market && normalizedCode(asset.ticker) === code);
    const asset = targetMatch ?? existingMatch ?? classifyHoldingAsset({
      id: `holding-${result.market}-${code.toLowerCase()}`,
      ticker: result.market === "hk" ? `${code}.HK` : code,
      name: result.name,
      category: "未分类" as const,
      weight: 0,
      risk: 50,
      role: "当前持仓 · 尚未设置目标",
      theme: result.sector || result.thesis || "其他",
      market: result.market,
      source: "search" as const,
    });
    setSelectedAsset(asset);
    setDraftAmount(holdings[asset.id] ? String(holdings[asset.id]) : "");
    setQuery("");
    setResults([]);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedAsset) return;
    onSave(selectedAsset, Number(draftAmount));
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-end bg-black/70 backdrop-blur-[2px] sm:items-stretch" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <form onSubmit={submit} className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg border-t border-white/[0.1] bg-[#141614] p-5 shadow-2xl sm:max-h-none sm:max-w-[460px] sm:rounded-none sm:border-l sm:border-t-0 sm:p-7">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-5">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-white/[0.05] text-[#a5a7a1]"><Pencil className="h-4 w-4" /></span>
            <div>
              <h2 className="text-sm font-semibold text-[#f1f0eb]">{amount > 0 ? "更新持仓" : "录入持仓"}</h2>
              <p className="mt-0.5 font-mono text-[9px] uppercase text-[#666863]">Global asset search</p>
            </div>
          </div>
          <button type="button" onClick={onClose} title="关闭" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[#747671] transition hover:bg-white/[0.06] hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid gap-5 py-6">
          <div className="relative">
            <label htmlFor="holding-search" className="mb-2 block text-[10px] text-[#777974]">检索资产</label>
            <div className="flex h-11 items-center rounded-md border border-white/[0.1] bg-[#0d0f0d] px-3 focus-within:border-white/[0.24]">
              <Search className="mr-2 h-4 w-4 shrink-0 text-[#62645f]" />
              <input id="holding-search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="代码、名称或板块" className="min-w-0 flex-1 bg-transparent text-xs text-[#f1f0eb] outline-none placeholder:text-[#4f514d]" />
              {loading && <LoaderCircle className="h-4 w-4 animate-spin text-[#777974]" />}
            </div>
            {query.trim() && (
              <div className="absolute left-0 right-0 top-[70px] z-10 max-h-64 overflow-y-auto rounded-md border border-white/[0.1] bg-[#101210] shadow-2xl">
                {results.length > 0 ? results.map((result) => (
                  <button key={`${result.market}-${result.code}`} type="button" onClick={() => selectResult(result)} className="grid w-full grid-cols-[36px_minmax(0,1fr)_56px] items-center gap-3 border-b border-white/[0.06] px-3 py-3 text-left transition last:border-0 hover:bg-white/[0.04]">
                    <span className="font-mono text-[8px] uppercase text-[#72746f]">{result.market}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-medium text-[#e5e4df]">{result.name}</span>
                      <span className="mt-0.5 block truncate text-[9px] text-[#636561]">{result.sector || result.thesis || "证券"}</span>
                    </span>
                    <span className="text-right font-mono text-[9px] text-[#8b8d87]">{result.code}</span>
                  </button>
                )) : !loading ? (
                  <div className="px-3 py-5 text-center text-[10px] text-[#656762]">没有找到匹配资产</div>
                ) : null}
              </div>
            )}
            <p className="mt-2 flex items-center gap-1.5 text-[9px] text-[#5f615d]"><Globe2 className="h-3 w-3" />A股场内ETF · A/H/美股 · 海外ETF</p>
          </div>

          {selectedAsset ? (
            <div className="border-y border-white/[0.08] py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="font-mono text-[9px] uppercase text-[#686a66]">{selectedAsset.market} · {selectedAsset.ticker}</span>
                  <strong className="mt-1 block truncate text-sm font-medium text-[#ecebe6]">{selectedAsset.name}</strong>
                  <span className="mt-1 block text-[9px] text-[#666863]">{selectedAsset.theme}</span>
                </div>
                <span className="shrink-0 rounded-sm bg-white/[0.05] px-2 py-1 text-[9px] text-[#858781]">{selectedAsset.weight > 0 ? `目标 ${selectedAsset.weight}%` : "目标未设置"}</span>
              </div>
              {selectedAsset.weight > 0 && (
                <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3">
                  <span className="text-[9px] text-[#62645f]">买入温度</span>
                  <strong className="text-[10px] font-medium" style={{ color: riskBand(selectedAsset.risk).color }}>{riskBand(selectedAsset.risk).short} · {selectedAsset.risk}</strong>
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-24 items-center justify-center border-y border-dashed border-white/[0.08] text-[10px] text-[#5f615d]">先检索并选择一项资产</div>
          )}

          <label>
            <span className="mb-2 block text-[10px] text-[#777974]">当前金额（人民币等值）</span>
            <div className="flex h-14 items-center rounded-md border border-white/[0.1] bg-[#0d0f0d] px-3 focus-within:border-white/[0.24]">
              <span className="mr-2 font-mono text-lg text-[#666863]">¥</span>
              <input type="number" min="0" step="0.01" value={draftAmount} onChange={(event) => setDraftAmount(event.target.value)} placeholder="20000" disabled={!selectedAsset} className="min-w-0 flex-1 bg-transparent font-mono text-2xl text-[#f1f0eb] outline-none placeholder:text-[#454743] disabled:opacity-40" />
            </div>
          </label>

          <div className="grid grid-cols-4 gap-2">
            {[10000, 20000, 50000, 100000].map((value) => (
              <button key={value} type="button" disabled={!selectedAsset} onClick={() => setDraftAmount(String(value))} className="h-9 rounded-md border border-white/[0.08] font-mono text-[10px] text-[#858781] transition hover:border-white/[0.18] hover:text-white disabled:opacity-30">{value / 10000}万</button>
            ))}
          </div>
          <p className="text-[10px] leading-5 text-[#666863]">刚买入可填写成交金额；之后按当前市值更新，圆环才会反映真实仓位。</p>
        </div>

        <div className="mt-auto flex gap-2 border-t border-white/[0.08] pt-5">
          {selectedAsset && amount > 0 && (
            <button type="button" onClick={() => onSave(selectedAsset, 0)} title="移出当前持仓" className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[#d95768]/20 text-[#d95768] transition hover:bg-[#d95768]/10"><X className="h-4 w-4" /></button>
          )}
          <button type="submit" disabled={!selectedAsset || !draftAmount || Number(draftAmount) <= 0} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-[#f1f0eb] text-xs font-semibold text-[#111210] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-35">
            <Check className="h-4 w-4" />保存当前持仓
          </button>
        </div>
      </form>
    </div>
  );
}
