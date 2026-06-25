// /api/quote 的报价符号:US 直用代码;A股 6→.SS / 0·3→.SZ / 北交所(4·8·920…)→.BJ;港股补零 .HK。
// 详情页页头 LivePrice 与估值行 LiveValuation 共用一套后缀规则,避免两处各写一份后漂移
// (两者都按这个符号去 j.quotes[sym.toUpperCase()] 取同一条实时价,才能锁步不打架)。
export function yahooSym(code: string, market: "a" | "hk" | "us" | string): string {
  if (market === "a") {
    if (/^6/.test(code)) return `${code}.SS`;
    // 北交所(4xxxxx/8xxxxx/920xxx)→ .BJ → qqFromYahoo 映射 bj 前缀,与列表用的 tencentSym 一致。
    // ⚠ 必须在深市判断【之前】:北交所新码 920xxx 以「9」开头,旧逻辑 /^[039]/ 会把它误判成深市 .SZ → 取不到价
    //（民士达 920394 实测:.SZ 无价、.BJ 才有 ¥78）。深市只剩 0/3 开头(9 不是深市)。
    if (/^(?:4|8|92)/.test(code)) return `${code}.BJ`;
    if (/^[03]/.test(code)) return `${code}.SZ`;
    return code;
  }
  // 港股 Yahoo 符号要 4 位、且不留多余前导零(Yahoo 不认 00700.HK,要 0700.HK;09988→9988)。
  // 先去前导零再补到 4 位 —— 否则存成 5 位代码的港股(00700/09988)拿不到实时价、卡在旧种子。
  if (market === "hk") return `${code.replace(/\D/g, "").replace(/^0+/, "").padStart(4, "0")}.HK`;
  if (market === "kr") return `${code}.KS`; // 韩股:000660 → 000660.KS(Yahoo,/api/quote 走 Yahoo)
  return code.toUpperCase();
}
