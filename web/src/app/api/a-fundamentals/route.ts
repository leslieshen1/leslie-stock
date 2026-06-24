// 单只 A 股盘面(热力图详情面板按需拉)。包 lib/a-fundamentals 的腾讯实时取数,
// 带限流 + 短缓存。之前热力图 A 股节点的「基本面」整块空着,就是因为没有这条客户端通路
// (只有美股的 /api/fundamentals,A 股代码查不到 → 不渲染)。
import { fetchAFundamentals } from "@/lib/a-fundamentals";
import { clientIp, rateLimit, tooMany } from "@/lib/api-guard";
import { safeCode } from "@/lib/sanitize";

// 不 force-dynamic(它会废掉缓存):响应按 ?code 的 URL 边缘缓存(下方 s-maxage=60),命中不打函数。

export async function GET(req: Request) {
  const rl = rateLimit(`afund:${clientIp(req)}`, 120, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfter);

  const sp = new URL(req.url).searchParams;
  const code = safeCode((sp.get("code") || "").trim());
  if (!code) return Response.json({ fund: null });
  const market = sp.get("market") === "hk" ? "hk" : undefined; // 港股走腾讯 hk 符号

  const fund = await fetchAFundamentals(code, market);
  return Response.json(
    { fund },
    { headers: { "cache-control": "s-maxage=60, stale-while-revalidate=120" } },
  );
}
