import { promises as fs } from "fs";
import path from "path";
import { redis } from "@/lib/stats";
import { fetchWithTimeout } from "@/lib/api-guard";

// 板块热力 · 盘前/盘中/盘后三段。顶层=清洗后的大板块(~12,按 GICS sector 合并),
// 「科技」可展开看子主题(AI算力/存储/光模块/半导体/软件/互联网/硬件 —— 数据层 dedup_market_cap.py 打的 sub)。
// 跟页面实时数据走:当前段实时(随访问刷)、过去段定格、未到段空。顶层与子主题共用一套 Upstash 单 key 定格。
// 不 force-dynamic(它让边缘不缓存)。读 req(origin)本就动态;用 Vercel-CDN-Cache-Control 让边缘缓存 45s,函数少打。

const KEY = "sg:sect:cur";

// GICS sector → 大板块中文(合并 通信+媒体、杂项+空白)
const SECT_ZH: Record<string, string> = {
  Technology: "科技", Industrials: "工业", "Consumer Discretionary": "可选消费",
  Finance: "金融", "Financial Services": "金融", "Health Care": "医疗", Healthcare: "医疗",
  "Consumer Staples": "必需消费", Utilities: "公用事业", Energy: "能源",
  Telecommunications: "通信媒体", "Communication Services": "通信媒体",
  "Real Estate": "地产", "Basic Materials": "材料", Materials: "材料", Miscellaneous: "其他",
};
const segZH = (sector: unknown): string => SECT_ZH[String(sector)] || "其他";

// A 股申万 34 行业 → 美股同款 12 大板块(静态映射,免 AI)。让 A 股板块能和美股并排比。
const SW_TO_SEG: Record<string, string> = {
  计算机软件: "科技", 电子元件: "科技", 半导体: "科技", 消费电子: "科技",
  机械设备: "工业", 电力设备: "工业", 建筑建材: "工业", 交通运输: "工业", 国防军工: "工业", 光伏风电储能: "工业",
  基础化工: "材料", 新材料: "材料", 有色金属: "材料", 钢铁: "材料",
  汽车零部件: "可选消费", 汽车整车: "可选消费", 轻工纺服: "可选消费", 商贸零售: "可选消费", 家用电器: "可选消费",
  食品饮料: "必需消费", 农林牧渔: "必需消费",
  创新药生物药: "医疗", 医疗器械: "医疗", 中药医药商业: "医疗",
  银行: "金融", 证券保险: "金融",
  石油石化: "能源", 煤炭: "能源",
  传媒互联网: "通信媒体", 通信: "通信媒体",
  电力公用事业: "公用事业", 环保: "公用事业",
  房地产: "地产",
  综合: "其他",
};

let A_IND: Record<string, string> | null = null; // A 股 code → 申万行业
async function loadAInd(): Promise<Record<string, string>> {
  if (A_IND) return A_IND;
  try {
    const p = path.join(process.cwd(), "public", "data", "a-industry.json");
    A_IND = JSON.parse(await fs.readFile(p, "utf-8"));
  } catch {
    A_IND = {};
  }
  return A_IND!;
}

type ASub = { sector: string; capB: number; pct: number; d7?: number | null; d30?: number | null };
type ASect = { sector: string; capB: number; pct: number; d7?: number | null; d30?: number | null; subs?: ASub[] };
let A_SECTORS: ASect[] = []; // A 股 12 大板块当前聚合(随 syncOnce 刷新缓存)
let A_SYM_CAP: Record<string, number> = {}; // A 股 code → 市值(¥亿,最新;给窗口收益加权)
let A_HIST: { dates: string[]; closes: Record<string, Record<string, number>> } | null = null;
let A_WIN: { d7: Record<string, number>; d30: Record<string, number> } = { d7: {}, d30: {} }; // A 股板块/子行业 近7日·近1月

// A 股板块聚合:/api/a-market 实时(市值 mcapYi ¥亿 + 涨跌)→ 申万→大板块,市值加权涨跌;
// 同时按申万子行业聚出 subs(让大板块可展开,如 科技→计算机软件/半导体/消费电子)。
async function computeAShare(origin: string): Promise<ASect[]> {
  const ind = await loadAInd();
  const am = await fetchWithTimeout(`${origin}/api/a-market`, {}, 12000).then((x) => x.json()).catch(() => null);
  const quotes: Record<string, { pct: number | null; mcapYi: number | null }> = am?.quotes || {};
  if (!Object.keys(quotes).length) return A_SECTORS; // 抓不到就沿用上次,别清空
  const seg: Record<string, { cap: number; capPct: number }> = {};       // 大板块
  const sub: Record<string, { cap: number; capPct: number }> = {};       // "大板块|申万子行业"(前缀防串台)
  const aSymCap: Record<string, number> = {};
  for (const [code, q] of Object.entries(quotes)) {
    const sw = ind[code];
    const s = SW_TO_SEG[sw] || "其他";
    const cap = Number(q.mcapYi);
    if (!(cap > 0) || q.pct == null) continue;
    aSymCap[code] = cap;
    const pct = Number(q.pct);
    (seg[s] ||= { cap: 0, capPct: 0 }); seg[s].cap += cap; seg[s].capPct += cap * pct;
    if (sw) { const k = `${s}|${sw}`; (sub[k] ||= { cap: 0, capPct: 0 }); sub[k].cap += cap; sub[k].capPct += cap * pct; }
  }
  A_SYM_CAP = aSymCap;
  const wPct = (a: { cap: number; capPct: number }) => Math.round((a.capPct / a.cap) * 100) / 100;
  const subsBySeg: Record<string, ASub[]> = {};
  for (const [k, a] of Object.entries(sub)) {
    const [s, sw] = k.split("|");
    (subsBySeg[s] ||= []).push({ sector: sw, capB: Math.round(a.cap), pct: wPct(a) });
  }
  return Object.entries(seg)
    .map(([sector, a]) => {
      const subs = (subsBySeg[sector] || []).sort((x, y) => y.capB - x.capB);
      return { sector, capB: Math.round(a.cap), pct: wPct(a), ...(subs.length > 1 ? { subs } : {}) };
    })
    .sort((x, y) => y.capB - x.capB);
}

// A 股价格历史(每日收盘累积,见 scripts/cloud_a_history_refresh.py)
async function loadAHist() {
  if (A_HIST) return A_HIST;
  try {
    const p = path.join(process.cwd(), "public", "data", "a-price-history-30d.json");
    A_HIST = JSON.parse(await fs.readFile(p, "utf-8"));
  } catch { A_HIST = { dates: [], closes: {} }; }
  return A_HIST!;
}

// A 股板块 + 申万子行业过去 N 个交易日的市值加权收益(用最新 A_SYM_CAP 加权)。返回扁平 {key:pct}。
// 历史攒够前 closes 很少 → 多数票 <2 根被跳过 → 返回空,组件显示 —。
async function computeAWindow(daysBack: number): Promise<Record<string, number>> {
  const h = await loadAHist();
  const out: Record<string, number> = {};
  if (!h.closes) return out;
  const ind = await loadAInd();
  const agg: Record<string, { cap: number; capRet: number }> = {};
  const add = (key: string, m: number, ret: number) => { const a = (agg[key] ||= { cap: 0, capRet: 0 }); a.cap += m; a.capRet += m * ret; };
  for (const [code, dc] of Object.entries(h.closes)) {
    const sw = ind[code]; const s = SW_TO_SEG[sw] || "其他"; const m = A_SYM_CAP[code];
    if (!(m > 0) || !dc) continue;
    const ds = Object.keys(dc).sort();
    if (ds.length < 2) continue;
    const last = dc[ds[ds.length - 1]], ago = dc[ds[Math.max(0, ds.length - 1 - daysBack)]];
    if (!(last > 0) || !(ago > 0)) continue;
    const ret = (last / ago - 1) * 100;
    add(s, m, ret); if (sw) add(`${s}|${sw}`, m, ret);
  }
  for (const [k, a] of Object.entries(agg)) if (a.cap) out[k] = Math.round((a.capRet / a.cap) * 100) / 100;
  return out;
}

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
let SUB_CAP: Record<string, number> | null = null;    // "大板块|子板块" → 市值(key 带前缀防串台)
let SYM_CAP: Record<string, number> | null = null;    // sym → 市值($B,用于 7日/30日窗口加权)
let PRICE_HIST: { dates: string[]; closes: Record<string, Record<string, number>> } | null = null;
let US_WIN: { d7: Sect; d30: Sect } = { d7: {}, d30: {} }; // 美股板块/子主题 近7日·近1月 市值加权收益
let LAST_SYNC = 0;
let HASH: { day: string | null; pre: Sect | null; mid: Sect | null; post: Sect | null } = {
  day: null, pre: null, mid: null, post: null,
};
let LIVE: { session: string; sect: Sect | null; post: Sect | null } = { session: "", sect: null, post: null };
type Sect = Record<string, number>;

async function loadStatic() {
  if (SECT_MAP && SECT_CAP) return;
  const p = path.join(process.cwd(), "public", "data", "us-stocks.json");
  const all: Record<string, unknown>[] = JSON.parse(await fs.readFile(p, "utf-8")).stocks || [];
  const sm: Record<string, string> = {}, sub: Record<string, string> = {};
  const cap: Record<string, number> = {}, subCap: Record<string, number> = {}, symCap: Record<string, number> = {};
  for (const s of all) {
    // 所有美股上市票都进板块(不限注册地 —— 海外注册的希捷/埃森哲等也算)
    if (!s.sector || s.capDup) continue;
    const seg = String(s.seg || segZH(s.sector)); // seg=AI 判的大板块(dedup 烤入),回退英文映射
    const sym = String(s.sym);
    sm[sym] = seg;
    const m = Number(s.mcapB);
    if (m > 0) { cap[seg] = (cap[seg] || 0) + m; symCap[sym] = m; }
    if (s.sub) {
      const k = `${seg}|${s.sub}`; // 前缀大板块,防同名子板块跨板块串台
      sub[sym] = k;
      if (m > 0) subCap[k] = (subCap[k] || 0) + m;
    }
  }
  SECT_MAP = sm; SUB_MAP = sub; SECT_CAP = cap; SUB_CAP = subCap; SYM_CAP = symCap;
}

// 价格历史(30 交易日收盘)— 用于美股板块/子主题的 7日/30日窗口收益。
async function loadPriceHist() {
  if (PRICE_HIST) return PRICE_HIST;
  try {
    const p = path.join(process.cwd(), "public", "data", "price-history-30d.json");
    PRICE_HIST = JSON.parse(await fs.readFile(p, "utf-8"));
  } catch { PRICE_HIST = { dates: [], closes: {} }; }
  return PRICE_HIST!;
}

// 美股板块 + 子主题在过去 N 个交易日的市值加权收益(latest/前N根 - 1)。返回扁平 {key:pct}。
async function computeUsWindow(daysBack: number): Promise<Sect> {
  const ph = await loadPriceHist();
  if (!SECT_MAP || !SYM_CAP || !ph.closes) return {};
  const agg: Record<string, { cap: number; capRet: number }> = {};
  const add = (key: string, m: number, ret: number) => {
    const a = (agg[key] ||= { cap: 0, capRet: 0 }); a.cap += m; a.capRet += m * ret;
  };
  for (const [sym, dc] of Object.entries(ph.closes)) {
    const seg = SECT_MAP[sym]; const m = SYM_CAP[sym];
    if (!seg || !(m > 0) || !dc) continue;
    const ds = Object.keys(dc).sort();
    if (ds.length < 2) continue;
    const last = dc[ds[ds.length - 1]];
    const ago = dc[ds[Math.max(0, ds.length - 1 - daysBack)]]; // N 交易日前;不足则用最早一根
    if (!(last > 0) || !(ago > 0)) continue;
    const ret = (last / ago - 1) * 100;
    add(seg, m, ret);
    const sub = SUB_MAP?.[sym];
    if (sub) add(sub, m, ret);
  }
  const out: Sect = {};
  for (const [k, a] of Object.entries(agg)) if (a.cap) out[k] = Math.round((a.capRet / a.cap) * 100) / 100;
  return out;
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
    // 离群过滤:单只 |涨跌|>35% 几乎都是脏数据(拆股/when-issued/错价,如 SNDK),会把板块市值加权拖偏 → 跳过
    if (!seg || q.pct == null || !(Number(q.mcapB) > 0) || Math.abs(Number(q.pct)) > 35) continue;
    add(seg, Number(q.mcapB), Number(q.pct));
    const sub = SUB_MAP?.[sym];
    if (sub) add(sub, Number(q.mcapB), Number(q.pct));
  }
  const out: Sect = {};
  for (const [k, a] of Object.entries(agg)) if (a.cap) out[k] = Math.round((a.capPct / a.cap) * 100) / 100;
  return Object.keys(out).length ? out : null;
}

// 盘后列:全市场逐只用 /api/market 的 postPct(来自腾讯 [9]盘后价/收盘-1)市值加权聚合 —— 口径同盘中、子板块全覆盖,撤掉龙头近似。
async function computePost(origin: string): Promise<Sect | null> {
  const mkt = await fetchWithTimeout(`${origin}/api/market`, {}, 12000).then((x) => x.json()).catch(() => null);
  const quotes: Record<string, { postPct?: number | null; mcapB?: number | null }> = mkt?.quotes || {};
  if (!Object.keys(quotes).length || !SECT_MAP) return null;
  const agg: Record<string, { cap: number; capPct: number }> = {};
  const add = (key: string, m: number, pct: number) => { const a = (agg[key] ||= { cap: 0, capPct: 0 }); a.cap += m; a.capPct += m * pct; };
  for (const [sym, q] of Object.entries(quotes)) {
    const seg = SECT_MAP[sym]; const pp = q.postPct;
    if (!seg || pp == null || !(Number(q.mcapB) > 0) || Math.abs(Number(pp)) > 35) continue;
    add(seg, Number(q.mcapB), Number(pp));
    const sub = SUB_MAP?.[sym]; if (sub) add(sub, Number(q.mcapB), Number(pp));
  }
  const out: Sect = {};
  for (const [k, a] of Object.entries(agg)) if (a.cap) out[k] = Math.round((a.capPct / a.cap) * 100) / 100;
  return Object.keys(out).length ? out : null;
}

// 盘前:screener 无延伸时段行情 → 取各大板块「市值龙头」(top-N)的真盘前价
// (走 /api/quote 的 Nasdaq /info 端点,primaryData=盘前价,与盘前报告/个股详情页同源),市值加权近似板块盘前/盘后涨跌。
// 龙头主导市值加权,top-N 足以代表板块走向;只 ~12 板块×N 只、分批查,Nasdaq /info 不限流。盘中仍用全市场 screener。
let PREPOST_SYMS: string[] | null = null;
function topSymsPerSector(n: number): string[] {
  if (PREPOST_SYMS) return PREPOST_SYMS;
  if (!SECT_MAP || !SYM_CAP) return [];
  const bySeg: Record<string, [string, number][]> = {};
  for (const [sym, seg] of Object.entries(SECT_MAP)) {
    const m = SYM_CAP[sym] || 0;
    if (m > 0) (bySeg[seg] ||= []).push([sym, m]);
  }
  const out = new Set<string>();
  for (const arr of Object.values(bySeg)) {
    arr.sort((a, b) => b[1] - a[1]);
    for (const [sym] of arr.slice(0, n)) out.add(sym);
  }
  PREPOST_SYMS = [...out];
  return PREPOST_SYMS;
}

async function computeLivePrePost(origin: string): Promise<Sect | null> {
  const syms = topSymsPerSector(8);
  if (!syms.length || !SECT_MAP || !SYM_CAP) return null;
  const quotes: Record<string, { pct: number | null }> = {};
  for (let i = 0; i < syms.length; i += 25) {
    const batch = syms.slice(i, i + 25).join(",");
    const j = await fetchWithTimeout(`${origin}/api/quote?syms=${encodeURIComponent(batch)}`, {}, 12000)
      .then((x) => x.json()).catch(() => null);
    if (j?.quotes) Object.assign(quotes, j.quotes);
  }
  const agg: Record<string, { cap: number; capPct: number }> = {};
  const add = (key: string, m: number, pct: number) => { const a = (agg[key] ||= { cap: 0, capPct: 0 }); a.cap += m; a.capPct += m * pct; };
  for (const sym of syms) {
    const q = quotes[sym.toUpperCase()];
    const seg = SECT_MAP[sym]; const m = SYM_CAP[sym] || 0;
    if (!seg || !q || q.pct == null || !(m > 0) || Math.abs(Number(q.pct)) > 35) continue;  // 离群脏价跳过
    add(seg, m, Number(q.pct));
    const sub = SUB_MAP?.[sym]; if (sub) add(sub, m, Number(q.pct));
  }
  const out: Sect = {};
  for (const [k, a] of Object.entries(agg)) if (a.cap) out[k] = Math.round((a.capPct / a.cap) * 100) / 100;
  return Object.keys(out).length ? out : null;
}

async function syncOnce(origin: string) {
  const session = etSession();
  // 板块/子板块【全市场逐只 + 我们自己的分类】聚合,休市也算(不靠会冻脏的快照,用最近交易日收盘)。
  // 不按市值封顶:SPCX($2万亿)这种超大票照实主导板块(Leslie 定的口径),航空国防 -9% 就是 SpaceX 真跌 16% 拖的。
  // live 填 pre 或 mid 列:盘前=各板块龙头 top-8 真盘前价(/info);盘中/盘后/休市=computeLive 全市场常规(腾讯实时/收盘)。
  const live = (session === "盘前") ? await computeLivePrePost(origin)
    : (session === "盘中" || session === "盘后" || session === "休市") ? await computeLive(origin)
    : null;
  // 盘后列:盘后/休市=computePost 全市场逐只 postPct(腾讯盘后价)聚合,子板块全覆盖;盘前/盘中盘后未发生 → null。
  const livePost = (session === "盘后" || session === "休市") ? await computePost(origin) : null;
  LIVE = { session, sect: live, post: livePost };
  A_SECTORS = await computeAShare(origin); // A 股按自己交易时段实时(与美股 session 无关)
  US_WIN = { d7: await computeUsWindow(5), d30: await computeUsWindow(21) }; // 近7日≈5交易日 · 近1月≈21交易日
  A_WIN = { d7: await computeAWindow(5), d30: await computeAWindow(21) };    // A 股窗口(攒够历史前多为空 → 组件显示 —)
  const r = redis();
  if (!r) { HASH = { day: null, pre: null, mid: null, post: null }; return; }
  const today = etDate();
  let raw = ((await r.hgetall(KEY)) || {}) as Record<string, unknown>;
  if (session !== "休市" && raw.day !== today) { await r.del(KEY); raw = {}; }
  if (live && Object.keys(live).length && session === "盘前") {   // 只定格盘前(供盘中/盘后/休市的 pre 列);mid=computeLive、post=computePost 全程实时,不靠定格
    await r.hset(KEY, { day: today, pre: live });
    await r.expire(KEY, 60 * 60 * 24 * 3);
    raw.day = today; raw.pre = live;
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
    const livePost = LIVE.post;
    // 三列同一套口径(全市场逐只 · 我们的分类):
    //  盘前 = live(盘前时=各板块龙头真盘前价实时;其余时段=盘前抓的定格);
    //  盘中 = live(computeLive 常规全量;盘中/盘后/休市实时,盘前时未发生=null);
    //  盘后 = livePost(computePost 全量逐只 postPct;盘后/休市才有,盘前/盘中未发生=null)。
    const cell = (key: string, sess: "pre" | "mid" | "post"): number | null => {
      if (sess === "post") return (session === "盘后" || session === "休市") ? livePost?.[key] ?? null : null;
      if (sess === "pre") return session === "盘前" ? live?.[key] ?? null : (frozenOK ? HASH.pre?.[key] ?? null : null);
      return (session === "盘中" || session === "盘后" || session === "休市") ? live?.[key] ?? null : null;
    };
    const triple = (key: string) => ({ pre: cell(key, "pre"), mid: cell(key, "mid"), post: cell(key, "post") });

    const cap = SECT_CAP || {}, subCap = SUB_CAP || {};
    const subsSorted = Object.keys(subCap).sort((a, b) => subCap[b] - subCap[a]);
    const sectors = Object.keys(cap).sort((a, b) => cap[b] - cap[a]).map((seg) => {
      const pfx = `${seg}|`;
      const segSubs = subsSorted.filter((k) => k.startsWith(pfx))
        .map((k) => ({ sector: k.slice(pfx.length), capB: Math.round(subCap[k]), ...triple(k), d7: US_WIN.d7[k] ?? null, d30: US_WIN.d30[k] ?? null }));
      return {
        sector: seg, capB: Math.round(cap[seg]), ...triple(seg),
        d7: US_WIN.d7[seg] ?? null, d30: US_WIN.d30[seg] ?? null,
        ...(segSubs.length > 1 ? { subs: segSubs } : {}),
      };
    });

    const aSectors = A_SECTORS.map((s) => ({
      ...s, d7: A_WIN.d7[s.sector] ?? null, d30: A_WIN.d30[s.sector] ?? null,
      ...(s.subs ? { subs: s.subs.map((sub) => ({ ...sub, d7: A_WIN.d7[`${s.sector}|${sub.sector}`] ?? null, d30: A_WIN.d30[`${s.sector}|${sub.sector}`] ?? null })) } : {}),
    }));
    return Response.json(
      { sectors, aSectors, session, day: realSession ? today : HASH.day || today, isToday: realSession || HASH.day === today },
      { headers: {
        "cache-control": "public, max-age=0, must-revalidate",
        "Vercel-CDN-Cache-Control": "max-age=45, stale-while-revalidate=120",
      } },
    );
  } catch {
    return Response.json({ sectors: [], aSectors: [], session: "", day: "" });
  }
}
