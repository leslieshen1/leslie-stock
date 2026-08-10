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
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Cell, Pie, PieChart, Tooltip } from "recharts";

type Category = "核心指数" | "AI与机器人" | "医疗" | "资源能源" | "防守资产";

type Asset = {
  id: string;
  ticker: string;
  name: string;
  category: Category;
  weight: number;
  risk: number;
  role: string;
};

const STORAGE_KEY = "stockgod-future-allocation-v1";
const AS_OF = "2026-08-10";

const CATEGORY_ORDER: Category[] = ["核心指数", "AI与机器人", "医疗", "资源能源", "防守资产"];

const DEFAULT_ASSETS: Asset[] = [
  { id: "qqq", ticker: "QQQ", name: "纳斯达克100", category: "核心指数", weight: 15, risk: 72, role: "美国创新资产底仓" },
  { id: "a500", ticker: "A500", name: "中证A500 ETF", category: "核心指数", weight: 10, risk: 46, role: "A股核心宽基" },
  { id: "dividend", ticker: "515180", name: "中证红利 ETF", category: "核心指数", weight: 8, risk: 29, role: "股息与现金流" },
  { id: "hsi", ticker: "HSI", name: "恒生指数 ETF", category: "核心指数", weight: 7, risk: 38, role: "港股综合底仓" },
  { id: "baba", ticker: "BABA", name: "阿里巴巴", category: "AI与机器人", weight: 9, risk: 44, role: "云计算与中国AI" },
  { id: "botz", ticker: "BOTZ", name: "全球机器人 ETF", category: "AI与机器人", weight: 8, risk: 67, role: "全球自动化龙头" },
  { id: "cnrobot", ticker: "562500", name: "A股机器人 ETF", category: "AI与机器人", weight: 8, risk: 79, role: "国产机器人产业链" },
  { id: "kuaishou", ticker: "1024.HK", name: "快手", category: "AI与机器人", weight: 3, risk: 54, role: "AI视频应用" },
  { id: "yuewen", ticker: "0772.HK", name: "阅文集团", category: "AI与机器人", weight: 2, risk: 49, role: "IP与内容资产" },
  { id: "health", ticker: "MEDICAL", name: "A股宽基医疗基金", category: "医疗", weight: 8, risk: 31, role: "医疗需求与估值修复" },
  { id: "remx", ticker: "REMX", name: "稀有金属 ETF", category: "资源能源", weight: 4, risk: 70, role: "战略金属供给" },
  { id: "grid", ticker: "GRID", name: "全球电网 ETF", category: "资源能源", weight: 4, risk: 63, role: "电网升级与电气化" },
  { id: "xle", ticker: "XLE", name: "美国能源 ETF", category: "资源能源", weight: 2, risk: 41, role: "传统能源现金流" },
  { id: "gold", ticker: "518880", name: "黄金 ETF", category: "防守资产", weight: 7, risk: 57, role: "货币与极端风险缓冲" },
  { id: "cash", ticker: "CASH", name: "人民币 / USDC", category: "防守资产", weight: 5, risk: 6, role: "流动性与选择权" },
];

const RISK_BANDS = [
  { max: 24, label: "适合分批", short: "分批", color: "#3fb889", soft: "rgba(63,184,137,.12)" },
  { max: 44, label: "可以开始", short: "可买", color: "#8fbd66", soft: "rgba(143,189,102,.12)" },
  { max: 59, label: "中性观察", short: "观察", color: "#d0ad55", soft: "rgba(208,173,85,.12)" },
  { max: 74, label: "耐心等待", short: "等待", color: "#d9814f", soft: "rgba(217,129,79,.12)" },
  { max: 100, label: "高风险等待", short: "高位", color: "#d95768", soft: "rgba(217,87,104,.12)" },
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

export default function AllocationPlanner() {
  const [assets, setAssets] = useState<Asset[]>(DEFAULT_ASSETS);
  const [hydrated, setHydrated] = useState(false);
  const [filter, setFilter] = useState<Category | "全部">("全部");
  const [editingId, setEditingId] = useState<string | "new" | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Asset[];
        if (Array.isArray(parsed) && parsed.length > 0) setAssets(parsed);
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

  const categoryTotals = useMemo(() => CATEGORY_ORDER.map((category) => ({
    category,
    value: assets.filter((asset) => asset.category === category).reduce((sum, asset) => sum + asset.weight, 0),
  })), [assets]);

  const buyNow = useMemo(
    () => assets.filter((asset) => asset.risk <= 44 && asset.weight > 0).sort((a, b) => a.risk - b.risk),
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
        <section className="grid border-b border-white/[0.08] lg:grid-cols-[minmax(420px,0.9fr)_minmax(480px,1.1fr)]">
          <div className="flex min-h-[420px] items-center justify-center border-b border-white/[0.08] py-5 lg:min-h-[540px] lg:border-b-0 lg:border-r lg:border-white/[0.08] lg:pr-8">
            <div className="relative aspect-square w-full max-w-[440px]">
              {hydrated && (
                <PieChart responsive style={{ width: "100%", height: "100%" }}>
                  <Pie
                    data={assets.filter((asset) => asset.weight > 0)}
                    dataKey="weight"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius="61%"
                    outerRadius="94%"
                    paddingAngle={1.5}
                    cornerRadius={3}
                    stroke="#0b0c0c"
                    strokeWidth={3}
                    isAnimationActive={false}
                  >
                    {assets.filter((asset) => asset.weight > 0).map((asset) => (
                      <Cell key={asset.id} fill={riskBand(asset.risk).color} />
                    ))}
                  </Pie>
                  <Tooltip content={<AllocationTooltip />} />
                </PieChart>
              )}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="font-mono text-[11px] uppercase text-[#6f716d]">组合风险</span>
                <span className="mt-1 font-mono text-6xl font-medium tabular-nums" style={{ color: overallBand.color }}>{weightedRisk.toFixed(0)}</span>
                <span className="mt-1 text-sm font-medium" style={{ color: overallBand.color }}>{overallBand.label}</span>
                <span className="mt-5 font-mono text-[10px] text-[#747672]">{formatWeight(total)}% 已分配</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-center py-8 lg:py-10 lg:pl-10">
            <div className="flex items-end justify-between gap-6 border-b border-white/[0.08] pb-6">
              <div>
                <p className="text-[11px] text-[#737570]">当前状态</p>
                <p className="mt-2 text-2xl font-semibold text-[#f1f0eb]">{buyNow.length} 个标的进入可买区</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-2xl font-medium text-[#f1f0eb]">{Math.abs(100 - total).toFixed(1)}%</p>
                <p className="mt-1 text-[10px] text-[#6c6e69]">{Math.abs(total - 100) < 0.05 ? "比例完整" : total < 100 ? "待分配" : "超出目标"}</p>
              </div>
            </div>

            <div className="py-2">
              {buyNow.slice(0, 4).map((asset, index) => {
                const band = riskBand(asset.risk);
                return (
                  <button key={asset.id} type="button" onClick={() => setEditingId(asset.id)} className="group grid w-full grid-cols-[28px_minmax(0,1fr)_58px_64px_18px] items-center gap-3 border-b border-white/[0.06] py-3.5 text-left transition hover:bg-white/[0.025]">
                    <span className="font-mono text-[10px] text-[#5f615d]">0{index + 1}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-[#e8e7e2]">{asset.name}</span>
                      <span className="mt-0.5 block truncate font-mono text-[9px] text-[#686a66]">{asset.ticker} · {asset.role}</span>
                    </span>
                    <span className="text-right font-mono text-sm tabular-nums text-[#d8d7d2]">{formatWeight(asset.weight)}%</span>
                    <span className="rounded-sm px-2 py-1 text-center text-[10px] font-medium" style={{ color: band.color, background: band.soft }}>{band.short} {asset.risk}</span>
                    <ChevronRight className="h-4 w-4 text-[#4f514d] transition group-hover:text-[#989a95]" />
                  </button>
                );
              })}
            </div>

            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between text-[10px] text-[#696b67]">
                <span>风险温度</span><span>便宜</span><span>等待</span>
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

        <section className="border-b border-white/[0.08] py-6">
          <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-5">
            {categoryTotals.map(({ category, value }) => (
              <button key={category} type="button" onClick={() => setFilter(filter === category ? "全部" : category)} className={`text-left transition ${filter === category ? "opacity-100" : "opacity-65 hover:opacity-100"}`}>
                <span className="block text-[10px] text-[#858782]">{category}</span>
                <span className="mt-1.5 block font-mono text-2xl font-medium tabular-nums text-[#f1f0eb]">{formatWeight(value)}%</span>
                <span className="mt-2 block h-px w-full bg-white/[0.08]"><span className="block h-px bg-[#9d9f99]" style={{ width: `${Math.min(100, value * 2.5)}%` }} /></span>
              </button>
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
            <div className="hidden grid-cols-[88px_minmax(220px,1.3fr)_minmax(150px,0.8fr)_minmax(190px,1fr)_78px_28px] gap-4 border-b border-white/[0.08] px-3 py-3 font-mono text-[8px] uppercase text-[#5f615d] md:grid">
              <span>代码</span><span>资产</span><span>分类</span><span>风险</span><span className="text-right">目标</span><span />
            </div>
            <div className="divide-y divide-white/[0.06]">
              {shownAssets.map((asset) => {
                const band = riskBand(asset.risk);
                return (
                  <button key={asset.id} type="button" onClick={() => setEditingId(asset.id)} className="group grid w-full grid-cols-[54px_minmax(0,1fr)_62px_18px] items-center gap-3 px-3 py-4 text-left transition hover:bg-white/[0.025] md:grid-cols-[88px_minmax(220px,1.3fr)_minmax(150px,0.8fr)_minmax(190px,1fr)_78px_28px] md:gap-4">
                    <span className="font-mono text-[10px] uppercase text-[#7b7d78]">{asset.ticker}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-[#e9e8e3]">{asset.name}</span>
                      <span className="mt-1 block truncate text-[10px] text-[#636561]">{asset.role}</span>
                    </span>
                    <span className="hidden text-[11px] text-[#747671] md:block">{asset.category}</span>
                    <span className="hidden items-center gap-3 md:flex">
                      <span className="h-1.5 min-w-0 flex-1 bg-white/[0.06]"><span className="block h-full" style={{ width: `${asset.risk}%`, backgroundColor: band.color }} /></span>
                      <span className="w-16 text-right text-[10px] font-medium" style={{ color: band.color }}>{band.label} {asset.risk}</span>
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

function AllocationTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Asset }> }) {
  if (!active || !payload?.[0]) return null;
  const asset = payload[0].payload;
  const band = riskBand(asset.risk);
  return (
    <div className="min-w-44 rounded-md border border-white/[0.12] bg-[#151715] px-3 py-2.5 shadow-2xl">
      <div className="flex items-baseline justify-between gap-5">
        <span className="text-xs font-medium text-[#f1f0eb]">{asset.name}</span>
        <span className="font-mono text-sm text-[#f1f0eb]">{formatWeight(asset.weight)}%</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px]">
        <span className="font-mono text-[#6f716d]">{asset.ticker}</span>
        <span style={{ color: band.color }}>{band.label} · {asset.risk}</span>
      </div>
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
    category: "核心指数",
    weight: 0,
    risk: 50,
    role: "",
  });
  const band = riskBand(draft.risk);

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
                <span className="block text-[10px] text-[#777974]">风险温度</span>
                <span className="mt-1 block text-xs font-medium" style={{ color: band.color }}>{band.label}</span>
              </div>
              <span className="font-mono text-3xl font-medium" style={{ color: band.color }}>{draft.risk}</span>
            </div>
            <input type="range" min="0" max="100" step="1" value={draft.risk} onChange={(event) => setDraft({ ...draft, risk: clamp(Number(event.target.value), 0, 100) })} aria-label={`${draft.name || "新资产"}风险温度`} className="allocation-range w-full" style={{ "--risk-color": band.color, "--risk-value": `${draft.risk}%` } as React.CSSProperties} />
            <div className="mt-3 flex justify-between font-mono text-[8px] text-[#5e605c]"><span>0 · 适合分批</span><span>100 · 高风险等待</span></div>
          </div>
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
