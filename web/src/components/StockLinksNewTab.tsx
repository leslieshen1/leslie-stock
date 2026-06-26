"use client";

// 全站「点股票开新标签页」:capture 阶段抢在 Next <Link> 的 onClick 之前,接管指向 /stock/ 的链接点击。
// 为什么必须 capture + stopPropagation:Next <Link> 普通左键点击会自己 preventDefault + 走客户端导航,
// 若在冒泡阶段拦、或判 e.defaultPrevented,事件到我手里时早被 Link 抢先 → 根本拦不住(这是上一版的 bug)。
// capture 从 document 向下、最先到达,先 stopPropagation 掐断到 Link 的传播,再自己 window.open 新标签。
// 只接管左键 + 无修饰键;中键 / Cmd / Ctrl / Shift / Alt 一律放行(走浏览器原生新标签 / 原生导航)。
// 覆盖全站所有 <a href=.../stock/...>(= Next <Link>);scan 列表行与搜索框是编程式 router.push,各自单独改。
import { useEffect } from "react";

export default function StockLinksNewTab() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (!href.includes("/stock/") || a.target === "_blank") return;
      e.preventDefault();
      e.stopPropagation();
      window.open(href, "_blank", "noopener");
    }
    document.addEventListener("click", onClick, true); // true = capture:抢在 Next <Link> onClick 前面
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
