import EtfClient from "./EtfClient";

export const metadata = {
  title: "ETF · 段永平/巴菲特镜头 | 我不是股神",
  description: "4500+ 只美股 ETF 的段永平/巴菲特判读:低费率宽基定投友好、行业主题择时押注、杠杆反向是赌场。看清你买的是什么。",
};

export const revalidate = 300;

export default function EtfPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 pb-8 pt-3 sm:px-6">
      <EtfClient />
    </main>
  );
}
