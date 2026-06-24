"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flame, List, Layers, Waves, Swords, FileText, LineChart, Star } from "lucide-react";
import { useLang } from "@/lib/i18n";

// 全站左侧栏(桌面 lg+)= 纯导航。搜索/盘口状态/主题/语言/Buy 都在全局顶栏 DesktopTopBar,这里保持干净。
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
  { href: "/track-record", label: "表现", en: "Track Record", Icon: LineChart, match: (p) => p.startsWith("/track-record") },
  { href: "/portfolio", label: "我的", en: "Portfolio", Icon: Star, match: (p) => p.startsWith("/portfolio") || p.startsWith("/watchlist") },
];

export default function LeftNav() {
  const pathname = usePathname();
  const { lang } = useLang();

  return (
    <aside className="hidden lg:flex lg:flex-col w-[204px] shrink-0 sticky top-0 h-screen border-r border-line bg-base/70 px-3 py-4 backdrop-blur-md">
      {/* 品牌 */}
      <Link href="/" className="group mb-5 flex items-center gap-2.5 px-2" title="我不是股神 · Not a Stock God">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="我不是股神" width={30} height={30}
             className="h-[30px] w-[30px] shrink-0 rounded-[9px] object-cover ring-1 ring-white/10 transition group-hover:ring-accent/40" />
        <span className="flex min-w-0 flex-col leading-none">
          <span className="truncate text-[15px] font-semibold tracking-tight text-ink">我不是<span className="text-accent">股神</span></span>
          <span className="mt-[3px] font-mono text-[8px] uppercase tracking-[0.28em] text-faint">Not a Stock God</span>
        </span>
      </Link>

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
              className={`flex items-center gap-3 rounded-lg px-3 py-[9px] text-[13.5px] font-medium transition ${
                active ? "bg-accent/10 text-accent" : "text-muted hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.85} />
              <span>{lang === "zh" ? item.label : item.en}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
