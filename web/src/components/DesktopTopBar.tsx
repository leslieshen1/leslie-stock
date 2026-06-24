"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SearchBox from "./SearchBox";
import MarketStatus from "./MarketStatus";
import { useLang, LangToggle } from "@/lib/i18n";
import ThemeToggle from "./ThemeToggle";

// 全局顶栏(桌面 lg+):每个页面统一的最上面一条。左=当前栏目名,右=搜索 + 盘口状态 + 主题/语言 + Buy。
// 工具集中在这里 → 左侧栏保持纯导航。手机/平板 <lg 用 TopNav(本栏隐藏)。
const SECTIONS: { match: (p: string) => boolean; zh: string; en: string }[] = [
  { match: (p) => p.startsWith("/stock"), zh: "个股", en: "Stock" },
  { match: (p) => p === "/" || p.startsWith("/pulse"), zh: "热力图", en: "Heatmap" },
  { match: (p) => p.startsWith("/scan"), zh: "列表", en: "List" },
  { match: (p) => p.startsWith("/etf"), zh: "ETF", en: "ETF" },
  { match: (p) => p.startsWith("/whales"), zh: "聪明钱", en: "Smart Money" },
  { match: (p) => p.startsWith("/arena"), zh: "对决", en: "Arena" },
  { match: (p) => p.startsWith("/reports"), zh: "盘报", en: "Reports" },
  { match: (p) => p.startsWith("/portfolio") || p.startsWith("/watchlist"), zh: "我的", en: "Portfolio" },
];

export default function DesktopTopBar() {
  const pathname = usePathname();
  const { t } = useLang();
  const sec = SECTIONS.find((s) => s.match(pathname));

  return (
    <header className="sticky top-0 z-30 hidden h-[56px] items-center gap-4 border-b border-line bg-base/85 px-6 backdrop-blur-md lg:flex">
      <span className="shrink-0 text-[14px] font-semibold tracking-tight text-ink">{sec ? t(sec.zh, sec.en) : ""}</span>

      <div className="ml-auto flex min-w-0 items-center gap-2.5">
        <div className="w-[260px] shrink">
          <SearchBox compact placeholder={t("搜代码 / 名称 / 板块…", "Search ticker / name / sector…")} />
        </div>
        <div className="shrink-0"><MarketStatus /></div>
        <ThemeToggle />
        <LangToggle />
        <Link
          href="/how-to-buy"
          title="如何买美股 · How to buy US stocks"
          className="inline-flex min-h-[36px] shrink-0 items-center rounded-lg px-3.5 py-2 text-[13px] font-semibold text-[#1a0f08] transition hover:brightness-110"
          style={{ background: "linear-gradient(135deg, #eda57f 0%, #d98a6a 55%, #c2754f 100%)", boxShadow: "0 1px 0 rgba(255,255,255,0.25) inset, 0 4px 14px rgba(217,138,106,0.22)" }}
        >
          Buy
        </Link>
      </div>
    </header>
  );
}
