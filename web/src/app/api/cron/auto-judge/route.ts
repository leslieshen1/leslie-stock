import { dispatchWorkflow } from "@/lib/cron-dispatch";

// cron-job.org(或 Vercel Cron)命中 → 准点派发「五方自动刷新」workflow(每周一次)。
// 同 reports/arena:带 Authorization: Bearer <CRON_SECRET> 的 GET。
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return dispatchWorkflow(req, "auto-judge.yml");
}
