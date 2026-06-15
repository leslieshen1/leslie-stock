"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useLang } from "@/lib/i18n";

// 路由级错误边界 —— 替掉 Next 默认报错页,给品牌化的失败态 + 重试。
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLang();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[62vh] max-w-xl flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-2xl font-semibold tracking-tight text-down">
        {t("出错了", "Something went wrong")}
      </p>
      <h1 className="mt-3 text-lg font-semibold text-ink">
        {t("页面加载出了点问题", "This page hit a snag")}
      </h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        {t("多半是数据源临时抽风,重试或回首页通常就好。", "Usually a flaky data source — retry or head home and it's typically fine.")}
      </p>
      {error?.digest && (
        <p className="mt-2 font-mono text-[11px] text-faint">ref: {error.digest}</p>
      )}
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-2 text-sm font-semibold text-accent transition hover:brightness-110"
        >
          {t("重试", "Retry")}
        </button>
        <Link
          href="/"
          className="rounded-lg border border-line bg-surface px-4 py-2 text-sm text-muted transition hover:text-ink"
        >
          {t("回首页", "Home")}
        </Link>
      </div>
    </main>
  );
}
