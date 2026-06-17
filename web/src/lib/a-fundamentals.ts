import { fetchWithTimeout } from "@/lib/api-guard";

// A 股实时盘面(腾讯行情,免费无 key)。个股详情页服务端单只拉,补上美股有、A 股缺的基本面。
// 字段索引(0-based,以 ~ 分隔):[4]昨收 [5]今开 [33]最高 [34]最低 [38]换手率
//   [39]市盈率TTM [43]振幅 [44]流通市值(亿) [45]总市值(亿) [46]市净率 [30]最新成交时间。
export type AFund = {
  pe: number | null;
  pb: number | null;
  turnover: number | null; // 换手率 %
  amplitude: number | null; // 振幅 %
  hi: number | null;
  lo: number | null;
  open: number | null;
  prevClose: number | null;
  mcapYi: number | null; // 总市值(亿)
  circYi: number | null; // 流通市值(亿)
  tradeTs: string | null; // 最新成交时间 yyyymmddHHMMSS
};

function tencentSym(code: string, market?: string): string | null {
  if (market === "hk") return "hk" + code.replace(/\D/g, "").padStart(5, "0"); // 港股 700 → hk00700
  if (/^6/.test(code)) return "sh" + code; // 沪市主板 / 科创板(688)
  if (/^[03]/.test(code)) return "sz" + code; // 深市主板 / 创业板(300)
  if (/^[48]/.test(code)) return "bj" + code; // 北交所
  return null;
}

const num = (s: string | undefined): number | null => {
  const v = parseFloat(s ?? "");
  return Number.isFinite(v) ? v : null;
};

export async function fetchAFundamentals(code: string, market?: string): Promise<AFund | null> {
  const sym = tencentSym(code, market);
  if (!sym) return null;
  const isHK = sym.startsWith("hk"); // 港股腾讯字段布局与 A 股不同:可靠的只有 PE[39] + 总市值[44]
  try {
    // SSR 渲染路径上必须带超时:腾讯挂起时不能把整个 A/港股详情页拖到 socket 默认超时(白屏)。
    // sym 经 encodeURIComponent,防特殊字符进 URL(与全站净化口径一致)。
    const r = await fetchWithTimeout(`https://qt.gtimg.cn/q=${encodeURIComponent(sym)}`, {
      headers: { referer: "https://gu.qq.com/", "user-agent": "Mozilla/5.0" },
      next: { revalidate: 60 },
    }, 6000);
    if (!r.ok) return null;
    // 腾讯是 GBK;fetch().text() 只按 UTF-8 解码,会把名字解成乱码,且名字里若含 0x7E(~)
    // 字节会多切一刀导致后面 PE/PB 等字段错位。用 GBK 正确解码,~ 分隔与字段位才稳。
    const txt = new TextDecoder("gbk").decode(await r.arrayBuffer());
    const m = txt.match(/="([^"]*)"/);
    if (!m) return null;
    const p = m[1].split("~");
    if (p.length < 47) return null;
    // 港股:[38]换手/[43]振幅/[46]市净率/[33][34]高低 在腾讯港股口径里不可靠([46] 实为代码),
    // 只取确认可解析的 PE[39] + 总市值[44];A 股按完整字段。
    return {
      prevClose: num(p[4]),
      open: num(p[5]),
      hi: isHK ? null : num(p[33]),
      lo: isHK ? null : num(p[34]),
      turnover: isHK ? null : num(p[38]),
      pe: num(p[39]),
      amplitude: isHK ? null : num(p[43]),
      circYi: isHK ? null : num(p[44]),
      mcapYi: isHK ? num(p[44]) : num(p[45]),
      pb: isHK ? null : num(p[46]),
      tradeTs: p[30] || null,
    };
  } catch {
    return null;
  }
}
