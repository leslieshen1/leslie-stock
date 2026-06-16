import { dispatchWorkflow } from "@/lib/cron-dispatch";

// Vercel Cron 命中(schedule 在 vercel.json)→ 准点派发盘前报告 workflow。
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return dispatchWorkflow(req, "premarket.yml");
}
