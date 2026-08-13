import type { Metadata } from "next";
import CurrentHoldingsPlanner from "./CurrentHoldingsPlanner";

export const metadata: Metadata = {
  title: "当前持仓 · 我不是股神",
  description: "记录当前持仓金额，查看真实占比、目标偏离和下一步配置提示。",
};

export default function CurrentHoldingsPage() {
  return <CurrentHoldingsPlanner />;
}
