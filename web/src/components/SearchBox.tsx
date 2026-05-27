"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type SearchResult = {
  code: string;
  name: string;
  market: "a" | "hk";
  industry: string | null;
  market_cap: number | null;
};

export default function SearchBox() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
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
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=10`);
        const body = await r.json();
        setResults(body.results || []);
        setOpen(true);
        setActive(0);
      } finally {
        setLoading(false);
      }
    }, 180);
  }, [q]);

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

  function go(r: SearchResult) {
    router.push(`/stock/${r.code}?market=${r.market}`);
    setOpen(false);
    setQ("");
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

  return (
    <div className="relative w-full max-w-md" ref={containerRef}>
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => q && setOpen(true)}
          onKeyDown={onKey}
          placeholder="搜代码 / 公司名 / 行业 …"
          className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-10 pr-4 text-sm placeholder-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-100"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-500" />
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-2 z-30 max-h-96 overflow-auto rounded-lg border border-zinc-200 bg-white shadow-lg">
          {results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-zinc-500">
              {q ? "没找到匹配的股票" : "输入代码或名字"}
            </div>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.code}-${r.market}`}
                onClick={() => go(r)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition ${
                  i === active ? "bg-zinc-50" : "hover:bg-zinc-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      r.market === "a"
                        ? "bg-red-50 text-red-700"
                        : "bg-blue-50 text-blue-700"
                    }`}
                  >
                    {r.market === "a" ? "A" : "HK"}
                  </span>
                  <div>
                    <p className="font-medium text-zinc-900">{r.name}</p>
                    <p className="font-mono text-xs text-zinc-500">
                      {r.code}
                      {r.industry && <span className="ml-2 text-zinc-400">· {r.industry}</span>}
                    </p>
                  </div>
                </div>
                {r.market_cap && (
                  <p className="text-xs text-zinc-400">{formatCap(r.market_cap)}</p>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function formatCap(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}万亿`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(0)}亿`;
  return String(Math.round(v));
}
