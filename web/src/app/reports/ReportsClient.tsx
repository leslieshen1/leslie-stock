"use client";

import { useMemo, useState } from "react";
import { marked } from "marked";
import { useLang } from "@/lib/i18n";

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
  intraday: "bg-surface-3 text-ink border-line",
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
const TABS: [Filter, string, string][] = [
  ["all", "全部", "All"], ["premarket", "盘前", "Pre-market"], ["intraday", "盘中", "Intraday"], ["close", "收盘", "Close"],
];

// "2026-06-11" → "06-11 · 周四" / "Jun 11 · Thu"
function dateHeader(ds: string, lang: "zh" | "en"): string {
  const d = new Date(ds + "T12:00:00");
  if (Number.isNaN(d.getTime())) return ds;
  if (lang === "en")
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " +
           d.toLocaleDateString("en-US", { weekday: "short" });
  const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return `${ds.slice(5)} · ${wd}`;
}

export default function ReportsClient({ reports }: { reports: Report[] }) {
  const { t, lang } = useLang();
  const [filter, setFilter] = useState<Filter>("all");
  const [showAll, setShowAll] = useState(false);
  // 默认展开当前列表的第一篇(最新);显式点过的以 overrides 为准
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const filtered = useMemo(
    () => (filter === "all" ? reports : reports.filter((r) => r.type === filter)),
    [reports, filter]
  );

  // 按日期分组(降序),默认只露最近 3 个有报告的日子
  const { groups, hiddenDays } = useMemo(() => {
    const by = new Map<string, Report[]>();
    for (const r of filtered) {
      if (!by.has(r.date)) by.set(r.date, []);
      by.get(r.date)!.push(r);
    }
    const dates = [...by.keys()].sort().reverse();
    const visible = showAll ? dates : dates.slice(0, 3);
    return {
      groups: visible.map((d) => ({ date: d, items: by.get(d)! })),
      hiddenDays: dates.length - visible.length,
    };
  }, [filtered, showAll]);

  if (!reports.length) {
    return <p className="text-sm text-faint">{t("还没有报告。盘前 / 盘中 / 收盘各跑一次就会出现在这里。", "No reports yet. Once the pre-market, intraday and close runs go out, they'll show up here.")}</p>;
  }

  let globalIdx = -1; // 全列表第一篇默认展开
  return (
    <>
      <div className="mb-5 inline-flex rounded-lg border border-line bg-surface p-1 text-sm">
        {TABS.map(([k, zhLabel, enLabel]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-md px-3.5 py-1.5 font-medium transition ${
              filter === k ? "bg-surface-3 text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {t(zhLabel, enLabel)}
          </button>
        ))}
      </div>

      <div className="space-y-6">
        {groups.map((g) => (
        <section key={g.date}>
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="font-mono text-[13px] font-semibold tracking-wide text-ink">{dateHeader(g.date, lang)}</h3>
            <span className="h-px flex-1 bg-line" />
            <span className="text-[10px] text-faint">{g.items.length} {t("篇", g.items.length > 1 ? "reports" : "report")}</span>
          </div>
          <div className="space-y-3">
        {g.items.map((r) => {
          globalIdx += 1;
          const idx = globalIdx;
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
          </div>
        </section>
        ))}

        {hiddenDays > 0 && (
          <button
            onClick={() => setShowAll(true)}
            className="w-full rounded-xl border border-dashed border-line py-2.5 text-xs text-muted transition hover:border-faint hover:text-ink"
          >
            {t(`查看更早 · 还有 ${hiddenDays} 天`, `Show older · ${hiddenDays} more day${hiddenDays > 1 ? "s" : ""}`)}
          </button>
        )}
        {showAll && (
          <button
            onClick={() => setShowAll(false)}
            className="w-full rounded-xl border border-dashed border-line/60 py-2 text-[11px] text-faint transition hover:text-muted"
          >
            {t("收起,只看最近 3 天", "Collapse to last 3 days")}
          </button>
        )}
        {!filtered.length && <p className="py-8 text-center text-sm text-faint">{t("这个类型还没有报告。", "No reports of this type yet.")}</p>}
      </div>
    </>
  );
}
