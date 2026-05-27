"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface DataHealth {
  liveCount: number;
  total: number;
  generatedAt: string | null;
  ok: boolean;
}

interface NavItem {
  href: string;
  label: string;
  en: string;
  match: (p: string) => boolean;
}

const NAV: NavItem[] = [
  { href: "/",          label: "热力图",  en: "Heatmap",  match: (p) => p === "/" || p.startsWith("/pulse") },
  { href: "/watchlist", label: "观察",    en: "Watchlist",match: (p) => p.startsWith("/watchlist") },
  { href: "/scan",      label: "扫描",    en: "Scan",     match: (p) => p.startsWith("/scan") },
  { href: "/portfolio", label: "持仓",    en: "Portfolio",match: (p) => p.startsWith("/portfolio") },
];

export default function TopNav({ health }: { health?: DataHealth }) {
  const pathname = usePathname();
  const [age, setAge] = useState<string>("");

  // 每分钟刷一次 "X 分钟前"
  useEffect(() => {
    if (!health?.generatedAt) return;
    const tick = () => setAge(fmtAge(health.generatedAt!));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [health?.generatedAt]);

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/80 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-14 max-w-[1480px] items-center gap-6 px-6">

        {/* Logo */}
        <Link href="/" className="flex items-baseline gap-1.5 shrink-0">
          <span className="font-serif text-[19px] font-medium tracking-tight text-zinc-900" style={{fontFamily:"'Fraunces','Playfair Display',Georgia,serif"}}>
            Leslie<span className="text-[#165DFF]">·</span>stock
          </span>
          <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-wider hidden md:inline">v0.4</span>
        </Link>

        {/* 主导航 */}
        <nav className="flex items-center gap-1 ml-2">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group relative px-3 py-1.5 rounded-md text-sm font-medium transition ${
                  active
                    ? "text-zinc-900 bg-zinc-100"
                    : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
                }`}
              >
                <span className="hidden md:inline">{item.en}</span>
                <span className="md:hidden">{item.label}</span>
                {active && (
                  <span className="absolute -bottom-[15px] left-3 right-3 h-[2px] bg-[#165DFF]" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* 中间 spacer */}
        <div className="flex-1" />

        {/* 搜索 placeholder */}
        <div className="hidden lg:flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50/60 px-2.5 py-1 text-xs text-zinc-400 cursor-not-allowed select-none min-w-[180px]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <span>搜索 ticker / 名称</span>
          <span className="ml-auto font-mono text-[10px] text-zinc-400 border border-zinc-200 rounded px-1">⌘K</span>
        </div>

        {/* 数据健康徽标 */}
        {health && (
          <Link
            href="/pulse/coverage"
            className="flex items-center gap-2 text-xs hover:opacity-80 transition"
            title="点击查看数据覆盖矩阵"
          >
            <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 border font-mono ${
              health.ok
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-amber-50 text-amber-700 border-amber-200"
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${health.ok ? "bg-emerald-500" : "bg-amber-500"} animate-pulse`} />
              {health.ok ? "LIVE" : "MOCK"} {health.liveCount}/{health.total}
            </span>
            {age && <span className="text-zinc-400 hidden xl:inline">{age}</span>}
          </Link>
        )}

      </div>
    </header>
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
