import Link from "next/link";
import { loadAnalysis } from "@/lib/data";
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

  const marketLabel = market === "a" ? "A 股" : market === "hk" ? "港股" : "美股";
  const marketColor =
    market === "a"
      ? "bg-red-50 text-red-700"
      : market === "hk"
      ? "bg-blue-50 text-blue-700"
      : "bg-violet-50 text-violet-700";

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 border-b border-zinc-200 pb-6">
        <div className="mb-2 flex items-center gap-3 text-sm">
          <Link href="/" className="text-zinc-500 hover:text-zinc-900">
            ← 观察列表
          </Link>
          <span className="text-zinc-300">/</span>
          <Link href="/portfolio" className="text-zinc-500 hover:text-zinc-900">
            我的持仓
          </Link>
        </div>
        <div className="flex items-baseline gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            {initial?.name || code}
          </h1>
          <code className="font-mono text-base text-zinc-500">{code}</code>
          <span
            className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${marketColor}`}
          >
            {marketLabel}
          </span>
        </div>
        {initial?.industry && (
          <p className="mt-1 text-sm text-zinc-500">{initial.industry}</p>
        )}
      </header>

      <StockDetailClient code={code} market={market} initial={initial} />
    </main>
  );
}
