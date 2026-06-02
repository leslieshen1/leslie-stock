// 客户端安全(无 node:fs)。类型 + 纯展示 helper。loader 在 dilution.ts(服务端)。

/** 印股票 / 稀释红旗。来自 fetchers/dilution_flags.py(SEC EDGAR 货架 + ATM)。 */
export type DilutionFlag = {
  tier: "active" | "armed";
  shelf: boolean;
  atm_1y: number;
  followon_1y: number;
  foreign: boolean;
  capacity_usd: number | null;
  ratio: number | null;
  mcap_b?: number | null;
  last_takedown: string | null;
};

/** 稀释幅度一句话:货架额度 vs 市值倍数,或 nano 近乎无限。 */
export function dilutionMagnitude(f: DilutionFlag): string {
  const cap = f.capacity_usd
    ? f.capacity_usd >= 1e9
      ? `$${(f.capacity_usd / 1e9).toFixed(1)}B`
      : `$${(f.capacity_usd / 1e6).toFixed(0)}M`
    : null;
  if (f.ratio && f.ratio >= 2) return `货架 ${cap} = 市值的 ${f.ratio} 倍`;
  if (cap && f.mcap_b != null && f.mcap_b < 0.02) {
    const mc = f.mcap_b < 0.0005 ? "市值近乎为零" : `市值仅 $${(f.mcap_b * 1000).toFixed(0)}M`;
    return `货架 ${cap},${mc} ≈ 近乎无限`;
  }
  if (cap) return `货架 ${cap}`;
  return "持续 ATM 增发";
}
