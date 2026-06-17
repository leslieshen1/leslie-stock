import { promises as fs } from "fs";
import path from "path";
import { redis } from "@/lib/stats";
import { fetchWithTimeout } from "@/lib/api-guard";

// 板块热力 · 盘前/盘中/盘后三段。跟着页面实时数据走:
//  · 当前所在时段 = 实时值(随访问每分钟刷)
//  · 已经过去的时段 = 定格在它结束前最后一个值(不再变)
//  · 还没到的时段 = 空(—)
// 不靠定时 cron —— 谁打开页面、在哪个时段,就把那段刷成最新;时段一过它自然不再被写、定格了。
// 过去段的值存 Upstash 单 key hash(按交易日重置)。CDN 缓存 s-maxage + 模块级 50s 节流,
// 把"算+写"收敛到约每分钟一次(防访问量大时写爆 Upstash)。
export const dynamic = "force-dynamic";

const KEY = "sg:sect:cur";
const FIELD: Record<string, "pre" | "mid" | "post"> = { 盘前: "pre", 盘中: "mid", 盘后: "post" };

function etNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}
function etDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}
function etSession(): string {
  const et = etNow();
  if (et.getDay() === 0 || et.getDay() === 6) return "休市";
  const m = et.getHours() * 60 + et.getMinutes();
  if (m >= 240 && m < 570) return "盘前"; // 04:00–09:30 ET
  if (m >= 570 && m < 960) return "盘中"; // 09:30–16:00
  if (m >= 960 && m < 1200) return "盘后"; // 16:00–20:00
  return "休市";
}

// ---- 模块级缓存(暖实例内复用,冷启重建)----
let SECT_MAP: Record<string, string> | null = null; // sym → sector
let SECT_CAP: Record<string, number> | null = null; // sector → 市值合计(行高用,静态稳定)
let LAST_SYNC = 0;
let HASH: { day: string | null; pre: Sect | null; mid: Sect | null; post: Sect | null } = {
  day: null, pre: null, mid: null, post: null,
};
let LIVE: { session: string; sect: Sect | null } = { session: "", sect: null };
type Sect = Record<string, number>;

async function loadStatic() {
  if (SECT_MAP && SECT_CAP) return;
  const p = path.join(process.cwd(), "public", "data", "us-stocks.json");
  const all: Record<string, unknown>[] = JSON.parse(await fs.readFile(p, "utf-8")).stocks || [];
  const sm: Record<string, string> = {}, cap: Record<string, number> = {};
  for (const s of all) {
    if (s.country !== "United States" || !s.sector) continue;
    const sec = String(s.sector);
    sm[String(s.sym)] = sec;
    if (Number(s.mcapB) > 0) cap[sec] = (cap[sec] || 0) + Number(s.mcapB);
  }
  SECT_MAP = sm;
  SECT_CAP = cap;
}

// 当前时段的实时板块涨跌(市值加权),数据同页面那条 /api/market
async function computeLive(origin: string): Promise<Sect | null> {
  const mkt = await fetchWithTimeout(`${origin}/api/market`, {}, 12000).then((x) => x.json()).catch(() => null);
  const quotes: Record<string, { pct: number | null; mcapB: number | null }> = mkt?.quotes || {};
  if (!Object.keys(quotes).length || !SECT_MAP) return null;
  const agg: Record<string, { cap: number; capPct: number }> = {};
  for (const [sym, q] of Object.entries(quotes)) {
    const sec = SECT_MAP[sym];
    if (!sec || q.pct == null || !(Number(q.mcapB) > 0)) continue;
    const a = (agg[sec] ||= { cap: 0, capPct: 0 });
    a.cap += Number(q.mcapB);
    a.capPct += Number(q.mcapB) * Number(q.pct);
  }
  const out: Sect = {};
  for (const [sec, a] of Object.entries(agg)) if (a.cap) out[sec] = Math.round((a.capPct / a.cap) * 100) / 100;
  return Object.keys(out).length ? out : null;
}

async function syncOnce(origin: string) {
  const session = etSession();
  const live = session !== "休市" ? await computeLive(origin) : null;
  LIVE = { session, sect: live };

  const r = redis();
  if (!r) {
    HASH = { day: null, pre: null, mid: null, post: null }; // 没接 Upstash → 只能给当前段实时,过去段无从定格
    return;
  }
  const today = etDate();
  let raw = ((await r.hgetall(KEY)) || {}) as Record<string, unknown>;
  // 新交易日的第一段写入 → 清掉上一交易日的三段(否则旧 mid/post 会串进今天盘前)
  if (session !== "休市" && raw.day !== today) {
    await r.del(KEY);
    raw = {};
  }
  if (live && Object.keys(live).length) {
    await r.hset(KEY, { day: today, [FIELD[session]]: live });
    await r.expire(KEY, 60 * 60 * 24 * 3);
    raw.day = today;
    raw[FIELD[session]] = live;
  }
  const obj = (v: unknown): Sect | null => (v && typeof v === "object" ? (v as Sect) : null);
  HASH = { day: (raw.day as string) || null, pre: obj(raw.pre), mid: obj(raw.mid), post: obj(raw.post) };
}

export async function GET(req: Request) {
  try {
    await loadStatic();
    const now = Date.now();
    if (now - LAST_SYNC > 50_000) {
      await syncOnce(new URL(req.url).origin);
      LAST_SYNC = now;
    }
    const session = LIVE.session || etSession();
    const today = etDate();
    const realSession = session !== "休市";
    const hashToday = HASH.day === today;
    // 盘中/盘后:只认今天的定格;休市:看上一交易日(HASH 自身那天)的三段
    const frozenOK = realSession ? hashToday : true;
    const live = LIVE.sect;
    const cap = SECT_CAP || {};

    const sectors = Object.keys(cap)
      .sort((a, b) => cap[b] - cap[a])
      .map((sector) => {
        const fz = (f: "pre" | "mid" | "post") => (frozenOK ? HASH[f]?.[sector] ?? null : null);
        return {
          sector,
          capB: Math.round(cap[sector]),
          pre: session === "盘前" ? live?.[sector] ?? null : fz("pre"),
          mid: session === "盘中" ? live?.[sector] ?? null : fz("mid"),
          post: session === "盘后" ? live?.[sector] ?? null : fz("post"),
        };
      });

    return Response.json(
      { sectors, session, day: realSession ? today : HASH.day || today, isToday: realSession || hashToday },
      { headers: { "cache-control": "s-maxage=45, stale-while-revalidate=120" } },
    );
  } catch {
    return Response.json({ sectors: [], session: "", day: "" });
  }
}
