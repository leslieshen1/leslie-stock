"use client";

// 个股详情页「收藏到我的」按钮。复用 useWatchlist(localStorage,与列表/热力图同一套)。
// 药丸样式(带边框+背景+文字),保证深色页头上清晰可见(早期纯 ☆ 太淡看不见)。
import { useWatchlist } from "@/lib/useWatchlist";
import { useLang } from "@/lib/i18n";

export default function WatchStar({
  code,
  market,
  name,
  sector,
  mcapYi,
}: {
  code: string;
  market: "a" | "hk" | "us" | "kr";
  name: string;
  sector?: string;
  mcapYi?: number | null;
}) {
  const { t } = useLang();
  const { has, toggle } = useWatchlist();
  const starred = has(code, market);
  return (
    <button
      onClick={() =>
        toggle({ code, market, name, sector, market_cap_yi: mcapYi ?? null })
      }
      aria-label={starred ? t("从自选移除", "Remove from watchlist") : t("加入自选", "Add to watchlist")}
      title={starred ? t("从自选移除", "Remove from watchlist") : t("加入自选", "Add to watchlist")}
      className={`shrink-0 inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium leading-none transition ${
        starred
          ? "border-accent/50 bg-accent-soft text-accent"
          : "border-line bg-surface-2 text-muted hover:text-accent hover:border-accent/40"
      }`}
    >
      <span className="text-sm leading-none">{starred ? "★" : "☆"}</span>
      {t(starred ? "已收藏" : "收藏", starred ? "Saved" : "Save")}
    </button>
  );
}
