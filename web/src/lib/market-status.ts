// 盘口状态 —— 按交易所所在时区算(美股美东 / A股深沪北京 / 港股香港),自动处理周末 +
// 全天休市假日,不依赖任何接口。A股节假日依官方公告维护(每年更新一次)。
export type MktState = "pre" | "open" | "post" | "closed";
export type Market = "us" | "a" | "hk";

// NYSE/Nasdaq 全天休市日(每年维护一次;半日如感恩节次日按正常日处理,可接受)
const US_HOLIDAYS = new Set([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027(年初先备着)
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

// A股(沪深北)全天休市日 —— 依沪深北交易所 2026 年节假日休市公告(2025-12-22 发布)。
// 含周末以外的交易日休市;周末已由 wd 判断兜底。每年更新一次。
const CN_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-02",                                              // 元旦
  "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-23", // 春节
  "2026-04-06",                                                            // 清明
  "2026-05-01", "2026-05-04", "2026-05-05",                               // 劳动节
  "2026-06-19",                                                           // 端午
  "2026-09-25",                                                           // 中秋
  "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07",   // 国庆
]);

function partsIn(now: Date, tz: string): { wd: string; mins: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  let hh = parseInt(get("hour"), 10);
  if (hh === 24) hh = 0; // 午夜在某些环境是 24
  return {
    wd: get("weekday"),
    mins: hh * 60 + parseInt(get("minute"), 10),
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function usStatus(now: Date): { state: MktState; label: string } {
  const { wd, mins, date } = partsIn(now, "America/New_York");
  if (wd === "Sat" || wd === "Sun") return { state: "closed", label: "周末休市" };
  if (US_HOLIDAYS.has(date)) return { state: "closed", label: "假日休市" };
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return { state: "open", label: "开盘中" };
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return { state: "pre", label: "盘前" };
  if (mins >= 16 * 60 && mins < 20 * 60) return { state: "post", label: "盘后" };
  return { state: "closed", label: "已收盘" };
}

// A股:北京时间,集合竞价 9:15-9:25,连续竞价 9:30-11:30 / 13:00-15:00,中午休市。
function cnStatus(now: Date): { state: MktState; label: string } {
  const { wd, mins, date } = partsIn(now, "Asia/Shanghai");
  if (wd === "Sat" || wd === "Sun") return { state: "closed", label: "周末休市" };
  if (CN_HOLIDAYS.has(date)) return { state: "closed", label: "假日休市" };
  if (mins >= 9 * 60 + 15 && mins < 9 * 60 + 30) return { state: "pre", label: "集合竞价" };
  if (mins >= 9 * 60 + 30 && mins < 11 * 60 + 30) return { state: "open", label: "交易中" };
  if (mins >= 11 * 60 + 30 && mins < 13 * 60) return { state: "closed", label: "午间休市" };
  if (mins >= 13 * 60 && mins < 15 * 60) return { state: "open", label: "交易中" };
  return { state: "closed", label: "已收盘" };
}

// 港股:香港时间,9:30-12:00 / 13:00-16:00,中午休市。港股假日表与 A 股不同,暂按时段近似。
function hkStatus(now: Date): { state: MktState; label: string } {
  const { wd, mins } = partsIn(now, "Asia/Hong_Kong");
  if (wd === "Sat" || wd === "Sun") return { state: "closed", label: "周末休市" };
  if (mins >= 9 * 60 && mins < 9 * 60 + 30) return { state: "pre", label: "开市前" };
  if (mins >= 9 * 60 + 30 && mins < 12 * 60) return { state: "open", label: "交易中" };
  if (mins >= 12 * 60 && mins < 13 * 60) return { state: "closed", label: "午间休市" };
  if (mins >= 13 * 60 && mins < 16 * 60) return { state: "open", label: "交易中" };
  return { state: "closed", label: "已收盘" };
}

export function marketStatus(now: Date, market: Market = "us"): { state: MktState; label: string } {
  if (market === "a") return cnStatus(now);
  if (market === "hk") return hkStatus(now);
  return usStatus(now);
}

// 盘口标签中→英(英文模式用)。覆盖美股 + A股 + 港股全部 label。
export const MKT_LABEL_EN: Record<string, string> = {
  "周末休市": "Weekend", "假日休市": "Holiday", "开盘中": "Open", "盘前": "Pre",
  "盘后": "After", "已收盘": "Closed", "集合竞价": "Pre-auction", "开市前": "Pre-open",
  "交易中": "Live", "午间休市": "Lunch break",
};
