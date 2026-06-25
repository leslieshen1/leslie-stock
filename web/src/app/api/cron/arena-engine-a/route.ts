import { dispatchWorkflow } from "@/lib/cron-dispatch";

// cron-job.org 准点命中(A 股收盘后,北京 15:30)→ 派发 A 股引擎 workflow(arena-engine-a.yml)。
// 先刷 a-price-history 再撮合结账 + 部署。鉴权 Authorization: Bearer ${CRON_SECRET}。
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return dispatchWorkflow(req, "arena-engine-a.yml");
}
