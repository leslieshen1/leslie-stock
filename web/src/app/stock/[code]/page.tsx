import Link from "next/link";
import { loadAnalysis } from "@/lib/data";
import { getStockHolders } from "@/lib/whales";
import { loadDilutionFlags } from "@/lib/dilution";
import { loadUsPanel } from "@/lib/us-panel";
import StockDetailClient from "./StockDetailClient";
import DilutionWarning from "./DilutionWarning";
import FiveMasterPanel from "./FiveMasterPanel";

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
  const initial = loadAnalysis(code, market);
  const holders = getStockHolders(code);
  const dilution = market === "us" ? loadDilutionFlags()[code.toUpperCase()] : undefined;
  const usPanel = market === "us" ? loadUsPanel(code) : null;

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

      {usPanel && <FiveMasterPanel data={usPanel} />}

      <StockDetailClient code={code} market={market} initial={initial} holders={holders} />
    </main>
  );
}
