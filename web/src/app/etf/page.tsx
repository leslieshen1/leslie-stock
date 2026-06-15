import EtfClient from "./EtfClient";

export const metadata = {
  title: "ETF · 板块业绩 | 我不是股神",
  description: "4500+ 只美股 ETF,按跟踪板块归类,提供 1 年 / 5 年回报、最大回撤、费率与规模,并附 AI 依段永平 / 巴菲特方法论生成的简要判读(非本人观点)。",
};

export const revalidate = 300;

export default function EtfPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-8 pt-3 sm:px-6">
      <EtfClient />
    </main>
  );
}
