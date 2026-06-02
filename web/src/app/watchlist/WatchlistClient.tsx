"use client";

import Link from "next/link";
import { useState } from "react";
import { useWatchlist, type LocalWatchEntry } from "@/lib/useWatchlist";

type SortKey = "added" | "score" | "mcap";

export default function WatchlistClient() {
  const { items, ready, remove } = useWatchlist();
 const [sortBy, setSortBy] = useState<SortKey>("added");

  if (!ready) {
    return (
 <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm text-faint">
        加载中…
      </div>
    );
  }

  if (items.length === 0) {
    return (
 <div className="rounded-xl border border-dashed border-line-2 bg-surface p-16 text-center">
 <p className="mb-3 text-lg text-muted">观察列表为空</p>
 <p className="text-sm text-muted">
 去{" "}
          <Link
 href="/scan"
 className="text-accent hover:underline font-medium"
          >
             全市场扫描
 </Link>{" "}
          找感兴趣的标的，点 ☆ 加入。
        </p>
      </div>
    );
  }

  const sorted = [...items].sort((a, b) => {
 if (sortBy === "added") return b.added_at.localeCompare(a.added_at);
 if (sortBy === "score") return (b.score ?? 0) - (a.score ?? 0);
 if (sortBy === "mcap")
      return (b.market_cap_yi ?? 0) - (a.market_cap_yi ?? 0);
    return 0;
  });

  return (
    <>
 <div className="mb-4 flex items-center justify-between">
 <p className="text-xs text-muted">
 <span className="font-mono font-semibold text-ink">
            {items.length}
 </span>{" "}
          只跟踪中
        </p>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
 className="rounded-lg border border-line px-3 py-1.5 text-sm"
        >
 <option value="added">按加入时间</option>
 <option value="score">按 Serenity 评分</option>
 <option value="mcap">按市值</option>
        </select>
      </div>

 <div className="space-y-2">
        {sorted.map((w) => (
          <Row key={`${w.code}-${w.market}`} item={w} onRemove={remove} />
        ))}
      </div>
    </>
  );
}

function Row({
  item: w,
  onRemove,
}: {
  item: LocalWatchEntry;
  onRemove: (code: string, market: string) => void;
}) {
  const marketLabel =
 w.market === "a" ? "A股" : w.market === "hk" ? "港股" : "美股";
  const marketColor =
 w.market === "a"
 ? "text-down"
 : w.market === "hk"
 ? "text-accent"
 : "text-accent";

  function handleRemove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (confirm(`从观察列表移除 ${w.name} (${w.code})？`)) {
      onRemove(w.code, w.market);
    }
  }

  return (
 <div className="group flex items-center rounded-lg border border-line bg-surface transition hover:border-line-2 hover:">
      <Link
        href={`/stock/${w.code}?market=${w.market}`}
 className="block flex-1 min-w-0 px-4 py-3"
      >
 <div className="flex items-center gap-4">
 <div className="flex-1 min-w-0">
 <div className="flex items-baseline gap-2">
 <h3 className="text-sm font-semibold text-ink truncate">
                {w.name}
              </h3>
 <span className="font-mono text-xs text-faint">{w.code}</span>
              <span className={`text-[10px] font-medium ${marketColor}`}>
                {marketLabel}
              </span>
              {w.layer && (
 <span className="text-[10px] text-muted">L{w.layer}</span>
              )}
            </div>
 <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
              {w.market_cap_yi && (
 <span className="font-mono">{w.market_cap_yi.toFixed(0)} 亿</span>
              )}
              {w.sector && (
                <>
 <span className="text-faint">·</span>
 <span className="truncate">{w.sector}</span>
                </>
              )}
              {w.verdict_label && (
                <>
 <span className="text-faint">·</span>
                  <span className={verdictColor(w.verdict)}>
                    {w.verdict_label}
                  </span>
                </>
              )}
 <span className="text-faint">·</span>
 <span className="text-faint">
                加入于 {w.added_at.slice(0, 10)}
              </span>
            </div>
            {w.thesis && (
 <p className="mt-1 truncate text-[11px] text-muted group-hover:whitespace-normal group-hover:text-ink">
                {w.thesis}
              </p>
            )}
          </div>

 {typeof w.score === "number" && (
 <div className="shrink-0 text-right">
 <p className="text-[9px] uppercase tracking-wider text-accent">
                瓶颈
              </p>
              <p
                className={`font-mono text-lg font-semibold tabular-nums ${scoreColor(
                  w.score
                )}`}
              >
                {w.score}
              </p>
            </div>
          )}
        </div>
      </Link>

      <button
        onClick={handleRemove}
 title="从观察列表移除"
 aria-label="从观察列表移除"
 className="shrink-0 mr-2 px-3 py-2 text-faint hover:text-down hover:bg-down-soft rounded transition"
      >
        ✕
      </button>
    </div>
  );
}

function scoreColor(score: number): string {
 if (score >= 75) return "text-accent";
 if (score >= 65) return "text-accent";
 if (score >= 50) return "text-accent";
 if (score >= 30) return "text-muted";
 return "text-faint";
}

function verdictColor(verdict?: string): string {
  switch (verdict) {
 case "high_conviction":
 return "text-accent font-medium";
 case "aleabit_analogue":
 return "text-accent";
 case "worth_watching":
 return "text-accent";
 case "macro_tailwind":
 return "text-accent";
 case "crowded_but_valid":
 return "text-accent";
    default:
 return "text-faint";
  }
}
