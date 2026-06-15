"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";

// 首访引导条:一次性、可关、localStorage 记忆。不挡路、不弹窗。
const KEY = "nasg_onboard_v1";

export default function OnboardingBanner() {
  const { t } = useLang();
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setShow(true);
    } catch {
      /* 隐私模式等读不到,默认不打扰 */
    }
  }, []);

  if (!show) return null;

  function dismiss() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* 静默 */
    }
    setShow(false);
  }

  const steps = [
    t("热力图 / 列表里找一只票", "Find a stock on the heatmap or list"),
    t("点开看五方各自的判读与分歧", "Open it for five independent readings"),
    t("按均分 / 分歧排序,挑你想深挖的", "Sort by avg / divergence to dig in"),
  ];

  return (
    <div className="relative mb-3 overflow-hidden rounded-2xl border border-accent/25 bg-accent-soft/40 px-4 py-3.5 pr-10 sm:px-5 sm:pr-12">
      <button
        onClick={dismiss}
        aria-label={t("关闭", "Dismiss")}
        className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-md text-faint transition hover:bg-surface-2 hover:text-ink"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <p className="text-sm font-semibold text-ink">
        {t("你不是股神,但股神陪你一起看股票", "You’re not a stock god — five of them watch with you")}
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">
        {t(
          "五种投资框架,对同一只票各自独立打分。分歧越大,越值得你亲自研究。",
          "Five frameworks score the same stock independently — the bigger the gap, the more it’s worth your own look."
        )}
      </p>

      <ol className="mt-2.5 flex flex-col gap-1.5 sm:flex-row sm:gap-5">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-xs text-muted">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-accent/40 font-mono text-[10px] font-semibold text-accent">
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href="/scan"
          onClick={dismiss}
          className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent transition hover:brightness-110"
        >
          {t("去列表挑票 →", "Browse the list →")}
        </Link>
        <Link href="/about" className="text-xs text-muted transition hover:text-ink">
          {t("了解方法论 / 五方是谁", "How it works · who the five are")}
        </Link>
      </div>
    </div>
  );
}
