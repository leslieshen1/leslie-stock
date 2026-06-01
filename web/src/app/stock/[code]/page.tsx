import Link from "next/link";
import { loadAnalysis } from "@/lib/data";
import { getStockHolders } from "@/lib/whales";
import StockDetailClient from "./StockDetailClient";

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

  const marketLabel = market === "a" ? "A 股" : market === "hk" ? "港股" : "美股";
  const marketTone =
    market === "a"
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : market === "hk"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : "bg-violet-50 text-violet-700 border-violet-200";

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      {/* 面包屑 + 股票名 */}
      <header className="mb-6">
        <div className="mb-3 flex items-center gap-2 text-xs">
          <Link href="/" className="text-zinc-500 hover:text-zinc-900">热力图</Link>
          <span className="text-zinc-300">/</span>
          <Link href="/scan" className="text-zinc-500 hover:text-zinc-900">扫描</Link>
          <span className="text-zinc-300">/</span>
          <Link href="/watchlist" className="text-zinc-500 hover:text-zinc-900">观察</Link>
          <span className="text-zinc-300">/</span>
          <span className="text-zinc-700">{initial?.name || code}</span>
        </div>
        <div className="flex items-baseline gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            {initial?.name || code}
          </h1>
          <code className="font-mono text-base text-zinc-500">{code}</code>
          <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${marketTone}`}>
            {marketLabel}
          </span>
        </div>
      </header>

      <StockDetailClient code={code} market={market} initial={initial} holders={holders} />
    </main>
  );
}
