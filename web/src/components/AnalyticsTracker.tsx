"use client";

// 自有埋点:匿名 ID(localStorage,无 cookie / 无 PII)+ 路由级 PV + 委托式点击捕获。
// 全程 fire-and-forget,失败静默,绝不影响页面。数据进 /api/track → 你自己的 Upstash。
import { useEffect } from "react";
import { usePathname } from "next/navigation";

// 机器人/爬虫/headless 过滤:让 DAU ≈ 真人(navigator.webdriver + 已知 bot UA)。
const BOT_RE =
  /bot|crawl|spider|slurp|mediapartners|bingpreview|facebookexternal|whatsapp|telegram|embedly|applebot|googlebot|bingbot|yandex|baidu|sogou|duckduck|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|statuscake|datadog|newrelic|scrapy|python-requests|axios|node-fetch|okhttp|curl|wget|semrush|ahrefs|mj12|petalbot|bytespider|gptbot|claudebot|ccbot|amazonbot|chatgpt|perplexity/i;

function isBot(): boolean {
  try {
    if (navigator.webdriver) return true;
    return BOT_RE.test(navigator.userAgent || "");
  } catch {
    return false;
  }
}

function anonId(): string {
  try {
    let id = localStorage.getItem("sg_aid");
    if (!id) {
      id =
        (typeof crypto !== "undefined" && crypto.randomUUID?.()) ||
        Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("sg_aid", id);
    }
    return id;
  } catch {
    return "";
  }
}

function send(event: string, data: Record<string, string>) {
  if (isBot()) return;
  const aid = anonId();
  if (!aid) return;
  const body: Record<string, string> = { aid, event, ...data };
  // 当天首个事件带 dau=1 → 服务端只在此时 sadd DAU,省掉后续每个事件重复 sadd(砍 Upstash 命令量)。
  // localStorage 不可用(隐私模式)时 dau 恒为 "1" → 退化成原行为,绝不漏记 DAU。
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem("sg_dau") !== today) {
      localStorage.setItem("sg_dau", today);
      body.dau = "1";
    }
  } catch {
    body.dau = "1";
  }
  try {
    fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

export default function AnalyticsTracker() {
  const pathname = usePathname();

  // PV:每次路由变化
  useEffect(() => {
    if (!pathname) return;
    const data: Record<string, string> = { path: pathname };
    // 会话首个 PV 带上外部来源(document.referrer),只记一次 → 避免站内跳转污染来源统计
    try {
      if (!sessionStorage.getItem("sg_ref_sent")) {
        sessionStorage.setItem("sg_ref_sent", "1");
        if (document.referrer) data.ref = document.referrer.slice(0, 300);
      }
    } catch { /* ignore */ }
    // 首访(该设备首次)带 new=1 → 服务端只在此时判 cohort,省掉每个 PV 一条 first NX set
    try {
      if (!localStorage.getItem("sg_seen")) {
        localStorage.setItem("sg_seen", "1");
        data.new = "1";
      }
    } catch { /* ignore */ }
    send("pageview", data);
  }, [pathname]);

  // 点击:委托捕获 a / button / [data-track](其余忽略,避免噪声)
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      const el = t?.closest("a,button,[data-track]") as HTMLElement | null;
      if (!el) return;
      const label = (
        el.getAttribute("data-track") ||
        el.getAttribute("aria-label") ||
        el.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 48);
      if (!label) return;
      send("click", { path: window.location.pathname, label });
    }
    document.addEventListener("click", onClick, { capture: true, passive: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  return null;
}
