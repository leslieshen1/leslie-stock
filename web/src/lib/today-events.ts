// 今日大事(盘报 tab 第二段)—— 服务端直连 Finnhub,30 分钟缓存,无需定时任务/部署。
// 口径:宏观降噪(MBA/EIA 系折叠、low 过滤带白名单、中文名映射、🔴=high)+
//       财报盘前/盘后分组(us-stocks 补名称/市值,≥$0.5B 上正文,小盘归一行)+ 自动主角。
import "server-only";
import { promises as fs } from "fs";
import path from "path";

export type MacroEvent = { t: string; hi: boolean; name: string; est: string; prev: string };
export type EarnRow = { sym: string; name: string; mcapB: number | null; eps: number | null };
export type TodayEvents = {
  date: string;          // YYYY-MM-DD(ET)
  weekday: string;       // 周三
  macro: MacroEvent[];
  bmo: EarnRow[];
  amc: EarnRow[];
  smallBmo: string[];
  smallAmc: string[];
  lead: string;          // "CPI 08:30 · $ORCL 盘后"
};

const ZH: [RegExp, string][] = [
  [/Core Inflation Rate MoM/i, "核心CPI 环比"],
  [/Core Inflation Rate YoY/i, "核心CPI 同比"],
  [/Inflation Rate MoM/i, "CPI 环比"],
  [/Inflation Rate YoY/i, "CPI 同比"],
  [/Core PPI|PPI MoM|Producer Price.*MoM/i, "PPI 环比"],
  [/PPI YoY|Producer Price.*YoY/i, "PPI 同比"],
  [/Core PCE.*MoM/i, "核心PCE 环比"],
  [/Fed Interest Rate Decision|FOMC/i, "美联储利率决议"],
  [/Non.?Farm Payrolls/i, "非农就业"],
  [/Unemployment Rate/i, "失业率"],
  [/Initial Jobless Claims/i, "首申失业金"],
  [/Retail Sales MoM/i, "零售销售 环比"],
  [/GDP Growth Rate/i, "GDP"],
  [/Michigan Consumer Sentiment/i, "密歇根消费者信心"],
  [/ISM Manufacturing/i, "ISM 制造业"],
  [/ISM Services/i, "ISM 服务业"],
  [/MBA Mortgage Applications/i, "MBA 按揭申请"],
  [/EIA Crude Oil Stocks Change/i, "EIA 原油库存"],
  [/Monthly Budget Statement/i, "月度财政收支"],
];
const LOW_KEEP = /MBA Mortgage Applications|10-Year Note Auction|30-Year Bond Auction/i;
const MED_DROP = /MBA (30-Year|Mortgage Market|Mortgage Refinance|Purchase)|EIA (?!Crude Oil Stocks Change)|CPI s\.a|^CPI$/i;

function zhName(en: string): string {
  for (const [re, zh] of ZH) if (re.test(en)) return zh;
  const auction = en.match(/(\d+)-Year (?:Note|Bond) Auction/i);
  if (auction) return `${auction[1]}年期国债拍卖`;
  return en;
}

function fnum(x: unknown): string {
  if (x === null || x === undefined || x === "") return "";
  const v = Number(x);
  return Number.isFinite(v) ? `${v}` : String(x);
}

// 美东今天(YYYY-MM-DD + 周几)
function todayET(): { date: string; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const wd = { Mon: "周一", Tue: "周二", Wed: "周三", Thu: "周四", Fri: "周五", Sat: "周六", Sun: "周日" }[get("weekday")] || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, weekday: wd };
}

function etTimeOf(utc: string): { date: string; hm: string } | null {
  // Finnhub time = "YYYY-MM-DD HH:MM:SS"(UTC)
  const m = utc.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  let hh = get("hour"); if (hh === "24") hh = "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hm: `${hh}:${get("minute")}` };
}

async function usNames(): Promise<Record<string, { name: string; mcapB: number | null }>> {
  try {
    const p = path.join(process.cwd(), "public", "data", "us-stocks.json");
    const j = JSON.parse(await fs.readFile(p, "utf-8"));
    const out: Record<string, { name: string; mcapB: number | null }> = {};
    for (const s of j.stocks || []) out[s.sym] = { name: s.name || "", mcapB: s.mcapB ?? null };
    return out;
  } catch {
    return {};
  }
}

export async function loadTodayEvents(): Promise<TodayEvents | null> {
  const key = process.env.FINNHUB_KEY;
  if (!key) return null;
  const { date, weekday } = todayET();
  try {
    const [ecoR, earR, names] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/calendar/economic?token=${key}`,
            { next: { revalidate: 1800 } }).then((r) => r.json()),
      fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${date}&to=${date}&token=${key}`,
            { next: { revalidate: 1800 } }).then((r) => r.json()),
      usNames(),
    ]);

    // —— 宏观(降噪 + 中文化)——
    const seen = new Set<string>();
    const macro: MacroEvent[] = [];
    for (const e of ecoR.economicCalendar || []) {
      if (e.country !== "US" && e.country !== "United States") continue;
      const t = etTimeOf(String(e.time || ""));
      if (!t || t.date !== date) continue;
      const en = String(e.event || ""), imp = String(e.impact || "");
      if (imp === "low" && !LOW_KEEP.test(en)) continue;
      if (imp === "medium" && MED_DROP.test(en)) continue;
      if (imp === "high" && /CPI s\.a|^CPI$/.test(en)) continue;
      const name = zhName(en);
      const k = `${t.hm}|${name}`;
      if (seen.has(k)) continue;
      seen.add(k);
      macro.push({ t: t.hm, hi: imp === "high", name, est: fnum(e.estimate), prev: fnum(e.prev) });
    }
    macro.sort((a, b) => a.t.localeCompare(b.t) || Number(b.hi) - Number(a.hi));

    // —— 财报(盘前/盘后)——
    const ears: { symbol?: string; hour?: string; epsEstimate?: number }[] = earR.earningsCalendar || [];
    const row = (e: (typeof ears)[number]): EarnRow => {
      const sym = e.symbol || "";
      const n = names[sym];
      return { sym, name: (n?.name || "").slice(0, 28), mcapB: n?.mcapB ?? null,
               eps: typeof e.epsEstimate === "number" ? e.epsEstimate : null };
    };
    const grp = (hours: string[], cap: number) => {
      const g = ears.filter((e) => hours.includes(e.hour || ""))
        .map(row)
        .sort((a, b) => (b.mcapB ?? 0) - (a.mcapB ?? 0));
      const main = g.filter((r) => (r.mcapB ?? 0) >= 0.5).slice(0, cap);
      const small = g.filter((r) => !main.includes(r) && r.sym).map((r) => r.sym).slice(0, 10);
      return { main, small };
    };
    const b = grp(["bmo"], 6);
    const a = grp(["amc", "", "dmh"], 7);

    // —— 主角 ——
    const leadBits: string[] = [];
    const hiM = macro.find((m) => m.hi);
    if (hiM) leadBits.push(`${hiM.name.split(" ")[0]} ${hiM.t}`);
    const star = [...b.main, ...a.main].sort((x, y) => (y.mcapB ?? 0) - (x.mcapB ?? 0))[0];
    if (star && (star.mcapB ?? 0) >= 20) leadBits.push(`$${star.sym} ${b.main.includes(star) ? "盘前" : "盘后"}`);

    return { date, weekday, macro, bmo: b.main, amc: a.main, smallBmo: b.small, smallAmc: a.small,
             lead: leadBits.join(" · ") };
  } catch {
    return null;
  }
}
