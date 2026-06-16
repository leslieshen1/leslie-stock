// /api/quote 的报价符号:US 直用代码;A股 6→.SS / 0·3→.SZ;港股补零 .HK。
// 详情页页头 LivePrice 与估值行 LiveValuation 共用一套后缀规则,避免两处各写一份后漂移
// (两者都按这个符号去 j.quotes[sym.toUpperCase()] 取同一条实时价,才能锁步不打架)。
export function yahooSym(code: string, market: "a" | "hk" | "us" | string): string {
  if (market === "a") {
    if (/^6/.test(code)) return `${code}.SS`;
    if (/^[039]/.test(code)) return `${code}.SZ`;
    return code;
  }
  if (market === "hk") return `${code.replace(/\D/g, "").padStart(4, "0")}.HK`;
  return code.toUpperCase();
}
