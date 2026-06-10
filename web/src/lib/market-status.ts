// 美股盘口状态 —— 按美东时间(自动处理夏令时 + 全天休市假日,不处理提前收盘的半日)算,不依赖任何接口。
export type MktState = "pre" | "open" | "post" | "closed";

// NYSE/Nasdaq 全天休市日(每年维护一次;半日如感恩节次日按正常日处理,可接受)
const HOLIDAYS = new Set([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027(年初先备着)
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

export function marketStatus(now: Date): { state: MktState; label: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const wd = get("weekday");
  let hh = parseInt(get("hour"), 10);
  if (hh === 24) hh = 0; // 午夜在某些环境是 24
  const mins = hh * 60 + parseInt(get("minute"), 10);
  const dateET = `${get("year")}-${get("month")}-${get("day")}`;

  if (wd === "Sat" || wd === "Sun") return { state: "closed", label: "周末休市" };
  if (HOLIDAYS.has(dateET)) return { state: "closed", label: "假日休市" };
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return { state: "open", label: "开盘中" };
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return { state: "pre", label: "盘前" };
  if (mins >= 16 * 60 && mins < 20 * 60) return { state: "post", label: "盘后" };
  return { state: "closed", label: "已收盘" };
}
