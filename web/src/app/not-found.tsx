import Link from "next/link";
import { T } from "@/lib/i18n";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[62vh] max-w-xl flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-6xl font-semibold tracking-tight text-accent">404</p>
      <h1 className="mt-4 text-xl font-semibold text-ink">
        <T zh="没找到这个页面" en="Page not found" />
      </h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        <T zh="链接可能失效,或股票代码不存在。" en="The link may be broken, or that ticker doesn't exist." />
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-2 text-sm font-semibold text-accent transition hover:brightness-110"
        >
          <T zh="回热力图" en="Back to heatmap" />
        </Link>
        <Link
          href="/scan"
          className="rounded-lg border border-line bg-surface px-4 py-2 text-sm text-muted transition hover:text-ink"
        >
          <T zh="去列表找票" en="Browse the list" />
        </Link>
      </div>
    </main>
  );
}
