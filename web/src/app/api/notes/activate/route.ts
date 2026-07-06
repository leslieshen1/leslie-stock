// 兑换码激活:码 + 设备 ID → 绑定(≤3 台,幂等)。买家输一次码,localStorage 长期有效。
import { redis } from "@/lib/stats";
import { NK, MAX_DEVICES, normCode, type CodeRec } from "@/lib/notes";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const r = redis();
  if (!r) return Response.json({ connected: false }, { status: 503 });

  let body: { code?: string; deviceId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const code = normCode(body.code || "");
  const device = (body.deviceId || "").slice(0, 64);
  if (!/^LSN-[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(code)) return Response.json({ error: "码格式不对(LSN-XXXXX-XXXXX)" }, { status: 400 });
  if (!device) return Response.json({ error: "no device" }, { status: 400 });

  try {
    const raw = await r.get<string | CodeRec>(NK.code(code));
    if (raw == null) return Response.json({ error: "码不存在,请核对后重试" }, { status: 404 });
    const rec: CodeRec = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!rec.devices) rec.devices = [];
    if (!rec.devices.includes(device)) {
      if (rec.devices.length >= MAX_DEVICES)
        return Response.json({ error: `该码已在 ${MAX_DEVICES} 台设备使用,无法继续绑定` }, { status: 403 });
      rec.devices.push(device);
    }
    if (!rec.activatedAt) rec.activatedAt = Date.now();
    await r.set(NK.code(code), JSON.stringify(rec));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: true }, { status: 500 });
  }
}
