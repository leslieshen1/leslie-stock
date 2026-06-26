"use client";

// 全站「点股票开新标签页」:委托捕获所有指向 /stock/ 的链接点击,改成新标签打开、保留当前页。
// 只接管左键 + 无修饰键的普通点击;Cmd/Ctrl/Shift/Alt/中键/已 preventDefault 的一律放行(走浏览器原生)。
// 覆盖所有 <a href=.../stock/...>(= 全站 Next <Link>);scan 列表行与搜索框是编程式 router.push,各自单独改。
import { useEffect } from "react";

export default function StockLinksNewTab() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (!href.includes("/stock/") || a.target === "_blank") return;
      e.preventDefault();
      window.open(href, "_blank", "noopener");
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
