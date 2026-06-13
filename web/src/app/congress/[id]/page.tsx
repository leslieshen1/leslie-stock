// 单个议员的交易申报详情页 —— /congress/P000197
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadCongress, loadAvgScores, PARTY_META } from "@/lib/congress";
import { T } from "@/lib/i18n";
import CongressMemberDetail from "./MemberDetail";

export const dynamic = "force-dynamic";

export default async function CongressDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = loadCongress();
  const m = data.members.find((x) => x.id === id);
  if (!m) notFound();
  const avg = loadAvgScores();

  const buys = m.trades.filter((t) => t.side === "buy").length;
  const sells = m.trades.filter((t) => t.side === "sell").length;
  const pm = PARTY_META[m.party];

  return (
    <main className="mx-auto max-w-3xl px-4 pb-12 pt-3 sm:px-6">
      <div className="mb-3 flex items-center gap-2 text-xs">
        <Link href="/whales" className="text-muted hover:text-ink"><T zh="聪明钱" en="Smart Money" /></Link>
        <span className="text-faint">/</span>
        <span className="text-muted"><T zh="国会" en="Congress" /></span>
        <span className="text-faint">/</span>
        <span className="text-muted">{m.name}</span>
      </div>

      <header className="mb-5 flex items-start gap-4">
        <Avatar name={m.name} photo={m.photo} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{m.name}</h1>
            {!m.current && <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-faint"><T zh="已离任" en="Former member" /></span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${pm.dot}`} />
              <span className={pm.tone}><T zh={pm.label} en={pm.en} /></span>
            </span>
            <span>{m.district}</span>
            <span className="font-mono text-xs text-faint"><T zh="众议院 PTR 申报" en="House PTR filings" /></span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Chip label={<T zh="股票交易" en="Stock trades" />} value={m.n_trades} />
            <Chip label={<T zh="买入" en="Buys" />} value={buys} tone="up" />
            <Chip label={<T zh="卖出" en="Sells" />} value={sells} tone="down" />
            <Chip label={<T zh="最近" en="Latest" />} value={m.last_date} mono />
          </div>
        </div>
      </header>

      {m.top_tickers.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wider text-faint"><T zh="最常交易" en="Most traded" /></div>
          <div className="flex flex-wrap gap-1.5">
            {m.top_tickers.map((tk) => (
              <Link key={tk} href={`/stock/${tk}?market=us`}
                className="rounded-lg border border-line bg-surface px-2.5 py-1 font-mono text-[12px] font-semibold text-ink transition hover:border-line-2 hover:text-accent">
                {tk}{avg[tk] != null && <span className={`ml-1.5 text-[10px] font-normal ${avg[tk] >= 65 ? "text-up" : avg[tk] >= 50 ? "text-accent" : "text-faint"}`}>{avg[tk]}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}

      <CongressMemberDetail trades={m.trades} avg={avg} />

      <p className="mt-4 text-[11px] leading-relaxed text-faint">
        <T
          zh="数据 = 美国众议院书记官「周期交易报告」(PTR)公开申报。议员须在交易后 45 天内申报 —— 这是滞后的公开,不是实时跟单。金额为法定区间(如 $1,001–$15,000),非精确成交额。「均」= 五方均分(0-100)。仅电子申报的普通股,国债 / 期权 / 共同基金 / 扫描件未纳入 · 共识 ≠ 正确 · 非投资建议。"
          en="Data = U.S. House Clerk Periodic Transaction Reports (PTR). Members file within 45 days of a trade — delayed disclosure, not live copy-trading. Amounts are statutory ranges (e.g. $1,001–$15,000), not exact fills. 'avg' = five-master score (0-100). E-filed common stock only · consensus ≠ correct · not financial advice."
        />
      </p>
    </main>
  );
}

function Avatar({ name, photo }: { name: string; photo: string | null }) {
  if (photo)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photo} alt={name} className="h-16 w-16 shrink-0 rounded-full border border-line object-cover sm:h-20 sm:w-20" />;
  return (
    <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface-3 text-2xl font-semibold text-muted sm:h-20 sm:w-20">
      {name[0]}
    </span>
  );
}

function Chip({ label, value, tone, mono }: { label: React.ReactNode; value: React.ReactNode; tone?: "up" | "down"; mono?: boolean }) {
  const c = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink";
  return (
    <span className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
      {label} <b className={`font-mono ${c} ${mono ? "text-[11px]" : ""}`}>{value}</b>
    </span>
  );
}
