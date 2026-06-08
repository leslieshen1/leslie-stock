import type { NewsItem } from "@/lib/news";

// 个股近期新闻（Google News，免费）。轻量列表，标题外链。
export default function NewsStrip({ items }: { items: NewsItem[] }) {
  const top = items.slice(0, 6);
  if (!top.length) return null;
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-ink">近期新闻</span>
        <span className="text-[10px] text-faint">Google News</span>
      </div>
      <ul className="space-y-2.5">
        {top.map((n, i) => (
          <li key={i}>
            <a
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-baseline gap-2"
            >
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-faint group-hover:bg-accent" />
              <span className="flex-1 text-sm leading-snug text-muted group-hover:text-ink">
                {n.title}
                {n.source && <span className="ml-1.5 text-[11px] text-faint">· {n.source}</span>}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
