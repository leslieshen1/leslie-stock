"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Star, X, ChevronRight } from "lucide-react";
import { useWatchlist } from "@/lib/useWatchlist";

const MARKET_LABEL: Record<string, string> = { a: "SH/SZ", hk: "HK", us: "US" };

export default function WatchlistSidebar() {
  const { items, ready, remove } = useWatchlist();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
 const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
 window.addEventListener("keydown", onKey);
 return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!ready) return null;

  return (
    <>
      {/* 收起把手 */}
      <button
        onClick={() => setOpen(true)}
 className={`fixed left-0 top-1/2 z-30 -translate-y-1/2 flex flex-col items-center gap-1.5 rounded-r-xl border border-l-0 border-line bg-surface py-3 pl-2 pr-2.5 transition hover:bg-surface-2 ${open ? "pointer-events-none opacity-0" : "opacity-100"}`}
 aria-label="打开观察列表"
      >
 <Star className="h-4 w-4 text-accent" strokeWidth={1.75} fill="currentColor" fillOpacity={0.2} />
 <span className="tnum text-xs font-semibold text-ink">{items.length}</span>
 <span className="text-[10px] leading-tight text-faint" style={{ writingMode: "vertical-rl" }}>观察</span>
      </button>

      {/* 遮罩 */}
 {open && <div onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />}

      {/* 抽屉 */}
 <aside className={`fixed left-0 top-0 z-50 flex h-full w-72 flex-col border-r border-line bg-surface transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"}`}>
 <header className="flex items-center justify-between border-b border-line px-4 py-3.5">
 <div className="flex items-center gap-2">
 <Star className="h-4 w-4 text-accent" strokeWidth={1.75} fill="currentColor" fillOpacity={0.2} />
 <h2 className="text-sm font-semibold text-ink">观察列表</h2>
 <span className="tnum text-xs text-faint">{items.length}</span>
          </div>
 <button onClick={() => setOpen(false)} className="rounded p-1 text-faint transition hover:bg-surface-2 hover:text-ink" aria-label="收起">
 <X className="h-4 w-4" />
          </button>
        </header>

 <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
 <div className="px-4 py-12 text-center">
 <p className="mb-1 text-sm text-muted">还没观察任何股票</p>
 <p className="text-xs text-faint">
 去<Link href="/" className="text-accent hover:underline" onClick={() => setOpen(false)}>热力图</Link>
 或<Link href="/scan" className="text-accent hover:underline" onClick={() => setOpen(false)}>扫描</Link>页点收藏添加
              </p>
            </div>
          ) : (
 <ul className="divide-y divide-line">
              {items.map((it) => (
 <li key={`${it.code}-${it.market}`} className="group flex items-center gap-2 px-3 py-2.5 transition hover:bg-surface-2">
 <Link href={`/stock/${it.code}?market=${it.market}`} onClick={() => setOpen(false)} className="min-w-0 flex-1">
 <div className="flex items-center gap-1.5">
 <span className="truncate text-[13px] font-medium text-ink group-hover:text-accent">{it.name}</span>
 {typeof it.score === "number" && it.score > 0 && (
 <span className={`tnum shrink-0 text-xs ${it.score >= 80 ? "text-up" : it.score >= 60 ? "text-accent" : "text-faint"}`}>
                          {it.score}
                        </span>
                      )}
                    </div>
 <div className="mt-0.5 flex items-center gap-1.5">
 <span className="tnum text-[11px] text-faint">{it.code}</span>
 <span className="text-[10px] text-faint">{MARKET_LABEL[it.market]}</span>
 {it.sector && <span className="truncate text-[11px] text-muted">{it.sector}</span>}
                    </div>
                  </Link>
                  <button
                    onClick={() => remove(it.code, it.market)}
 className="shrink-0 rounded p-1 text-faint opacity-0 transition hover:bg-down-soft hover:text-down group-hover:opacity-100"
 aria-label="移除"
                  >
 <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

 <footer className="border-t border-line px-4 py-2.5">
 <Link href="/portfolio" onClick={() => setOpen(false)} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
 完整观察页 <ChevronRight className="h-3 w-3" />
          </Link>
        </footer>
      </aside>
    </>
  );
}
