"use client";

import { usePathname } from "next/navigation";

// /notes(投资笔记)是纸感独立壳:根 layout 里的站点级 server JSX(footer、TabBar 占位)
// 无法用 usePathname,统一包进这个 client 网关按路径隐藏。
export default function HideOnNotes({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/notes") || pathname?.startsWith("/allocation")) return null;
  return <>{children}</>;
}
