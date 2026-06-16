import { dispatchWorkflow } from "@/lib/cron-dispatch";

// Vercel Cron 命中(schedule 在 vercel.json)→ 准点派发收盘复盘 workflow。
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return dispatchWorkflow(req, "close.yml");
}
