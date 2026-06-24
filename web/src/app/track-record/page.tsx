import TrackRecordClient from "./TrackRecordClient";
import { T } from "@/lib/i18n";

export const metadata = {
  title: "判读后表现追踪 · 五方高分股票真的涨更多吗 · 我不是股神",
  description:
    "把五方判读分在 2026-06-17 锁死,之后只读不改,逐日追踪各分档股票从那天起的真实涨幅与对大盘的超额。前瞻测试、每 5 分钟自动更新、非投资建议。",
};

// 纯静态壳:数据在客户端直读 GitHub data-live(不经 Vercel 函数)→ 这个页面本身几乎零成本。
export default function TrackRecordPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-6 pb-12 pt-3">
      <header className="mb-4">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">
          <T zh="判读后表现" en="Track Record" />
        </h1>
        <p className="mt-1 text-xs text-faint">
          <T
            zh="判读分锁死那天起,高分股票到底涨没涨赢大盘 · 前瞻测试 · 非投资建议"
            en="Have high-score stocks beaten the market since we froze the scores · forward test · not financial advice"
          />
        </p>
      </header>
      <TrackRecordClient />
    </main>
  );
}
