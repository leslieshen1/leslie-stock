import { dispatchWorkflow } from "@/lib/cron-dispatch";

// cron-job.org 准点命中(收盘后)→ 派发 data-refresh workflow(宏观/财报/新闻/ETF/基本面 → JSON)。
// 同 reports/arena:GET + Authorization: Bearer <CRON_SECRET>。
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return dispatchWorkflow(req, "data-refresh.yml");
}
