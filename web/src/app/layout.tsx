import type { Metadata } from "next";
import { Fraunces, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";
import TopNav from "@/components/TopNav";
import MobileTabBar from "@/components/MobileTabBar";
import WatchlistSidebar from "@/components/WatchlistSidebar";
import { LangProvider, T } from "@/lib/i18n";

// Terminal Luxury 字体系统:Fraunces = 编辑部衬线(拉丁 display 时刻),
// Spline Sans Mono = 全站数字/代码(有性格的 tabular,取代 SF Mono 的工程味)
const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-fraunces",
  display: "swap",
});
const splineMono = Spline_Sans_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-spline-mono",
  display: "swap",
});

export const metadata: Metadata = {
 metadataBase: new URL("https://stockgod.xyz"),
 title: "我不是股神 · Not a Stock God",
 description: "AI 驱动的全景股票可视化平台。你不是股神，但股神陪你一起看股票。五方独立判读 · A 股 / 港股 / 美股 / 加密。",
 openGraph: {
   title: "我不是股神 · Not a Stock God",
   description: "AI 驱动的全景股票可视化平台。五方独立判读 · 产业链热力图 · 美股全市场。",
   images: [{ url: "/og.jpg", width: 1254, height: 1254 }],
 },
 twitter: { card: "summary_large_image", title: "我不是股神 · Not a Stock God", images: ["/og.jpg"] },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
 <html lang="zh-CN" suppressHydrationWarning className={`h-full antialiased ${fraunces.variable} ${splineMono.variable}`}>
 <head>
        {/* 首帧防闪:渲染前按 localStorage 设主题(默认暗色,失败静默) */}
        <script dangerouslySetInnerHTML={{ __html:
          `try{if(localStorage.getItem("theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}` }} />
 </head>
 <body className="min-h-full">
      <LangProvider>
        <TopNav />
        <WatchlistSidebar />
        {children}
        {/* 全站合规声明 — 编辑部版式 */}
 <footer className="mt-16 border-t border-line">
 <div className="mx-auto max-w-[1480px] px-6 py-9 text-center text-[11px] leading-relaxed text-faint">
            <p className="font-display text-[15px] italic tracking-wide text-muted">Not a Stock God</p>
 <p className="mt-1.5 text-[12px] text-muted"><T zh="你不是股神,但股神陪你一起看股票" en="You're not a stock god — but five of them watch the market with you." /></p>
 <p className="mt-4 font-medium text-muted">
              本站不面向中国大陆用户 · This site is not intended for users in mainland China.
            </p>
 <p className="mx-auto mt-2 max-w-3xl">
   <T zh="所有内容为信息整理与个人研究记录,非投资建议,不构成对任何证券、平台或交易所的要约或背书。股票、加密货币、代币化资产均涉及重大风险,可能损失全部本金。风险请自行分辨与承担。页面含邀请链接(含返佣)。交易前请自行研究并确认所在司法管辖区的合规性。"
      en="All content is informational and personal research, not investment advice, and is not an offer or endorsement of any security, platform, or exchange. Stocks, crypto, and tokenized assets carry substantial risk including total loss of principal. You are solely responsible for your decisions. Pages may contain referral links. Do your own research and confirm compliance in your jurisdiction." />
            </p>
 <p className="kicker mt-5 !text-faint">© Not a Stock God · Not Financial Advice</p>
          </div>
        </footer>
        {/* 底部 Tab 栏占位(仅移动端,防止内容被固定栏遮住) */}
        <div className="h-[58px] md:hidden" />
        <MobileTabBar />
      </LangProvider>
      </body>
    </html>
  );
}
