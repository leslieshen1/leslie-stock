import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[62vh] max-w-xl flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-6xl font-semibold tracking-tight text-accent">404</p>
      <h1 className="mt-4 text-xl font-semibold text-ink">没找到这个页面</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        Page not found —— 链接可能失效,或股票代码不存在。
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-2 text-sm font-semibold text-accent transition hover:brightness-110"
        >
          回热力图
        </Link>
        <Link
          href="/scan"
          className="rounded-lg border border-line bg-surface px-4 py-2 text-sm text-muted transition hover:text-ink"
        >
          去列表找票
        </Link>
      </div>
    </main>
  );
}
