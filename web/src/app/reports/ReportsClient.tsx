"use client";

import { useMemo, useState } from "react";
import { marked } from "marked";

export type Report = {
  id: string;
  type: "premarket" | "intraday" | "close";
  typeLabel: string;
  date: string;
  timeET: string;
  title: string;
  tone: string;
  body: string;
  publishedAt: string;
};

const BADGE: Record<string, string> = {
  premarket: "bg-accent/15 text-accent border-accent/30",
  intraday: "bg-surface-3 text-white border-line",
  close: "bg-down-soft text-down border-down/30",
};

marked.setOptions({ gfm: true, breaks: false });

const PROSE =
  "text-sm leading-relaxed text-muted " +
  "[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:text-ink [&>h2:first-child]:mt-0 " +
  "[&_strong]:font-semibold [&_strong]:text-ink [&_p]:my-2 " +
  "[&_ul]:my-2 [&_ul]:space-y-1 [&_li]:ml-4 [&_li]:list-disc [&_li]:marker:text-faint " +
  "[&_table]:my-3 [&_table]:w-full [&_table]:text-xs " +
  "[&_th]:border-b [&_th]:border-line [&_th]:py-1.5 [&_th]:pr-3 [&_th]:text-left [&_th]:font-medium [&_th]:text-muted " +
  "[&_td]:border-b [&_td]:border-line/50 [&_td]:py-1.5 [&_td]:pr-3 [&_td]:align-top " +
  "[&_blockquote]:mt-3 [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-[11px] [&_blockquote]:text-faint " +
  "[&_a]:text-accent [&_hr]:my-4 [&_hr]:border-line";

type Filter = "all" | "premarket" | "intraday" | "close";
const TABS: [Filter, string][] = [
  ["all", "全部"], ["premarket", "盘前"], ["intraday", "盘中"], ["close", "收盘"],
];

export default function ReportsClient({ reports }: { reports: Report[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  // 默认展开当前列表的第一篇(最新);显式点过的以 overrides 为准
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const filtered = useMemo(
    () => (filter === "all" ? reports : reports.filter((r) => r.type === filter)),
    [reports, filter]
  );

  if (!reports.length) {
    return <p className="text-sm text-faint">还没有报告。盘前 / 盘中 / 收盘各跑一次就会出现在这里。</p>;
  }

  return (
    <>
      <div className="mb-5 inline-flex rounded-lg border border-line bg-surface p-1 text-sm">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-md px-3.5 py-1.5 font-medium transition ${
              filter === k ? "bg-surface-3 text-white" : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {filtered.map((r, idx) => {
          const isOpen = overrides[r.id] ?? idx === 0;
          return (
            <article key={r.id} className="overflow-hidden rounded-xl border border-line bg-surface">
              <button
                onClick={() => setOverrides((o) => ({ ...o, [r.id]: !(o[r.id] ?? idx === 0) }))}
                className="flex w-full items-start gap-3 px-5 py-4 text-left transition hover:bg-surface-2"
              >
                <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${BADGE[r.type] || ""}`}>
                  {r.typeLabel}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <h2 className="truncate text-sm font-semibold text-ink">{r.title}</h2>
                    {r.timeET && <span className="shrink-0 text-[11px] text-faint">{r.timeET}</span>}
                  </div>
                  {!isOpen && r.tone && <p className="mt-1 truncate text-xs text-muted">{r.tone}</p>}
                </div>
                <span className="shrink-0 text-base leading-none text-faint">{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && (
                <div
                  className={`border-t border-line px-5 py-4 ${PROSE}`}
                  dangerouslySetInnerHTML={{ __html: marked.parse(r.body) as string }}
                />
              )}
            </article>
          );
        })}
        {!filtered.length && <p className="py-8 text-center text-sm text-faint">这个类型还没有报告。</p>}
      </div>
    </>
  );
}
