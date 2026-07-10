// 笔记正文(按篇下发):全库免费公开(2026-07 起),边缘缓存扛读量;写入仍走 admin(STATS_TOKEN)。
import { redis } from "@/lib/stats";
import { NK } from "@/lib/notes";

type Art = { md: string; free?: boolean };

export async function GET(req: Request) {
  const r = redis();
  if (!r) return Response.json({ connected: false }, { status: 503 });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^[a-z0-9\-]{1,40}$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });

  try {
    const raw = await r.get<string | Art>(NK.art(id));
    if (raw == null) return Response.json({ error: "not found" }, { status: 404 });
    const art: Art = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Response.json(
      { md: art.md },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600", "Vercel-CDN-Cache-Control": "public, s-maxage=300" } },
    );
  } catch {
    return Response.json({ error: true }, { status: 500 });
  }
}
