import { loadWhales } from "@/lib/whales";
import WhalesClient from "./WhalesClient";

export const metadata = {
 title: "聪明钱 · 名人持仓 | 我不是股神",
 description: "段永平 / 巴菲特 13F + A 股顶流基金重仓与交易变动。看占比,不看名单。",
};

export default function WhalesPage() {
  const { investors } = loadWhales();

  return (
 <main className="mx-auto max-w-5xl px-6 py-8">
      <WhalesClient investors={investors} />
    </main>
  );
}
