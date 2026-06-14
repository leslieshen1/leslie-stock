"use client";

// 移动端底部 Tab 栏(md 以下显示)—— 顶部导航横滑会把"对决/盘报"藏出屏外,
// 没人会去滑;底栏 6 个入口一屏全见,App 惯例。桌面端隐藏。

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang } from "@/lib/i18n";

const SW = 1.8;

const TABS: { href: string; zh: string; en: string; match: (p: string) => boolean; icon: React.ReactNode }[] = [
  {
    href: "/", zh: "热力图", en: "Heat", match: (p) => p === "/" || p.startsWith("/pulse"),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/scan", zh: "列表", en: "List", match: (p) => p.startsWith("/scan"),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" fill="currentColor" />
        <circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: "/etf", zh: "ETF", en: "ETF", match: (p) => p.startsWith("/etf"),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    href: "/whales", zh: "聪明钱", en: "Whales", match: (p) => p.startsWith("/whales"),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21h18M5 21V10l7-6 7 6v11M9 21v-6h6v6" />
      </svg>
    ),
  },
  {
    href: "/arena", zh: "对决", en: "Arena", match: (p) => p.startsWith("/arena"),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0V4z" />
        <path d="M7 6H4a2 2 0 0 0 2 4h1M17 6h3a2 2 0 0 1-2 4h-1" />
      </svg>
    ),
  },
  {
    href: "/reports", zh: "盘报", en: "Reports", match: (p) => p.startsWith("/reports"),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4z" />
        <path d="M18 8h2a0 0 0 0 1 0 0v11a2 2 0 0 1-2 2M8 8h6M8 12h6M8 16h4" />
      </svg>
    ),
  },
  {
    href: "/portfolio", zh: "我的", en: "Mine", match: (p) => p.startsWith("/portfolio") || p.startsWith("/watchlist"),
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.4l6.1-.9L12 3z" />
      </svg>
    ),
  },
];

export default function MobileTabBar() {
  const pathname = usePathname();
  const { lang } = useLang();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-base/92 backdrop-blur-md md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-7">
        {TABS.map((tb) => {
          const active = tb.match(pathname);
          return (
            <Link
              key={tb.href}
              href={tb.href}
              className={`flex flex-col items-center gap-0.5 py-2 transition ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              <span className="h-[19px] w-[19px]">{tb.icon}</span>
              <span className="text-[9.5px] font-medium leading-none">{lang === "zh" ? tb.zh : tb.en}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
