// 美股盘口状态 —— 按美东时间(自动处理夏令时,不处理假日)算,不依赖任何接口。
export type MktState = "pre" | "open" | "post" | "closed";

export function marketStatus(now: Date): { state: MktState; label: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const wd = get("weekday");
  let hh = parseInt(get("hour"), 10);
  if (hh === 24) hh = 0; // 午夜在某些环境是 24
  const mins = hh * 60 + parseInt(get("minute"), 10);

  if (wd === "Sat" || wd === "Sun") return { state: "closed", label: "周末休市" };
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return { state: "open", label: "开盘中" };
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return { state: "pre", label: "盘前" };
  if (mins >= 16 * 60 && mins < 20 * 60) return { state: "post", label: "盘后" };
  return { state: "closed", label: "已收盘" };
}
