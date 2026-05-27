import { promises as fs } from "fs";
import path from "path";
import PulseClient from "./pulse/PulseClient";
import {
  COMPANIES_WITH_HEAT,
  enrichWithSnapshot,
  type PulseSnapshot,
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

export default async function HomePage() {
  const snapshot = await loadSnapshot();
  const items = snapshot ? enrichWithSnapshot(snapshot) : COMPANIES_WITH_HEAT;
  const liveCount = items.filter((i) => i.dataSource === "live").length;
  const generatedAt = snapshot?.generated_at ?? null;

  // 30 天 trend 从静态 JSON 读
  const trends = await loadTrends();

  return (
    <main className="mx-auto max-w-[1480px] px-6 py-10">
      <header className="mb-6 border-b border-zinc-200 pb-6">
        <div className="flex items-baseline justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
              AI 产业链 · 脉冲热力图
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              8 层 · {items.length} 个标的 · 粒子尺寸 = 市值 · 脉冲频率 = 涨速 · 颜色 = 热度 / 三方综合
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono">
            {generatedAt ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded bg-emerald-50 text-emerald-700 px-2.5 py-1 border border-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  LIVE {liveCount}/{items.length}
                </span>
                <span className="text-zinc-400">
                  · 更新于 {fmtAge(generatedAt)}
                </span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded bg-amber-50 text-amber-700 px-2.5 py-1 border border-amber-200">
                MOCK 数据 · 跑 npm run fetch-pulse 接入真实
              </span>
            )}
          </div>
        </div>
      </header>

      <PulseClient items={items} trends={trends} />

      <footer className="mt-12 border-t border-zinc-200 pt-6 text-center text-xs text-zinc-400">
        {generatedAt
          ? "数据源 yfinance · 5y daily OHLC · 估值分位 / 20D 动量分位 / RSI14 / 5D+成交量情绪 · 三方评分 = 段永平 + 巴菲特 + Serenity"
          : "当前为 mock 热度分；运行 npm run fetch-pulse 接入真实"}
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
