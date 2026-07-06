// 笔记运营后台(私密:Bearer STATS_TOKEN,同 /stats 口令):
// putToc 同步目录 | putArt 同步单篇 | genCodes 生成一批兑换码(导给小红书自动发货) | stats 概览
import { redis } from "@/lib/stats";
import { statsAuthed as authed } from "@/lib/api-guard";
import { NK, genCode, type Toc, type CodeRec } from "@/lib/notes";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!authed(req)) return new Response("unauthorized", { status: 401 });
  const r = redis();
  if (!r) return Response.json({ connected: false }, { status: 503 });

  let body: { action?: string; toc?: Toc; id?: string; md?: string; free?: boolean; n?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  try {
    if (body.action === "putToc" && body.toc) {
      const toc = { ...body.toc, updatedAt: Date.now() };
      await r.set(NK.toc, JSON.stringify(toc));
      const count = toc.sections.reduce((a, s) => a + s.items.length, 0);
      return Response.json({ ok: true, sections: toc.sections.length, items: count });
    }

    if (body.action === "putArt" && body.id && typeof body.md === "string") {
      if (!/^[a-z0-9\-]{1,40}$/.test(body.id)) return Response.json({ error: "bad id" }, { status: 400 });
      await r.set(NK.art(body.id), JSON.stringify({ md: body.md.slice(0, 60_000), free: !!body.free }));
      return Response.json({ ok: true, id: body.id, len: body.md.length, free: !!body.free });
    }

    if (body.action === "genCodes") {
      const n = Math.min(Math.max(body.n || 10, 1), 200);
      const codes: string[] = [];
      for (let i = 0; i < n; i++) {
        const c = genCode();
        const rec: CodeRec = { createdAt: Date.now(), devices: [] };
        await r.set(NK.code(c), JSON.stringify(rec));
        codes.push(c);
      }
      return Response.json({ ok: true, codes });
    }

    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch {
    return Response.json({ error: true }, { status: 500 });
  }
}
