// 笔记目录(公开):完整知识树人人可看——目录本身就是商品详情页。免费篇带 free 标记。
import { redis } from "@/lib/stats";
import { NK, type Toc } from "@/lib/notes";

export const dynamic = "force-dynamic";

export async function GET() {
  const r = redis();
  if (!r) return Response.json({ connected: false }, { status: 503 });
  try {
    const v = await r.get<string | Toc>(NK.toc);
    if (v == null) return Response.json({ error: "toc 未初始化" }, { status: 404 });
    const toc: Toc = typeof v === "string" ? JSON.parse(v) : v;
    return Response.json(toc, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    return Response.json({ error: true }, { status: 500 });
  }
}
