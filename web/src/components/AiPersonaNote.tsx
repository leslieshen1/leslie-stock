"use client";

import { useLang } from "@/lib/i18n";

// 全站可复用:凡是展示真人名 + 评分的页面,就近标注「AI 模拟·非本人」(审计主题 C)。
export default function AiPersonaNote({ className = "" }: { className?: string }) {
  const { t } = useLang();
  return (
    <p
      className={`rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-[11px] leading-relaxed text-muted ${className}`}
    >
      <span className="font-semibold text-faint">
        {t("AI 方法论模拟", "AI methodology simulation")}
      </span>{" "}
      {t(
        "—— 巴菲特 / 段永平 / 德鲁肯米勒 / Serenity 的评分由 AI 依据各自公开方法论生成,并非本人真实观点或持仓,亦不代表其本人。非投资建议。",
        "— scores for Buffett / Duan / Druckenmiller / Serenity are AI-generated from each investor's public methodology; they are not the real persons' views or holdings and do not represent them. Not financial advice.",
      )}
    </p>
  );
}
