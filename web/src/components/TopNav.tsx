"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SearchBox from "./SearchBox";
import MarketStatus from "./MarketStatus";
import { useLang, LangToggle } from "@/lib/i18n";
import ThemeToggle from "./ThemeToggle";

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
 { href: "/etf", label: "ETF", en: "ETF", match: (p) => p.startsWith("/etf") },
 { href: "/whales", label: "聪明钱", en: "Whales", match: (p) => p.startsWith("/whales") },
 { href: "/arena", label: "对决", en: "Arena", match: (p) => p.startsWith("/arena") },
 { href: "/reports", label: "盘报", en: "Reports", match: (p) => p.startsWith("/reports") },
 { href: "/portfolio", label: "我的", en: "Portfolio", match: (p) => p.startsWith("/portfolio") || p.startsWith("/watchlist") },
];

export default function TopNav() {
  const pathname = usePathname();
  const { lang, t } = useLang();

  return (
 <header className="sticky top-0 z-40 border-b border-line bg-base/85 backdrop-blur-md">
 <div className="mx-auto flex h-[60px] max-w-[1480px] items-center gap-2 px-3 sm:gap-4 sm:px-6">

        {/* Brand lockup — 双行编辑部款 */}
 <Link href="/" className="flex items-center gap-2.5 shrink-0 group" title="我不是股神 · Not a Stock God">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="我不是股神" width={32} height={32}
               className="h-8 w-8 rounded-[9px] object-cover ring-1 ring-white/10 shrink-0 transition group-hover:ring-accent/40" />
          <span className="flex flex-col leading-none">
 <span className="text-[16px] font-semibold tracking-tight text-ink whitespace-nowrap">
 我不是<span className="text-accent">股神</span>
            </span>
 <span className="mt-[3px] hidden font-mono text-[8.5px] uppercase tracking-[0.32em] text-faint sm:block">
              Not a Stock God
            </span>
          </span>
        </Link>

        {/* 主导航 — active 用下划线(编辑部),hover 升墨色 */}
 {/* 移动端隐藏(横滑会把对决/盘报藏出屏外,入口在底部 MobileTabBar) */}
 <nav className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] sm:ml-2 md:flex">
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative shrink-0 px-2 py-2 text-[13px] font-medium transition sm:px-3 ${
                  active ? "text-ink" : "text-muted hover:text-ink"
                }`}
              >
 <span>{lang === "zh" ? item.label : item.en}</span>
                <span
                  className={`pointer-events-none absolute inset-x-2 -bottom-[1px] h-[2px] rounded-full transition-all duration-300 sm:inset-x-3 ${
 active ? "bg-accent opacity-100" : "bg-accent opacity-0"
                  }`}
                />
              </Link>
            );
          })}
        </nav>

        {/* 搜索框 */}
 <div className="hidden lg:block w-[260px] shrink-0">
 <SearchBox compact placeholder={t("搜代码 / 名称 / 板块…", "Search ticker / name / sector…")} />
        </div>

        {/* 盘口状态 — 休市时让用户知道价格"不跳"是正常;手机太挤,藏(sm 起显示)*/}
        <div className="ml-auto hidden shrink-0 sm:ml-0 sm:block">
          <MarketStatus />
        </div>

        {/* 主题 + 语言切换 */}
        <ThemeToggle />
        <LangToggle />

        {/* Buy — 赤陶渐变小 CTA */}
        <Link
          href="/how-to-buy"
          title="如何买美股 · How to buy US stocks"
          className="shrink-0 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-[#1a0f08] transition hover:brightness-110"
          style={{
            background: "linear-gradient(135deg, #eda57f 0%, #d98a6a 55%, #c2754f 100%)",
            boxShadow: "0 1px 0 rgba(255,255,255,0.25) inset, 0 4px 14px rgba(217,138,106,0.22)",
          }}
        >
          Buy
        </Link>

      </div>
    </header>
  );
}

