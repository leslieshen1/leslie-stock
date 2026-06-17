"use client";

import { type DilutionFlag, dilutionMagnitude } from "@/lib/dilution-types";
import { useLang } from "@/lib/i18n";

export default function DilutionWarning({ flag }: { flag: DilutionFlag }) {
  const { t } = useLang();
  const active = flag.tier === "active";
  const facts: string[] = [dilutionMagnitude(flag)];
  if (flag.atm_1y) facts.push(t(`近 1 年 ${flag.atm_1y} 份 424B5 增发招股书`, `${flag.atm_1y} 424B5 prospectuses in the past year`));
  if (flag.last_takedown) facts.push(t(`最近一次 ${flag.last_takedown}`, `Latest: ${flag.last_takedown}`));
  if (flag.foreign) facts.push(t("外国发行人(20-F/F-3)", "Foreign issuer (20-F/F-3)"));

  return (
    <div className="mb-6 rounded-xl border border-down/40 bg-down-soft p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-down">⚠ {t("印股票 / 稀释风险", "Share Dilution Risk")}</span>
        <span className="rounded border border-down/40 px-2 py-0.5 text-xs font-medium text-down">
          {active ? t("正在增发(active ATM)", "Active ATM offering") : t("有货架弹药(shelf armed)", "Shelf armed")}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-ink">
        {t(
          `该公司在 SEC 有${flag.shelf ? " S-3 / F-3 货架注册" : "连续增发记录"}，${
            active
              ? "发行方可随时通过 ATM（at-the-market）在市场上增发卖股，稀释散户——供给近乎无限，"
              : "随时可发动 ATM 增发，"
          }这是微盘票最毒的结构性陷阱（比题材 meme 更狠：股本可以一直印）。`,
          `This company has ${flag.shelf ? "an S-3 / F-3 shelf registration" : "a track record of repeated offerings"} on file with the SEC. ${
            active
              ? "The issuer can sell new shares into the market at any time via an ATM (at-the-market) program, diluting retail holders — supply is near-unlimited. "
              : "An ATM offering can be launched at any time. "
          }This is the nastiest structural trap in micro-caps (worse than a meme: the share count can keep printing).`
        )}
      </p>
      {facts.length > 0 && (
        <p className="mt-2 font-mono text-xs text-down">{facts.join(" · ")}</p>
      )}
      <p className="mt-2 text-[11px] text-faint">
        {t(
          "依据 SEC EDGAR 公开文件（S-3/F-3 货架 + 424B5 提款）自动识别 · 非投资建议，仅风险提示",
          "Auto-detected from public SEC EDGAR filings (S-3/F-3 shelf + 424B5 takedowns) · Not investment advice — risk flag only"
        )}
      </p>
    </div>
  );
}
