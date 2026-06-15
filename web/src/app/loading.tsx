// 路由级加载态 —— 导航/数据未就绪时的占位,替掉空白闪屏。
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-[62vh] max-w-xl flex-col items-center justify-center px-6 text-center">
      <span className="inline-flex items-center gap-2.5 text-sm text-muted">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        加载中<span className="text-faint">…</span>
      </span>
    </main>
  );
}
