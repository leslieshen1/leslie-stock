import HoldingsClient from "./HoldingsClient";

// Leslie 的私人持仓页(不进导航、不收录):口令同 /stats,进来就是持仓。
// force-dynamic:私密页只有一个访客,别让 CDN/浏览器缓存旧页面壳(踩过:部署后手机拿旧 HTML 看不到新按钮);
// 顺带保证右上「今日」日期不被静态化冻结在构建日。
export const dynamic = "force-dynamic";
export const metadata = {
  title: "持仓",
  robots: { index: false, follow: false },
};

export default function LesliePage() {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <main className="mx-auto max-w-6xl px-4 pb-10 pt-4 sm:px-6">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">持仓</h1>
        <p className="text-sm text-muted">{today}</p>
      </header>
      <HoldingsClient />
    </main>
  );
}
