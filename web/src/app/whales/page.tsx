import { loadWhales } from "@/lib/whales";
import { loadCongressSummary, loadAvgScores } from "@/lib/congress";
import WhalesClient from "./WhalesClient";

export const metadata = {
 title: "聪明钱 · 名人持仓 + 国会交易 | 我不是股神",
 description: "段永平 / 巴菲特 13F + A 股顶流基金 + 美国国会议员交易申报(PTR)。看占比与变动,不看名单。",
};

export default function WhalesPage() {
  const { investors } = loadWhales();
  const congress = loadCongressSummary();
  const avg = loadAvgScores();

  return (
 <main className="mx-auto max-w-5xl px-6 pb-8 pt-3">
      <WhalesClient investors={investors} congress={congress} avg={avg} />
    </main>
  );
}
