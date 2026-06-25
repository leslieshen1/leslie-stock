import { dispatchWorkflow } from "@/lib/cron-dispatch";

// cron-job.org 准点命中(A 股开盘前,北京 9:00)→ 派发五股神 A 股决策 workflow(arena-brain-a.yml)。
// 鉴权 Authorization: Bearer ${CRON_SECRET}。
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return dispatchWorkflow(req, "arena-brain-a.yml");
}
