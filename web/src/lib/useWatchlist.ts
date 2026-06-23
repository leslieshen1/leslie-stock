"use client";

import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "leslie-stock-watchlist-v1";

export type LocalWatchEntry = {
  code: string;
  market: "a" | "hk" | "us" | "kr";
  name: string;
  added_at: string;
  // 可选快照字段（避免每次访问需 fetch）
  sector?: string;
  score?: number;
  verdict?: string;
  verdict_label?: string;
  market_cap_yi?: number | null;
  layer?: 1 | 2 | 3 | 4 | null;
  thesis?: string;
};

function load(): LocalWatchEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function save(list: LocalWatchEntry[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  // 通知其他 tab / 组件
  window.dispatchEvent(new CustomEvent("watchlist-changed"));
}

export function useWatchlist() {
  const [items, setItems] = useState<LocalWatchEntry[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setItems(load());
    setReady(true);
    const refresh = () => setItems(load());
    window.addEventListener("watchlist-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("watchlist-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const add = useCallback((entry: Omit<LocalWatchEntry, "added_at">) => {
    const list = load();
    if (list.some((x) => x.code === entry.code && x.market === entry.market)) {
      return false;
    }
    list.push({ ...entry, added_at: new Date().toISOString() });
    save(list);
    setItems(list);
    return true;
  }, []);

  const remove = useCallback((code: string, market: string) => {
    const list = load().filter(
      (x) => !(x.code === code && x.market === market)
    );
    save(list);
    setItems(list);
  }, []);

  const has = useCallback(
    (code: string, market: string) =>
      items.some((x) => x.code === code && x.market === market),
    [items]
  );

  const toggle = useCallback(
    (entry: Omit<LocalWatchEntry, "added_at">) => {
      if (has(entry.code, entry.market)) {
        remove(entry.code, entry.market);
        return false;
      }
      add(entry);
      return true;
    },
    [has, add, remove]
  );

  return { items, ready, add, remove, has, toggle };
}
