"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n";

type SearchResult = {
  code: string;
  name: string;
 market: "a" | "hk" | "us" | "kr";
  market_cap_yi: number | null;
  sector: string;
  layer: number | null;
  score: number;
  verdict: string;
  verdict_label: string;
  signals_hit: number;
  thesis: string;
};

type Props = {
  compact?: boolean;     // TopNav 紧凑版
  placeholder?: string;
  autoFocus?: boolean;   // 移动端浮层打开即聚焦
  onNavigate?: () => void; // 选中跳转后回调(移动端用于关闭浮层)
};

// A 股实时总市值(腾讯,与详情页同源)。搜索结果里的 market_cap_yi 是 manifest 静态值,
// 个股上涨/股本变动后会和详情页对不上(如 688786 搜索 54亿 vs 详情 84亿)→ 用实时盖掉。
// 模块级缓存:全站搜索框共享,60s 内不重复拉(/api/a-market 一次返回全部 A 股)。
let A_LIVE_CAPS: { map: Record<string, number>; ts: number } | null = null;
async function loadALiveCaps(): Promise<Record<string, number>> {
  if (A_LIVE_CAPS && Date.now() - A_LIVE_CAPS.ts < 60_000) return A_LIVE_CAPS.map;
  try {
    const j = await fetch("/api/a-market", { cache: "no-store" }).then((r) => r.json());
    const map: Record<string, number> = {};
    for (const [code, q] of Object.entries((j.quotes || {}) as Record<string, { mcapYi?: number | null }>)) {
      if (q && q.mcapYi != null) map[code] = q.mcapYi;
    }
    A_LIVE_CAPS = { map, ts: Date.now() };
    return map;
  } catch {
    return A_LIVE_CAPS?.map ?? {};
  }
}

export default function SearchBox({ compact = false, placeholder, autoFocus = false, onNavigate }: Props) {
  const { t } = useLang();
 const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [aLive, setALive] = useState<Record<string, number>>({}); // A股实时市值覆盖
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=12`);
        const body = await r.json();
        setResults(body.results || []);
        setOpen(true);
        setActive(0);
      } finally {
        setLoading(false);
      }
    }, 180);
  }, [q]);

  // 结果含 A 股时,拉一次实时市值覆盖 manifest 静态值(与详情页腾讯实时一致)
  useEffect(() => {
    if (results.some((r) => r.market === "a")) loadALiveCaps().then(setALive);
  }, [results]);

  // 关闭下拉
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
 document.addEventListener("mousedown", onClick);
 return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // 快捷键：cmd/ctrl + K 聚焦
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
 if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
 window.addEventListener("keydown", onKey);
 return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 移动端浮层打开即聚焦
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  function go(r: SearchResult) {
    router.push(`/stock/${r.code}?market=${r.market}`);
    setOpen(false);
 setQ("");
    onNavigate?.();
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
 if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
 } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
 } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
 } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

 const wrapClass = compact ? "relative w-full max-w-md" : "relative w-full";
  const inputClass = compact
 ? "w-full rounded-lg border border-line bg-surface py-1.5 pl-9 pr-12 text-sm placeholder-faint focus:border-faint focus:outline-none focus:ring-2 focus:ring-surface-2 focus:bg-surface"
 : "w-full rounded-lg border border-line bg-surface py-2 pl-10 pr-12 text-sm placeholder-faint focus:border-faint focus:outline-none focus:ring-2 focus:ring-surface-2";

  return (
    <div className={wrapClass} ref={containerRef}>
 <div className="relative">
        <svg
 className={`absolute ${compact ? "left-2.5 h-3.5 w-3.5" : "left-3 h-4 w-4"} top-1/2 -translate-y-1/2 text-faint`}
 viewBox="0 0 24 24"
 fill="none"
 stroke="currentColor"
 strokeWidth="2"
        >
 <circle cx="11" cy="11" r="8" />
 <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
 type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => q && setOpen(true)}
          onKeyDown={onKey}
 placeholder={placeholder || t("搜代码 / 名称 / 板块 / thesis…", "Search ticker / name / sector / thesis…")}
          className={inputClass}
        />
        {loading ? (
 <div className="absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin rounded-full border-2 border-line border-t-muted" />
        ) : (
 <kbd className="absolute right-2 top-1/2 -translate-y-1/2 hidden md:inline-flex font-mono text-[10px] text-faint bg-surface-2 border border-line rounded px-1.5 py-0.5">
            ⌘K
          </kbd>
        )}
      </div>

      {open && (
 <div className="absolute left-0 right-0 top-full mt-2 z-50 max-h-[420px] overflow-auto rounded-lg border border-line bg-surface ">
          {results.length === 0 ? (
 <div className="px-4 py-3 text-sm text-muted">
 {q ? t("没找到匹配", "No matches") : t("输入代码 / 名字 / 板块", "Type a ticker / name / sector")}
            </div>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.code}-${r.market}`}
                onClick={() => go(r)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition ${
 i === active ? "bg-surface" : "hover:bg-surface-2"
                }`}
              >
 <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`shrink-0 inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${
 r.market === "a"
 ? "bg-down-soft text-down"
 : r.market === "hk"
 ? "bg-surface-2 text-accent"
 : "bg-surface-2 text-accent"
                    }`}
                  >
 {r.market === "a" ? "A" : r.market === "hk" ? "HK" : r.market === "kr" ? "KR" : "US"}
                  </span>
 <div className="min-w-0">
 <div className="flex items-baseline gap-1.5">
 <p className="font-medium text-ink truncate">{r.name}</p>
 <p className="font-mono text-xs text-faint">{r.code}</p>
                    </div>
                    {(r.sector || r.thesis) && (
 <p className="text-[11px] text-muted truncate">
                        {r.sector}
 {r.sector && r.thesis && " · "}
                        {r.thesis && (
 <span className="text-faint">{r.thesis.slice(0, 60)}</span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
 <div className="shrink-0 flex items-center gap-2 text-[10px]">
                  {(() => {
                    // A 股用实时市值(腾讯,与详情页一致),拿不到才退回 manifest 静态值
                    const capYi = r.market === "a" ? (aLive[r.code] ?? r.market_cap_yi) : r.market_cap_yi;
                    return capYi ? (
                      <span className="text-faint font-mono">
                        {capYi >= 1000 ? `${(capYi / 1000).toFixed(1)}千亿` : `${capYi.toFixed(0)}亿`}
                      </span>
                    ) : null;
                  })()}
                  {r.score > 0 && (
                    <span
                      className={`font-mono font-semibold ${
                        r.score >= 70
 ? "text-accent"
                          : r.score >= 60
 ? "text-accent"
                          : r.score >= 50
 ? "text-accent"
 : "text-faint"
                      }`}
                    >
                      {r.score}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
