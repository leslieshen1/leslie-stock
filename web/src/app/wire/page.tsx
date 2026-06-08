import { promises as fs } from "fs";
import path from "path";
import MacroBar, { type MacroSeries } from "@/components/MacroBar";

export const metadata = {
  title: "快讯 · Wire | 我不是股神",
  description: "美股市场快讯 + 宏观速览 —— 大盘在想什么，一眼扫完。",
};

export const dynamic = "force-dynamic"; // 每次请求重算「今天/昨天」+ 读最新快讯

type NewsItem = { title: string; url: string; source: string; ts: number; summary?: string };

// 字面量路径(避免 Turbopack 把整个 public/data 追踪进函数)
async function loadWire(): Promise<{ generated_at?: string; items: NewsItem[] }> {
  try {
    const p = path.join(process.cwd(), "public", "data", "market-news.json");
    return JSON.parse(await fs.readFile(p, "utf-8"));
  } catch {
    return { items: [] };
  }
}
async function loadMacroSeries(): Promise<MacroSeries[]> {
  try {
    const p = path.join(process.cwd(), "public", "data", "macro.json");
    return (JSON.parse(await fs.readFile(p, "utf-8")).series || []) as MacroSeries[];
  } catch {
    return [];
  }
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// 把同一天的快讯分组（今天 / 昨天 / M月D日）
function groupByDay(items: NewsItem[]) {
  const now = new Date();
  const today = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;
  const yest = new Date(now.getTime() - 86400_000);
  const yKey = `${yest.getUTCFullYear()}-${yest.getUTCMonth()}-${yest.getUTCDate()}`;
  const groups: { label: string; items: NewsItem[] }[] = [];
  const byKey = new Map<string, NewsItem[]>();
  for (const it of items) {
    const d = new Date((it.ts || 0) * 1000);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(it);
  }
  for (const [key, list] of byKey) {
    const d = new Date((list[0].ts || 0) * 1000);
    const label = key === today ? "今天" : key === yKey ? "昨天" : `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
    groups.push({ label, items: list });
  }
  return groups;
}

export default async function WirePage() {
  const [wire, macroSeries] = await Promise.all([loadWire(), loadMacroSeries()]);
  const items = [...(wire.items || [])].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const groups = groupByDay(items);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <MacroBar series={macroSeries} />

      <header className="mb-6">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">快讯</h1>
          <span className="text-sm text-faint">Wire · 市场在想什么</span>
        </div>
        <p className="mt-1.5 text-sm text-muted">美股大盘快讯,按时间倒序。数据 Finnhub · 个股新闻在各自详情页。</p>
      </header>

      {items.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-muted">
          暂无快讯 —— 在 <code className="text-ink">.env</code> 配 <code className="text-ink">FINNHUB_KEY</code> 后{" "}
          <code className="text-ink">refresh.py</code> 即拉取。
        </div>
      ) : (
        <div className="space-y-7">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="mb-3 text-[12px] font-medium uppercase tracking-wider text-faint">{g.label}</h2>
              <div className="space-y-1">
                {g.items.map((it, i) => {
                  const d = new Date((it.ts || 0) * 1000);
                  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
                  const showSummary =
                    it.summary && !it.summary.slice(0, 30).includes(it.title.slice(0, 20));
                  return (
                    <a
                      key={i}
                      href={it.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex gap-3 rounded-lg px-3 py-2.5 transition hover:bg-surface"
                    >
                      <time className="tnum w-12 shrink-0 pt-0.5 text-[12px] text-faint">{time}</time>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                            {it.source}
                          </span>
                          <span className="text-[14px] font-medium leading-snug text-ink group-hover:text-accent">
                            {it.title}
                          </span>
                        </div>
                        {showSummary && (
                          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted">{it.summary}</p>
                        )}
                      </div>
                    </a>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-10 text-center text-[11px] text-faint">
        快讯仅供参考,非投资建议 · UTC 时间 · {wire.generated_at || ""}
      </p>
    </main>
  );
}
