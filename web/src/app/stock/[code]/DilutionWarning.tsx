import type { DilutionFlag } from "@/lib/dilution";

export default function DilutionWarning({ flag }: { flag: DilutionFlag }) {
  const active = flag.tier === "active";
  const facts: string[] = [];
  if (flag.capacity_usd) {
    const cap = flag.capacity_usd >= 1e9
      ? `$${(flag.capacity_usd / 1e9).toFixed(1)}B`
      : `$${(flag.capacity_usd / 1e6).toFixed(0)}M`;
    facts.push(`货架额度 ${cap}`);
  }
  if (flag.ratio) facts.push(`≈ 当前市值的 ${flag.ratio} 倍`);
  if (flag.atm_1y) facts.push(`近 1 年 ${flag.atm_1y} 份 424B5 增发招股书`);
  if (flag.last_takedown) facts.push(`最近一次 ${flag.last_takedown}`);
  if (flag.foreign) facts.push("外国发行人(20-F/F-3)");

  return (
    <div className="mb-6 rounded-xl border border-down/40 bg-down-soft p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-down">⚠ 印股票 / 稀释风险</span>
        <span className="rounded border border-down/40 px-2 py-0.5 text-xs font-medium text-down">
          {active ? "正在增发(active ATM)" : "有货架弹药(shelf armed)"}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-ink">
        该公司在 SEC 有{flag.shelf ? " S-3 / F-3 货架注册" : "连续增发记录"}，
        {active
          ? "发行方可随时通过 ATM（at-the-market）在市场上增发卖股，稀释散户——供给近乎无限，"
          : "随时可发动 ATM 增发，"}
        这是微盘票最毒的结构性陷阱（比题材 meme 更狠：股本可以一直印）。
      </p>
      {facts.length > 0 && (
        <p className="mt-2 font-mono text-xs text-down">{facts.join(" · ")}</p>
      )}
      <p className="mt-2 text-[11px] text-faint">
        依据 SEC EDGAR 公开文件（S-3/F-3 货架 + 424B5 提款）自动识别 · 非投资建议，仅风险提示
      </p>
    </div>
  );
}
