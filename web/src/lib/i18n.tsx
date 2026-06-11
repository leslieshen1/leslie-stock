"use client";

// 全站轻量双语:默认中文,右上角切 EN,localStorage 持久。
// 用法:const { t } = useLang(); t("列表", "List") —— 译文就写在调用点,不维护字典文件。
// 范围:UI 框架层(导航/页头/表头/按钮/页脚)。AI 生成内容(判词/报告正文)V1 保持中文。

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "zh" | "en";

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: "zh",
  setLang: () => {},
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("zh"); // SSR 首帧恒为中文,mount 后按用户偏好升级
  useEffect(() => {
    try {
      if (localStorage.getItem("lang") === "en") setLangState("en");
    } catch { /* SSR/隐私模式 */ }
  }, []);
  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("lang", l);
      document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
    } catch { /* ignore */ }
  };
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useLang() {
  const { lang, setLang } = useContext(Ctx);
  return { lang, setLang, t: (zh: string, en: string) => (lang === "zh" ? zh : en) };
}

/** 右上角语言切换(中 | EN) */
export function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-line bg-surface p-0.5 text-[11px] font-semibold">
      {(["zh", "en"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          aria-label={l === "zh" ? "切换到中文" : "Switch to English"}
          className={`rounded-md px-2 py-1 transition ${
            lang === l ? "bg-surface-3 text-white" : "text-muted hover:text-ink"
          }`}
        >
          {l === "zh" ? "中" : "EN"}
        </button>
      ))}
    </div>
  );
}

/** 服务端页面里嵌的小双语文本(把 server component 的标题变成可切换) */
export function T({ zh, en, className }: { zh: string; en: string; className?: string }) {
  const { t } = useLang();
  return <span className={className}>{t(zh, en)}</span>;
}
