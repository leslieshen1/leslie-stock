"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWatchlist } from "@/lib/useWatchlist";

const MARKET_TONE: Record<string, string> = {
  a:  "text-rose-600",
  hk: "text-blue-600",
  us: "text-violet-600",
};

export default function WatchlistSidebar() {
  const { items, ready, remove } = useWatchlist();
  const [open, setOpen] = useState(false);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!ready) return null;

  return (
    <>
      {/* 收起把手 — 常驻左侧中部 */}
      <button
        onClick={() => setOpen(true)}
        className={`fixed left-0 top-1/2 z-30 -translate-y-1/2 flex flex-col items-center gap-1 rounded-r-xl border border-l-0 border-zinc-200 bg-white py-3 pl-2 pr-2.5 shadow-sm transition hover:bg-zinc-50 ${open ? "opacity-0 pointer-events-none" : "opacity-100"}`}
        title="观察列表"
        aria-label="打开观察列表"
      >
        <span className="text-base">⭐</span>
        <span className="font-mono text-xs font-semibold text-zinc-700">{items.length}</span>
        <span className="text-[10px] leading-tight text-zinc-400" style={{ writingMode: "vertical-rl" }}>观察</span>
      </button>

      {/* 遮罩 */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-zinc-900/15 backdrop-blur-[1px]"
        />
      )}

      {/* 抽屉 */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-72 flex-col border-r border-zinc-200 bg-white shadow-xl transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3.5">
          <div className="flex items-baseline gap-2">
            <span className="text-base">⭐</span>
            <h2 className="text-sm font-semibold text-zinc-900">观察列表</h2>
            <span className="font-mono text-xs text-zinc-400">{items.length}</span>
          </div>
          <button onClick={() => setOpen(false)} className="rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700" aria-label="收起">
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="mb-1 text-sm text-zinc-500">还没观察任何股票</p>
              <p className="text-xs text-zinc-400">
                去<Link href="/" className="text-violet-600 hover:underline" onClick={() => setOpen(false)}>热力图</Link>
                或<Link href="/scan" className="text-violet-600 hover:underline" onClick={() => setOpen(false)}>扫描</Link>页点 ⭐ 添加
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {items.map((it) => (
                <li key={`${it.code}-${it.market}`} className="group flex items-center gap-2 px-3 py-2.5 transition hover:bg-zinc-50">
                  <Link
                    href={`/stock/${it.code}?market=${it.market}`}
                    onClick={() => setOpen(false)}
                    className="min-w-0 flex-1"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-zinc-800 group-hover:text-violet-700">{it.name}</span>
                      {typeof it.score === "number" && it.score > 0 && (
                        <span className={`shrink-0 font-mono text-xs ${it.score >= 80 ? "text-emerald-600" : it.score >= 60 ? "text-amber-600" : "text-zinc-400"}`}>
                          {it.score}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className={`font-mono text-[11px] ${MARKET_TONE[it.market] || "text-zinc-400"}`}>{it.code}</span>
                      {it.sector && <span className="truncate text-[11px] text-zinc-400">{it.sector}</span>}
                    </div>
                  </Link>
                  <button
                    onClick={() => remove(it.code, it.market)}
                    className="shrink-0 rounded p-1 text-zinc-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100"
                    title="移除"
                    aria-label="移除"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-zinc-200 px-4 py-2.5">
          <Link href="/watchlist" onClick={() => setOpen(false)} className="text-xs text-violet-600 hover:underline">
            完整观察页 →
          </Link>
        </footer>
      </aside>
    </>
  );
}
