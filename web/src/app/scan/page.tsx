import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import { loadAleabitManifest } from "@/lib/data";
import ScanClient, { type UsStock } from "./ScanClient";

function loadUsStocks(): UsStock[] {
  const candidates = [
    path.join(process.cwd(), "public", "data", "us-stocks.json"),
    path.join(process.cwd(), "web", "public", "data", "us-stocks.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf-8");
      const j = JSON.parse(raw) as { stocks?: UsStock[] };
      if (j.stocks?.length) return j.stocks;
    } catch {
      // try next
    }
  }
  return [];
}

export default function ScanPage() {
  const items = loadAleabitManifest();
  const usStocks = loadUsStocks();

  return (
 <main className="mx-auto max-w-7xl px-6 py-10">
 <header className="mb-6 border-b border-line pb-6">
 <div className="mb-3 flex items-center gap-3 text-sm">
 <Link href="/" className="text-muted hover:text-ink">
            ← 脉冲热力图
          </Link>
 <span className="text-faint">/</span>
 <Link href="/watchlist" className="text-accent hover:text-accent font-medium">
             我的观察列表
          </Link>
        </div>
 <div className="flex items-baseline justify-between">
          <div>
 <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink">
              全市场扫描
            </h1>
 <p className="mt-1 text-sm text-muted">
              A 股 {items.length} 只 · 瓶颈狙击评分　|　美股 {usStocks.length} 只 · 市值 / 动量
            </p>
          </div>
        </div>
      </header>

      <ScanClient items={items} usStocks={usStocks} />

 <footer className="mt-16 border-t border-line pt-6 text-center text-xs text-faint">
        我不是股神 · Not a Stock Guru · A股 Serenity 框架 + 美股 Nasdaq 全市场（非投资建议）
      </footer>
    </main>
  );
}
