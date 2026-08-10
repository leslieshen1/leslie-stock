import type { Metadata } from "next";
import AllocationPlanner from "./AllocationPlanner";

export const metadata: Metadata = {
  title: "未来仓位 · 我不是股神",
  description: "用目标比例和风险温度管理未来资产配置。",
};

export default function AllocationPage() {
  return <AllocationPlanner />;
}
