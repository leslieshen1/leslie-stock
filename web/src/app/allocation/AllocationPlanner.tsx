"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Plus,
  RotateCcw,
  Scale,
  Target,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  Tooltip,
} from "recharts";

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

const CATEGORY_ORDER: Category[] = [
  "核心指数",
  "AI与机器人",
  "医疗",
  "资源能源",
  "防守资产",
];

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
  { max: 24, label: "适合分批", color: "#16865f", soft: "rgba(22,134,95,.14)" },
  { max: 44, label: "可以开始", color: "#72ad54", soft: "rgba(114,173,84,.14)" },
  { max: 59, label: "中性观察", color: "#d3aa43", soft: "rgba(211,170,67,.14)" },
  { max: 74, label: "耐心等待", color: "#de7c3d", soft: "rgba(222,124,61,.14)" },
  { max: 100, label: "高风险等待", color: "#d84d5f", soft: "rgba(216,77,95,.14)" },
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
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState<Category | "全部">("全部");

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
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(assets));
  }, [assets, hydrated]);

  const total = useMemo(() => assets.reduce((sum, asset) => sum + asset.weight, 0), [assets]);
  const weightedRisk = useMemo(() => {
    if (total <= 0) return 0;
    return assets.reduce((sum, asset) => sum + asset.weight * asset.risk, 0) / total;
  }, [assets, total]);
  const overallBand = riskBand(weightedRisk);

  const categoryTotals = useMemo(
    () => CATEGORY_ORDER.map((category) => ({
      category,
      value: assets.filter((asset) => asset.category === category).reduce((sum, asset) => sum + asset.weight, 0),
    })),
    [assets],
  );

  const shownAssets = filter === "全部" ? assets : assets.filter((asset) => asset.category === filter);

  function updateAsset(id: string, patch: Partial<Asset>) {
    setAssets((current) => current.map((asset) => asset.id === id ? { ...asset, ...patch } : asset));
  }

  function removeAsset(id: string) {
    setAssets((current) => current.filter((asset) => asset.id !== id));
  }

  function normalizeWeights() {
    if (total <= 0) return;
    const normalized = assets.map((asset) => ({ ...asset, weight: Number((asset.weight / total * 100).toFixed(1)) }));
    const normalizedTotal = normalized.reduce((sum, asset) => sum + asset.weight, 0);
    const difference = Number((100 - normalizedTotal).toFixed(1));
    if (normalized.length > 0) normalized[0].weight = Number((normalized[0].weight + difference).toFixed(1));
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

  return (
    <main className="mx-auto max-w-[1480px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <header className="border-b border-line pb-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="kicker">Future Allocation / {AS_OF}</p>
            <h1 className="mt-3 max-w-4xl font-display text-4xl font-semibold leading-tight text-ink sm:text-5xl">
              优质资产先留下，<span className="italic text-accent">价格不合适就等。</span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
              目标比例决定未来往哪里走，风险温度决定现在要不要动手。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={normalizeWeights} title="归一到100%" className="inline-flex h-10 items-center gap-2 rounded-md border border-line-2 bg-surface px-3 text-sm text-muted transition hover:bg-surface-2 hover:text-ink">
              <Scale className="h-4 w-4" /> 归一
            </button>
            <button type="button" onClick={exportPlan} title="导出配置" className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line-2 bg-surface text-muted transition hover:bg-surface-2 hover:text-ink">
              <Download className="h-4 w-4" />
            </button>
            <label title="导入配置" className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-md border border-line-2 bg-surface text-muted transition hover:bg-surface-2 hover:text-ink">
              <Upload className="h-4 w-4" />
              <input type="file" accept="application/json" onChange={importPlan} className="sr-only" />
            </label>
            <button type="button" onClick={resetDefaults} title="恢复默认" className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line-2 bg-surface text-muted transition hover:bg-surface-2 hover:text-ink">
              <RotateCcw className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setAddOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-[#160d08] transition hover:bg-accent-bright">
              <Plus className="h-4 w-4" /> 新增标的
            </button>
          </div>
        </div>
      </header>

      <section className="grid border-b border-line xl:grid-cols-[minmax(390px,0.88fr)_minmax(520px,1.12fr)]">
        <div className="flex min-h-[480px] items-center justify-center border-b border-line px-2 py-8 sm:px-8 xl:border-b-0 xl:border-r">
          <div className="relative h-[390px] w-full max-w-[470px]">
            {hydrated && (
              <PieChart responsive style={{ width: "100%", height: "100%" }}>
                <Pie
                  data={assets.filter((asset) => asset.weight > 0)}
                  dataKey="weight"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="50%"
                  outerRadius="88%"
                  paddingAngle={1.2}
                  stroke="rgba(8,9,11,.65)"
                  strokeWidth={2}
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
              <span className="font-mono text-5xl font-semibold tabular-nums text-ink">{formatWeight(total)}%</span>
              <span className="mt-2 text-xs uppercase tracking-[0.22em] text-faint">目标总仓位</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center px-5 py-8 sm:px-9">
          <div className="flex items-start justify-between gap-6 border-b border-line pb-6">
            <div>
              <p className="text-sm text-muted">组合风险温度</p>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="font-mono text-5xl font-semibold tabular-nums" style={{ color: overallBand.color }}>{weightedRisk.toFixed(0)}</span>
                <span className="text-base font-medium" style={{ color: overallBand.color }}>{overallBand.label}</span>
              </div>
            </div>
            <div className={`rounded-md border px-3 py-2 text-right ${Math.abs(total - 100) < 0.05 ? "border-up/30 bg-up-soft text-up" : "border-down/30 bg-down-soft text-down"}`}>
              <p className="font-mono text-xl font-semibold tabular-nums">{Math.abs(100 - total).toFixed(1)}%</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wider">{Math.abs(total - 100) < 0.05 ? "比例完整" : total < 100 ? "尚未分配" : "超出目标"}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-5 py-7 sm:grid-cols-3">
            {categoryTotals.map(({ category, value }) => (
              <button key={category} type="button" onClick={() => setFilter(filter === category ? "全部" : category)} className="group text-left">
                <span className="block text-xs text-faint transition group-hover:text-muted">{category}</span>
                <span className="mt-1 block font-mono text-2xl font-medium tabular-nums text-ink">{formatWeight(value)}%</span>
              </button>
            ))}
          </div>

          <div className="border-t border-line pt-5">
            <div className="mb-3 flex items-center justify-between text-xs text-muted">
              <span>风险温度</span><span>绿色可买 · 红色等待</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {RISK_BANDS.map((band, index) => (
                <button key={band.label} type="button" onClick={() => setFilter("全部")} className="min-w-0 text-left">
                  <span className="block h-2 w-full" style={{ background: band.color }} />
                  <span className="mt-2 block truncate text-[10px] text-faint">{index === 0 ? "0" : RISK_BANDS[index - 1].max + 1}–{band.max}</span>
                  <span className="mt-0.5 hidden text-[10px] text-muted sm:block">{band.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="pt-8">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="kicker">Asset Ledger</p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">未来持仓目标</h2>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["全部", ...CATEGORY_ORDER] as const).map((category) => (
              <button key={category} type="button" onClick={() => setFilter(category)} className={`rounded-md px-3 py-1.5 text-xs transition ${filter === category ? "bg-accent text-[#160d08]" : "bg-surface text-muted hover:bg-surface-2 hover:text-ink"}`}>
                {category}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-hidden border-y border-line bg-surface/45">
          <div className="hidden grid-cols-[minmax(220px,1.35fr)_150px_220px_92px_56px] gap-5 border-b border-line px-5 py-3 text-[10px] uppercase tracking-[0.18em] text-faint lg:grid">
            <span>资产</span><span>分类</span><span>风险温度</span><span className="text-right">目标</span><span />
          </div>
          <div className="divide-y divide-line">
            {shownAssets.map((asset) => {
              const band = riskBand(asset.risk);
              return (
                <div key={asset.id} className="grid gap-4 px-4 py-5 transition hover:bg-surface-2/60 sm:px-5 lg:grid-cols-[minmax(220px,1.35fr)_150px_220px_92px_56px] lg:items-center lg:gap-5">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <input value={asset.name} onChange={(event) => updateAsset(asset.id, { name: event.target.value })} aria-label="资产名称" className="min-w-0 flex-1 border-0 bg-transparent p-0 text-base font-semibold text-ink outline-none" />
                      <input value={asset.ticker} onChange={(event) => updateAsset(asset.id, { ticker: event.target.value.toUpperCase() })} aria-label="代码" className="w-20 border-0 bg-transparent p-0 text-right font-mono text-xs uppercase text-muted outline-none" />
                    </div>
                    <input value={asset.role} onChange={(event) => updateAsset(asset.id, { role: event.target.value })} aria-label="资产角色" className="mt-1 w-full border-0 bg-transparent p-0 text-xs text-faint outline-none" />
                  </div>

                  <select value={asset.category} onChange={(event) => updateAsset(asset.id, { category: event.target.value as Category })} aria-label="资产分类" className="h-9 rounded-md border border-line bg-base px-2 text-xs text-muted outline-none">
                    {CATEGORY_ORDER.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>

                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="font-medium" style={{ color: band.color }}>{band.label}</span>
                      <span className="font-mono tabular-nums text-muted">{asset.risk}</span>
                    </div>
                    <input type="range" min="0" max="100" step="1" value={asset.risk} onChange={(event) => updateAsset(asset.id, { risk: clamp(Number(event.target.value), 0, 100) })} aria-label={`${asset.name}风险温度`} className="risk-range w-full" style={{ "--risk-color": band.color, "--risk-value": `${asset.risk}%` } as React.CSSProperties} />
                  </div>

                  <label className="flex items-center justify-between gap-3 lg:justify-end">
                    <span className="text-xs text-faint lg:hidden">目标比例</span>
                    <span className="flex h-10 w-[92px] items-center rounded-md border border-line bg-base px-2">
                      <input type="number" min="0" max="100" step="0.5" value={asset.weight} onChange={(event) => updateAsset(asset.id, { weight: clamp(Number(event.target.value), 0, 100) })} aria-label={`${asset.name}目标比例`} className="w-full border-0 bg-transparent text-right font-mono text-base tabular-nums text-ink outline-none" />
                      <span className="ml-1 text-xs text-faint">%</span>
                    </span>
                  </label>

                  <button type="button" onClick={() => removeAsset(asset.id)} title={`删除${asset.name}`} className="inline-flex h-9 w-9 items-center justify-center justify-self-end rounded-md text-faint transition hover:bg-down-soft hover:text-down">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <footer className="mt-7 flex flex-col gap-2 border-t border-line pt-5 text-xs leading-relaxed text-faint sm:flex-row sm:items-center sm:justify-between">
        <span>风险温度是研究判断，不是涨跌预测；数据自动保存在当前浏览器。</span>
        <span className="font-mono">Not financial advice · {hydrated ? "SAVED" : "LOADING"}</span>
      </footer>

      {addOpen && <AddAssetDialog onClose={() => setAddOpen(false)} onAdd={(asset) => { setAssets((current) => [...current, asset]); setAddOpen(false); }} />}

      <style jsx global>{`
        .risk-range {
          appearance: none;
          height: 5px;
          border-radius: 0;
          background: linear-gradient(to right, var(--risk-color) 0 var(--risk-value), var(--color-surface-3) var(--risk-value) 100%);
          cursor: pointer;
        }
        .risk-range::-webkit-slider-thumb {
          appearance: none;
          width: 15px;
          height: 15px;
          border-radius: 50%;
          border: 2px solid var(--color-base);
          background: var(--risk-color);
          box-shadow: 0 0 0 1px var(--color-line-2);
        }
        .risk-range::-moz-range-thumb {
          width: 13px;
          height: 13px;
          border-radius: 50%;
          border: 2px solid var(--color-base);
          background: var(--risk-color);
        }
      `}</style>
    </main>
  );
}

function AllocationTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Asset }> }) {
  if (!active || !payload?.[0]) return null;
  const asset = payload[0].payload;
  const band = riskBand(asset.risk);
  return (
    <div className="min-w-44 rounded-md border border-line-2 bg-surface px-3 py-2 shadow-2xl">
      <div className="flex items-baseline justify-between gap-5">
        <span className="text-sm font-semibold text-ink">{asset.name}</span>
        <span className="font-mono text-sm text-ink">{formatWeight(asset.weight)}%</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="text-faint">{asset.ticker}</span>
        <span style={{ color: band.color }}>{band.label} · {asset.risk}</span>
      </div>
    </div>
  );
}

function AddAssetDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (asset: Asset) => void }) {
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("核心指数");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    onAdd({
      id: `${Date.now()}-${ticker || name}`,
      ticker: ticker.trim().toUpperCase() || "NEW",
      name: name.trim(),
      category,
      weight: 0,
      risk: 50,
      role: "待定义资产角色",
    });
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm sm:items-center" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <form onSubmit={submit} className="w-full max-w-lg rounded-md border border-line-2 bg-surface p-5 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <div className="flex items-center gap-2 text-accent"><Target className="h-4 w-4" /><span className="kicker">New Asset</span></div>
            <h2 className="mt-2 text-2xl font-semibold text-ink">加入优质资产池</h2>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-muted hover:text-ink">关闭</button>
        </div>
        <div className="grid gap-4 py-6 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="mb-1.5 block text-xs text-muted">资产名称</span>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：标普500 ETF" className="h-11 w-full rounded-md border border-line-2 bg-base px-3 text-sm text-ink outline-none placeholder:text-faint" />
          </label>
          <label>
            <span className="mb-1.5 block text-xs text-muted">代码</span>
            <input value={ticker} onChange={(event) => setTicker(event.target.value)} placeholder="Ticker" className="h-11 w-full rounded-md border border-line-2 bg-base px-3 font-mono text-sm uppercase text-ink outline-none placeholder:text-faint" />
          </label>
          <label>
            <span className="mb-1.5 block text-xs text-muted">分类</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as Category)} className="h-11 w-full rounded-md border border-line-2 bg-base px-3 text-sm text-ink outline-none">
              {CATEGORY_ORDER.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <button type="submit" className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-accent text-sm font-semibold text-[#160d08] transition hover:bg-accent-bright">
          <Plus className="h-4 w-4" /> 加入候选池
        </button>
      </form>
    </div>
  );
}
