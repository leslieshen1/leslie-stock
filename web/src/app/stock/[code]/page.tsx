import Link from "next/link";
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
  // 五方面板:有就显示(美股全量 + 已录入五方的 A 股,如 688017 绿的谐波)
  const usPanel = loadUsPanel(code);
  const stockTypes = loadStockTypes(code); // 类型轴:先定该用什么尺子量
  const fundamentals = loadFundamentals(code); // 真实基本面(Yahoo)
  const news = loadNews(code); // 个股新闻(Google News)
  const earnings = loadEarnings(code); // 下次财报(Finnhub,需 key)
  const options = loadOptions(code); // 期权 gamma(Polygon,需 key)
  // 有五方面板时,旧的单一框架深度分析(MU/CRCL/CBRS)退场,不再并存矛盾
  const initial = usPanel ? null : loadAnalysis(code, market);
  const holders = getStockHolders(code);
  const dilution = market === "us" ? loadDilutionFlags()[code.toUpperCase()] : undefined;

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
 <div className="flex items-baseline gap-3">
 <h1 className="text-3xl font-semibold tracking-tight text-ink">
            {initial?.name || code}
          </h1>
 <code className="font-mono text-base text-muted">{code}</code>
          <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${marketTone}`}>
            {marketLabel}
          </span>
        </div>
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
