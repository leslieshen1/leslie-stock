import { dispatchWorkflow } from "@/lib/cron-dispatch";

// cron-job.org 准点命中(美股收盘后)→ 派发云端价格刷新 workflow(us-price-refresh.yml)。
// 它更新 us-stocks 收盘价 + price-history;之后 arena-engine 才有当日数据可结账(脱离本地 Mac)。
// 鉴权 Authorization: Bearer ${CRON_SECRET}。
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return dispatchWorkflow(req, "us-price-refresh.yml");
}
