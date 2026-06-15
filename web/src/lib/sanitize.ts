import path from "path";

// 输入净化 —— 任何用 code/market/sym 拼文件路径的入口都必须先过这里,杜绝路径穿越。
// 见审计 B1:/api/analyze/[code] 的 code/market 曾可被 %2f/%2e 编码穿越读任意 .json。

const MARKETS = new Set(["a", "hk", "us"]);

export function safeMarket(m: string | null | undefined): "a" | "hk" | "us" | null {
  const v = (m ?? "").toLowerCase();
  return MARKETS.has(v) ? (v as "a" | "hk" | "us") : null;
}

// 代码:美股字母/点/连字符(BRK.B)、A股港股数字;限字符集 + 长度,且显式拒 ".."。
// 字符集不含 / \ → 解码后任何分隔符都会被拒,单段内无穿越空间。
const CODE_RE = /^[A-Za-z0-9.\-]{1,12}$/;
export function safeCode(c: string | null | undefined): string | null {
  const v = (c ?? "").trim();
  if (!CODE_RE.test(v) || v.includes("..")) return null;
  return v;
}

// 路径兜底(纵深防御):拼出的绝对路径必须仍在 base 目录内,否则判穿越返回 null。
export function safeUnder(base: string, name: string): string | null {
  const full = path.resolve(base, name);
  return full === base || full.startsWith(base + path.sep) ? full : null;
}
