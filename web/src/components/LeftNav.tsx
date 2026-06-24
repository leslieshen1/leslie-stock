"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flame, List, Layers, Waves, Swords, FileText, Star } from "lucide-react";
import SearchBox from "./SearchBox";
import MarketStatus from "./MarketStatus";
import { useLang, LangToggle } from "@/lib/i18n";
import ThemeToggle from "./ThemeToggle";

// 全站左侧栏(桌面 lg+):每个页面都在的固定骨架。导航项与原 TopNav 完全一致,只是竖排 + 加图标。
// 手机/平板 <lg:本栏隐藏,顶部走精简 TopNav(品牌+搜索+控件)、底部走 MobileTabBar(导航)。
interface NavItem {
  href: string;
  label: string;
  en: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  match: (p: string) => boolean;
}

const NAV: NavItem[] = [
  { href: "/", label: "热力图", en: "Heatmap", Icon: Flame, match: (p) => p === "/" || p.startsWith("/pulse") },
  { href: "/scan", label: "列表", en: "List", Icon: List, match: (p) => p.startsWith("/scan") },
  { href: "/etf", label: "ETF", en: "ETF", Icon: Layers, match: (p) => p.startsWith("/etf") },
  { href: "/whales", label: "聪明钱", en: "Whales", Icon: Waves, match: (p) => p.startsWith("/whales") },
  { href: "/arena", label: "对决", en: "Arena", Icon: Swords, match: (p) => p.startsWith("/arena") },
  { href: "/reports", label: "盘报", en: "Reports", Icon: FileText, match: (p) => p.startsWith("/reports") },
  { href: "/portfolio", label: "我的", en: "Portfolio", Icon: Star, match: (p) => p.startsWith("/portfolio") || p.startsWith("/watchlist") },
];

export default function LeftNav() {
  const pathname = usePathname();
  const { lang, t } = useLang();

  return (
    <aside className="hidden lg:flex lg:flex-col w-[212px] shrink-0 sticky top-0 h-screen overflow-y-auto border-r border-line bg-base/85 px-3 py-4 backdrop-blur-md">
      {/* 品牌 */}
      <Link href="/" className="group mb-5 flex items-center gap-2.5 px-2" title="我不是股神 · Not a Stock God">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="我不是股神" width={32} height={32}
             className="h-8 w-8 shrink-0 rounded-[9px] object-cover ring-1 ring-white/10 transition group-hover:ring-accent/40" />
        <span className="flex min-w-0 flex-col leading-none">
          <span className="truncate text-[15px] font-semibold tracking-tight text-ink">我不是<span className="text-accent">股神</span></span>
          <span className="mt-[3px] font-mono text-[8px] uppercase tracking-[0.28em] text-faint">Not a Stock God</span>
        </span>
      </Link>

      {/* 搜索 */}
      <div className="mb-4 px-0.5">
        <SearchBox compact placeholder={t("搜代码 / 名称…", "Search…")} />
      </div>

      {/* 导航 */}
      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = item.match(pathname);
          const Icon = item.Icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition ${
                active ? "bg-accent/10 text-accent" : "text-muted hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.85} />
              <span>{lang === "zh" ? item.label : item.en}</span>
            </Link>
          );
        })}
      </nav>

      {/* 底部控件 */}
      <div className="mt-auto flex flex-col gap-2.5 px-0.5 pt-4">
        <div className="px-1"><MarketStatus /></div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LangToggle />
        </div>
        <Link
          href="/how-to-buy"
          title="如何买美股 · How to buy US stocks"
          className="inline-flex min-h-[36px] items-center justify-center rounded-lg px-3.5 py-2 text-[13px] font-semibold text-[#1a0f08] transition hover:brightness-110"
          style={{ background: "linear-gradient(135deg, #eda57f 0%, #d98a6a 55%, #c2754f 100%)", boxShadow: "0 1px 0 rgba(255,255,255,0.25) inset, 0 4px 14px rgba(217,138,106,0.22)" }}
        >
          Buy
        </Link>
      </div>
    </aside>
  );
}
