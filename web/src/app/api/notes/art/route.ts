// 笔记正文(按篇下发):免费篇公开;付费篇需 Bearer 兑换码 + 已绑定设备,码维度日限频防爬库。
import { redis } from "@/lib/stats";
import { NK, DAILY_READS, normCode, todayStr, type CodeRec } from "@/lib/notes";

export const dynamic = "force-dynamic";

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

    if (!art.free) {
      const code = normCode((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""));
      const device = (req.headers.get("x-nb-device") || "").slice(0, 64);
      if (!code || !device) return Response.json({ error: "locked" }, { status: 401 });
      const cRaw = await r.get<string | CodeRec>(NK.code(code));
      if (cRaw == null) return Response.json({ error: "bad code" }, { status: 401 });
      const rec: CodeRec = typeof cRaw === "string" ? JSON.parse(cRaw) : cRaw;
      if (!rec.devices?.includes(device)) return Response.json({ error: "device" }, { status: 401 });
      const day = todayStr();
      const reads = rec.reads || {};
      if ((reads[day] || 0) >= DAILY_READS) return Response.json({ error: "rate" }, { status: 429 });
      rec.reads = { [day]: (reads[day] || 0) + 1 }; // 只留当天,历史计数无需保存
      await r.set(NK.code(code), JSON.stringify(rec));
    }

    return Response.json({ md: art.md });
  } catch {
    return Response.json({ error: true }, { status: 500 });
  }
}
