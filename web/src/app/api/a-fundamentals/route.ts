// 单只 A 股盘面(热力图详情面板按需拉)。包 lib/a-fundamentals 的腾讯实时取数,
// 带限流 + 短缓存。之前热力图 A 股节点的「基本面」整块空着,就是因为没有这条客户端通路
// (只有美股的 /api/fundamentals,A 股代码查不到 → 不渲染)。
import { fetchAFundamentals } from "@/lib/a-fundamentals";
import { clientIp, rateLimit, tooMany } from "@/lib/api-guard";
import { safeCode } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const rl = rateLimit(`afund:${clientIp(req)}`, 120, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfter);

  const code = safeCode((new URL(req.url).searchParams.get("code") || "").trim());
  if (!code) return Response.json({ fund: null });

  const fund = await fetchAFundamentals(code);
  return Response.json(
    { fund },
    { headers: { "cache-control": "s-maxage=60, stale-while-revalidate=120" } },
  );
}
