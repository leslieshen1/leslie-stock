"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SearchBox from "./SearchBox";
import MarketStatus from "./MarketStatus";

interface NavItem {
  href: string;
  label: string;
  en: string;
  match: (p: string) => boolean;
  cta?: boolean;
}

const NAV: NavItem[] = [
 { href: "/", label: "热力图", en: "Heatmap", match: (p) => p === "/" || p.startsWith("/pulse") },
 { href: "/scan", label: "列表", en: "List", match: (p) => p.startsWith("/scan") },
 { href: "/whales", label: "聪明钱", en: "Whales", match: (p) => p.startsWith("/whales") },
 { href: "/wire", label: "快讯", en: "Wire", match: (p) => p.startsWith("/wire") },
 { href: "/reports", label: "盘报", en: "Reports", match: (p) => p.startsWith("/reports") },
 { href: "/portfolio", label: "我的", en: "Portfolio", match: (p) => p.startsWith("/portfolio") || p.startsWith("/watchlist") },
];

export default function TopNav() {
  const pathname = usePathname();

  return (
 <header className="sticky top-0 z-40 border-b border-line bg-base/80 backdrop-blur-xl">
 <div className="mx-auto flex h-14 max-w-[1480px] items-center gap-2 px-3 sm:gap-4 sm:px-6">

        {/* Logo */}
 <Link href="/" className="flex items-center gap-2 shrink-0" title="我不是股神 · Not a Stock Guru">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="我不是股神" width={30} height={30}
               className="h-[30px] w-[30px] rounded-lg object-cover ring-1 ring-white/10 shrink-0" />
 <span className="text-[15px] sm:text-[17px] font-semibold tracking-tight text-ink whitespace-nowrap">
 我不是<span className="text-accent">股神</span>
          </span>
 <span className="tnum text-[10px] text-faint uppercase tracking-widest hidden md:inline">v0.6</span>
        </Link>

        {/* 主导航 — 手机可横向滑动 */}
 <nav className="flex flex-1 items-center gap-0.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] sm:ml-1">
          {NAV.map((item) => {
            const active = item.match(pathname);
            const cls = item.cta
 ? "bg-accent text-black hover:bg-accent/90"
              : active
 ? "text-ink bg-surface-2"
 : "text-muted hover:text-ink hover:bg-surface";
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative shrink-0 px-2 py-1.5 rounded-lg text-[13px] font-medium transition sm:px-3 ${cls}`}
              >
 <span className="hidden md:inline">{item.en}</span>
 <span className="md:hidden">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* 搜索框 */}
 <div className="hidden lg:block w-[260px] shrink-0">
 <SearchBox compact placeholder="搜代码 / 名称 / 板块…" />
        </div>

        {/* 盘口状态 — 休市时让用户知道价格"不跳"是正常 */}
        <div className="ml-auto shrink-0 sm:ml-0">
          <MarketStatus />
        </div>

        {/* Buy — 右上角小 CTA */}
        <Link
          href="/how-to-buy"
          title="如何买美股 · How to buy US stocks"
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-black transition hover:bg-accent/90"
        >
          Buy
        </Link>

      </div>
    </header>
  );
}

