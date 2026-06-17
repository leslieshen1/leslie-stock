import { promises as fs } from "fs";
import path from "path";
import { redis } from "@/lib/stats";
import { fetchWithTimeout } from "@/lib/api-guard";

// 板块热力 · 盘前/盘中/盘后三段。顶层=清洗后的大板块(~12,按 GICS sector 合并),
// 「科技」可展开看子主题(AI算力/存储/光模块/半导体/软件/互联网/硬件 —— 数据层 dedup_market_cap.py 打的 sub)。
// 跟页面实时数据走:当前段实时(随访问刷)、过去段定格、未到段空。顶层与子主题共用一套 Upstash 单 key 定格。
export const dynamic = "force-dynamic";

const KEY = "sg:sect:cur";
const FIELD: Record<string, "pre" | "mid" | "post"> = { 盘前: "pre", 盘中: "mid", 盘后: "post" };
const EXPAND = "科技"; // 唯一可展开的大板块

// GICS sector → 大板块中文(合并 通信+媒体、杂项+空白)
const SECT_ZH: Record<string, string> = {
  Technology: "科技", Industrials: "工业", "Consumer Discretionary": "可选消费",
  Finance: "金融", "Financial Services": "金融", "Health Care": "医疗", Healthcare: "医疗",
  "Consumer Staples": "必需消费", Utilities: "公用事业", Energy: "能源",
  Telecommunications: "通信媒体", "Communication Services": "通信媒体",
  "Real Estate": "地产", "Basic Materials": "材料", Materials: "材料", Miscellaneous: "其他",
};
const segZH = (sector: unknown): string => SECT_ZH[String(sector)] || "其他";

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
  if (m >= 240 && m < 570) return "盘前";
  if (m >= 570 && m < 960) return "盘中";
  if (m >= 960 && m < 1200) return "盘后";
  return "休市";
}

// ---- 模块级缓存 ----
let SECT_MAP: Record<string, string> | null = null; // sym → 大板块
let SUB_MAP: Record<string, string> | null = null;   // sym → 子主题(仅科技)
let SECT_CAP: Record<string, number> | null = null;   // 大板块 → 市值
let SUB_CAP: Record<string, number> | null = null;    // 子主题 → 市值
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
  const sm: Record<string, string> = {}, sub: Record<string, string> = {};
  const cap: Record<string, number> = {}, subCap: Record<string, number> = {};
  for (const s of all) {
    if (s.country !== "United States" || !s.sector || s.capDup) continue;
    const seg = segZH(s.sector);
    const sym = String(s.sym);
    sm[sym] = seg;
    const m = Number(s.mcapB);
    if (m > 0) cap[seg] = (cap[seg] || 0) + m;
    if (seg === EXPAND && s.sub) {
      sub[sym] = String(s.sub);
      if (m > 0) subCap[String(s.sub)] = (subCap[String(s.sub)] || 0) + m;
    }
  }
  SECT_MAP = sm; SUB_MAP = sub; SECT_CAP = cap; SUB_CAP = subCap;
}

// 当前段实时:大板块 + 子主题各自市值加权涨跌(同一份 /api/market 行情)。返回扁平 {key:pct}。
async function computeLive(origin: string): Promise<Sect | null> {
  const mkt = await fetchWithTimeout(`${origin}/api/market`, {}, 12000).then((x) => x.json()).catch(() => null);
  const quotes: Record<string, { pct: number | null; mcapB: number | null }> = mkt?.quotes || {};
  if (!Object.keys(quotes).length || !SECT_MAP) return null;
  const agg: Record<string, { cap: number; capPct: number }> = {};
  const add = (key: string, m: number, pct: number) => {
    const a = (agg[key] ||= { cap: 0, capPct: 0 });
    a.cap += m; a.capPct += m * pct;
  };
  for (const [sym, q] of Object.entries(quotes)) {
    const seg = SECT_MAP[sym];
    if (!seg || q.pct == null || !(Number(q.mcapB) > 0)) continue;
    add(seg, Number(q.mcapB), Number(q.pct));
    const sub = SUB_MAP?.[sym];
    if (sub) add(sub, Number(q.mcapB), Number(q.pct));
  }
  const out: Sect = {};
  for (const [k, a] of Object.entries(agg)) if (a.cap) out[k] = Math.round((a.capPct / a.cap) * 100) / 100;
  return Object.keys(out).length ? out : null;
}

async function syncOnce(origin: string) {
  const session = etSession();
  const live = session !== "休市" ? await computeLive(origin) : null;
  LIVE = { session, sect: live };
  const r = redis();
  if (!r) { HASH = { day: null, pre: null, mid: null, post: null }; return; }
  const today = etDate();
  let raw = ((await r.hgetall(KEY)) || {}) as Record<string, unknown>;
  if (session !== "休市" && raw.day !== today) { await r.del(KEY); raw = {}; }
  if (live && Object.keys(live).length) {
    await r.hset(KEY, { day: today, [FIELD[session]]: live });
    await r.expire(KEY, 60 * 60 * 24 * 3);
    raw.day = today; raw[FIELD[session]] = live;
  }
  const obj = (v: unknown): Sect | null => (v && typeof v === "object" ? (v as Sect) : null);
  HASH = { day: (raw.day as string) || null, pre: obj(raw.pre), mid: obj(raw.mid), post: obj(raw.post) };
}

export async function GET(req: Request) {
  try {
    await loadStatic();
    const now = Date.now();
    if (now - LAST_SYNC > 50_000) { await syncOnce(new URL(req.url).origin); LAST_SYNC = now; }

    const session = LIVE.session || etSession();
    const today = etDate();
    const realSession = session !== "休市";
    const frozenOK = realSession ? HASH.day === today : true;
    const live = LIVE.sect;
    // 某个 key(板块或子主题)的三段值:当前段用实时,过去段用定格,未到段 null
    const cell = (key: string, sess: "pre" | "mid" | "post", label: string) =>
      session === label ? live?.[key] ?? null : (frozenOK ? HASH[sess]?.[key] ?? null : null);
    const triple = (key: string) => ({
      pre: cell(key, "pre", "盘前"), mid: cell(key, "mid", "盘中"), post: cell(key, "post", "盘后"),
    });

    const cap = SECT_CAP || {}, subCap = SUB_CAP || {};
    const subs = Object.keys(subCap).sort((a, b) => subCap[b] - subCap[a])
      .map((sub) => ({ sector: sub, capB: Math.round(subCap[sub]), ...triple(sub) }));
    const sectors = Object.keys(cap).sort((a, b) => cap[b] - cap[a]).map((seg) => ({
      sector: seg, capB: Math.round(cap[seg]), ...triple(seg),
      ...(seg === EXPAND && subs.length ? { subs } : {}),
    }));

    return Response.json(
      { sectors, session, day: realSession ? today : HASH.day || today, isToday: realSession || HASH.day === today },
      { headers: { "cache-control": "s-maxage=45, stale-while-revalidate=120" } },
    );
  } catch {
    return Response.json({ sectors: [], session: "", day: "" });
  }
}
