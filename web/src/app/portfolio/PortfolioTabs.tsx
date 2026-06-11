"use client";

import { useState } from "react";
import WatchlistClient from "../watchlist/WatchlistClient";
import { useLang } from "@/lib/i18n";

export default function PortfolioTabs({ holdings }: { holdings: React.ReactNode }) {
  const { t } = useLang();
  const [tab, setTab] = useState<"watch" | "hold">("watch");

  return (
    <>
 <div className="mb-6 inline-flex rounded-lg border border-line bg-surface p-1 text-sm">
        <button
          onClick={() => setTab("watch")}
          className={`rounded-md px-4 py-1.5 font-medium transition ${
 tab === "watch" ? "bg-surface-3 text-white" : "text-muted hover:text-ink"
          }`}
        >
          {t("观察列表", "Watchlist")}
        </button>
        <button
          onClick={() => setTab("hold")}
          className={`rounded-md px-4 py-1.5 font-medium transition ${
 tab === "hold" ? "bg-surface-3 text-white" : "text-muted hover:text-ink"
          }`}
        >
          {t("持仓", "Holdings")}
        </button>
      </div>

      {tab === "watch" ? <WatchlistClient /> : holdings}
    </>
  );
}
