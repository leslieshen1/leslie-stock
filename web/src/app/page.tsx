import { promises as fs } from "fs";
import path from "path";
import PulseClient from "./pulse/PulseClient";
import {
  COMPANIES_WITH_HEAT,
  enrichWithSnapshot,
  mergeSupplement,
  type PulseSnapshot,
  type SupplementItem,
} from "@/lib/supply-chain";
import { loadTrends } from "@/lib/pulse-static";

// Home = Heatmap（不藏起来）
async function loadSnapshot(): Promise<PulseSnapshot | null> {
  try {
    const p = path.join(process.cwd(), "public", "data", "pulse-snapshot.json");
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as PulseSnapshot;
  } catch {
    return null;
  }
}

async function loadSupplement(): Promise<SupplementItem[] | null> {
  try {
    const p = path.join(process.cwd(), "public", "data", "pulse-supplement.json");
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as SupplementItem[];
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const [snapshot, supplement] = await Promise.all([loadSnapshot(), loadSupplement()]);
  const baseItems = snapshot ? enrichWithSnapshot(snapshot) : COMPANIES_WITH_HEAT;
  const items = mergeSupplement(baseItems, supplement);
  const liveCount = items.filter((i) => i.dataSource === "live").length;
  const serenityCount = items.filter((i) => i.dataSource === "serenity").length;
  const generatedAt = snapshot?.generated_at ?? null;

  // 30 天 trend 从静态 JSON 读
  const trends = await loadTrends();

  return (
    <main className="mx-auto max-w-[1480px] px-6 py-10">
      <PulseClient
        items={items}
        trends={trends}
        liveCount={liveCount}
        generatedAtLabel={generatedAt ? fmtAge(generatedAt) : null}
      />

      <footer className="mt-12 border-t border-zinc-200 pt-8 text-center">
        <p className="text-sm font-medium text-zinc-700">
          你不是股神，但股神陪你一起看股票。
        </p>
        <p className="mt-2 text-xs text-zinc-400">
          我不是股神 · Not a Stock Guru · v0.5 · 段巴 + Serenity 三方框架 × Claude × Next.js
        </p>
        <p className="mt-1 text-[10px] text-zinc-400">
          {generatedAt
            ? "数据 = yfinance 5y OHLC + Serenity 评分（5,510 只 A 股）· 非投资建议"
            : "mock 热度；运行 npm run fetch-pulse 接入真实"}
        </p>
      </footer>
    </main>
  );
}

function fmtAge(iso: string): string {
  const t = new Date(iso).getTime();
  const diffMs = Date.now() - t;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  return `${days} 天前`;
}
