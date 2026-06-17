import { dispatchWorkflow } from "@/lib/cron-dispatch";

// cron-job.org 准点命中(开盘前)→ 派发五股神决策 workflow(arena-brain.yml)。
// 替代 GitHub 自家 schedule(常延迟/丢)。鉴权 Authorization: Bearer ${CRON_SECRET}。
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return dispatchWorkflow(req, "arena-brain.yml");
}
