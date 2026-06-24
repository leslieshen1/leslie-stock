"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// 盘报小红点:读极小的 reports-latest.json(发布时由 publish_report.py 写,只含最新报告的 id/时间),
// 与 localStorage 里「已读 id」比对。有新报告且当前不在 /reports → true,在「盘报」导航旁亮点。
// 进过 /reports 自动标记已读、清点。数据是静态文件(CDN 缓存)+ localStorage,零 Vercel 函数成本。
const SEEN_KEY = "sg:reportsSeen";

export function useNewReport(): boolean {
  const pathname = usePathname();
  const [latestId, setLatestId] = useState<string | null>(null);
  const [hasNew, setHasNew] = useState(false);

  // 取最新报告指针(挂载时一次;切回标签页时再校一次,catch 住开着页面时新出的盘报)
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/data/reports-latest.json", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => { if (alive && j?.id) setLatestId(String(j.id)); })
        .catch(() => {});
    load();
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; document.removeEventListener("visibilitychange", onVis); };
  }, []);

  // 在 /reports 上 → 标记已读、清点;否则按「最新 id ≠ 已读 id」决定是否亮点
  useEffect(() => {
    if (!latestId) return;
    try {
      if (pathname.startsWith("/reports")) {
        localStorage.setItem(SEEN_KEY, latestId);
        setHasNew(false);
      } else {
        setHasNew(localStorage.getItem(SEEN_KEY) !== latestId);
      }
    } catch {
      /* localStorage 不可用(隐私模式等)→ 不亮点、不报错 */
    }
  }, [latestId, pathname]);

  return hasNew;
}
