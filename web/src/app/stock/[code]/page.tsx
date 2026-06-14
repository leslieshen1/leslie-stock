import Link from "next/link";
import { promises as fs } from "fs";
import path from "path";
import { loadAnalysis } from "@/lib/data";
import { getStockHolders } from "@/lib/whales";
import { loadDilutionFlags } from "@/lib/dilution";
import { loadUsPanel } from "@/lib/us-panel";
import { loadStockTypes } from "@/lib/stock-type";
import { loadFundamentals } from "@/lib/fundamentals";
import { loadNews } from "@/lib/news";
import { loadEarnings } from "@/lib/earnings";
import { loadOptions } from "@/lib/options";
import StockDetailClient from "./StockDetailClient";
import DilutionWarning from "./DilutionWarning";
import MasterPanel from "./MasterPanel";
import StockTypeCard from "./StockTypeCard";
import FundamentalsStrip from "./FundamentalsStrip";
import NewsStrip from "./NewsStrip";
import EarningsChip from "./EarningsChip";
import OptionsGammaLine from "./OptionsGammaLine";
import LivePrice from "./LivePrice";

// ETF 识别:us-etfs.json(Nasdaq ETF 全列表)。ETF 没有五方/基本面/持仓这些个股功能,
// 走专属精简页,不渲染一页空壳。
type EtfRec = { sym: string; name: string; price: number | null; pct: number | null; ret1y: number | null };
async function loadEtf(code: string): Promise<EtfRec | null> {
  try {
    const p = path.join(process.cwd(), "public", "data", "us-etfs.json");
    const list = JSON.parse(await fs.readFile(p, "utf-8")).etfs as EtfRec[];
    return list.find((e) => e.sym === code.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}

function EtfDetail({ etf }: { etf: EtfRec }) {
  const up1y = (etf.ret1y ?? 0) >= 0;
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <div className="mb-3 flex items-center gap-2 text-xs">
          <Link href="/" className="text-muted hover:text-ink">热力图</Link>
          <span className="text-faint">/</span>
          <Link href="/scan" className="text-muted hover:text-ink">扫描</Link>
          <span className="text-faint">/</span>
          <span className="text-muted">{etf.name || etf.sym}</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">{etf.name || etf.sym}</h1>
          <code className="font-mono text-base text-muted">{etf.sym}</code>
          <span className="inline-flex rounded-md border border-accent/30 bg-surface-2 px-2 py-0.5 text-xs font-medium text-accent">ETF</span>
          <span className="inline-flex rounded-md border border-accent/30 bg-surface-2 px-2 py-0.5 text-xs font-medium text-accent">美股</span>
        </div>
        <div className="mt-2">
          <LivePrice code={etf.sym} market="us" initialPrice={etf.price ?? null} />
        </div>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-faint">近 1 年回报</p>
          <p className={`mt-0.5 font-mono text-xl font-semibold ${up1y ? "text-up" : "text-down"}`}>
            {etf.ret1y != null ? `${up1y ? "+" : ""}${etf.ret1y}%` : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-faint">快照价(上次收盘)</p>
          <p className="mt-0.5 font-mono text-xl font-semibold text-ink">
            {etf.price != null ? `$${etf.price.toFixed(2)}` : "—"}
            {etf.pct != null && (
              <span className={`ml-2 text-sm ${etf.pct >= 0 ? "text-up" : "text-down"}`}>
                {etf.pct >= 0 ? "+" : ""}{etf.pct.toFixed(2)}%
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
        这是一只 <span className="font-medium text-ink">ETF(交易所交易基金)</span>——五方判读、基本面、产业链位置、大佬持仓是<span className="text-ink">个股</span>功能,不适用于 ETF。
        想看全部 ETF,回 <Link href="/scan" className="text-accent hover:underline">列表 · ETF 视图</Link>。
      </div>

      <footer className="mt-10 text-center text-[10px] text-faint">实时行情(Nasdaq)· 非投资建议</footer>
    </main>
  );
}

export default async function StockDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ market?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
 const marketRaw = (sp.market || "a").toLowerCase();
 const market = (["a", "hk", "us"].includes(marketRaw) ? marketRaw : "a") as
 | "a"
 | "hk"
 | "us";
  // ETF → 专属精简页(在加载任何个股数据之前分流)
  if (market === "us") {
    const etf = await loadEtf(code);
    if (etf) return <EtfDetail etf={etf} />;
  }
  // 五方面板:有就显示(美股全量 + 已录入五方的 A 股,如 688017 绿的谐波)
  const usPanel = loadUsPanel(code);
  const stockTypes = loadStockTypes(code); // 类型轴:先定该用什么尺子量
  const fundamentals = loadFundamentals(code); // 真实基本面(Yahoo)
  const news = loadNews(code); // 个股新闻(Google News)
  const earnings = loadEarnings(code); // 下次财报(Finnhub,需 key)
  const options = loadOptions(code); // 期权 gamma(Polygon,需 key)
  // 有五方面板时美股的旧单框架退场;A 股保留 aleabit/Serenity 深度分析(与五方面板互补)
  const initial = (usPanel && market === "us") ? null : loadAnalysis(code, market);
  const holders = getStockHolders(code);
  const dilution = market === "us" ? loadDilutionFlags()[code.toUpperCase()] : undefined;

  // 市值显示:$2.18T / $43B / $940M
  const fmtCap = (b?: number | null) =>
    b == null ? null : b >= 1000 ? `$${(b / 1000).toFixed(2)}T` : b >= 1 ? `$${b.toFixed(1)}B` : `$${Math.round(b * 1000)}M`;
  const mcap = fmtCap(usPanel?.mcapB);

 const marketLabel = market === "a" ? "A 股" : market === "hk" ? "港股" : "美股";
  const marketTone =
 market === "a"
 ? "bg-down-soft text-down border-down/30"
 : market === "hk"
 ? "bg-surface-2 text-accent border-line"
 : "bg-surface-2 text-accent border-accent/30";

  return (
 <main className="mx-auto max-w-6xl px-6 py-8">
      {/* 面包屑 + 股票名 */}
 <header className="mb-6">
 <div className="mb-3 flex items-center gap-2 text-xs">
 <Link href="/" className="text-muted hover:text-ink">热力图</Link>
 <span className="text-faint">/</span>
 <Link href="/scan" className="text-muted hover:text-ink">扫描</Link>
 <span className="text-faint">/</span>
 <Link href="/portfolio" className="text-muted hover:text-ink">观察</Link>
 <span className="text-faint">/</span>
 <span className="text-muted">{initial?.name || code}</span>
        </div>
 <div className="flex flex-wrap items-baseline gap-3">
 <h1 className="text-3xl font-semibold tracking-tight text-ink">
            {usPanel?.name || initial?.name || code}
          </h1>
 <code className="font-mono text-base text-muted">{code}</code>
          <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${marketTone}`}>
            {marketLabel}
          </span>
        </div>
        {/* 市值 · 行业 · 链定位 —— 之前页头只有代码+价格,连公司是干嘛的都不知道(2026-06-12 反馈) */}
        {(mcap || usPanel?.sector || usPanel?.chain?.industry) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {mcap && <span>市值 <span className="font-mono font-semibold text-ink">{mcap}</span></span>}
            {usPanel?.sector && <span>{usPanel.sector}</span>}
            {usPanel?.chain?.industry && <span className="text-accent">{usPanel.chain.industry}</span>}
          </div>
        )}
        <div className="mt-2">
          <LivePrice code={code} market={market} initialPrice={fundamentals?.px ?? null} />
        </div>
        {/* 公司画像:判读时生成的业务角色一句话(库里现成的"描述") */}
        {usPanel?.chain?.role && (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{usPanel.chain.role}</p>
        )}
        {/* 串联热力图:跳回首页并自动定位选中这只(revealAndSelect 跨产业/区域) */}
        {usPanel && (
          <Link href={`/?highlight=${encodeURIComponent(code)}`}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent transition hover:brightness-110">
            在热力图中定位 →
          </Link>
        )}
      </header>

      {dilution && <DilutionWarning flag={dilution} />}

      {earnings && (
        <div className="mb-4">
          <EarningsChip e={earnings} />
        </div>
      )}

      {stockTypes.length > 0 && (
        <div className="mb-4">
          <StockTypeCard types={stockTypes} />
        </div>
      )}

      {fundamentals && (
        <div className="mb-4">
          <FundamentalsStrip f={fundamentals} types={stockTypes} />
        </div>
      )}

      {options && (
        <div className="mb-4">
          <OptionsGammaLine o={options} />
        </div>
      )}

      {usPanel && <MasterPanel data={usPanel} />}

      {news.length > 0 && (
        <div className="mt-4">
          <NewsStrip items={news} />
        </div>
      )}

      <StockDetailClient code={code} market={market} initial={initial} holders={holders} hasPanel={!!usPanel} />
    </main>
  );
}
