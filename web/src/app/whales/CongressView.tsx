"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLang } from "@/lib/i18n";
import { PARTY_META, type CongressData, type CongressMember, type CongressTrade } from "@/lib/congress-types";

type PartyFilter = "all" | "D" | "R";
type SideFilter = "all" | "buy" | "sell";

// 个股 logo:parqet CDN → 首字母兜底（客户端，降级无依赖）
function TickerLogo({ sym }: { sym: string }) {
  const [bad, setBad] = useState(false);
  if (bad || !sym)
    return (
      <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent/10 text-[9px] font-bold text-accent">
        {sym[0]}
      </span>
    );
  return (
    <img
      src={`https://assets.parqet.com/logos/symbol/${sym}?format=png&size=36`}
      alt={sym}
      onError={() => setBad(true)}
      className="h-[18px] w-[18px] shrink-0 rounded-full border border-line bg-white object-cover"
    />
  );
}

function Avatar({ m, size }: { m: CongressMember; size: number }) {
  const [bad, setBad] = useState(false);
  const cls = "shrink-0 rounded-full object-cover";
  if (m.photo && !bad)
    return (
      <img src={m.photo} alt={m.name} onError={() => setBad(true)}
        style={{ width: size, height: size }}
        className={`${cls} border border-line bg-surface-2`} />
    );
  return (
    <span style={{ width: size, height: size, fontSize: size * 0.4 }}
      className={`${cls} inline-flex items-center justify-center bg-surface-3 font-semibold text-muted`}>
      {m.name[0]}
    </span>
  );
}

function SideChip({ t }: { t: CongressTrade }) {
  const { t: tr } = useLang();
  const buy = t.side === "buy";
  return (
    <span className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${
      buy ? "bg-up-soft text-up" : t.side === "sell" ? "bg-down-soft text-down" : "bg-surface-3 text-muted"}`}>
      {buy ? tr("买", "B") : t.side === "sell" ? tr("卖", "S") : tr("换", "E")}
    </span>
  );
}

function fmtDate(d: string, lang: string) {
  const [, mm, dd] = d.split("-");
  const mon = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+mm];
  return lang === "en" ? `${mon} ${+dd}` : `${+mm}/${+dd}`;
}

export default function CongressView({ data, avg }: { data: CongressData; avg: Record<string, number> }) {
  const { t, lang } = useLang();
  const [party, setParty] = useState<PartyFilter>("all");
  const [side, setSide] = useState<SideFilter>("all");

  const members = useMemo(() => {
    let xs = data.members;
    if (party !== "all") xs = xs.filter((m) => m.party === party);
    if (side !== "all") xs = xs.filter((m) => m.latest?.side === side || m.trades.some((tr) => tr.side === side));
    return xs;
  }, [data.members, party, side]);

  // 推荐:最活跃 + 最近,Hot = 笔数前四分之一
  const hotCut = useMemo(() => {
    const ns = [...data.members].map((m) => m.n_trades).sort((a, b) => b - a);
    return ns[Math.floor(ns.length * 0.18)] || 999;
  }, [data.members]);
  const recommended = members.slice(0, 12);

  // 国会共识:近 90 天内被最多人净买入的票
  const consensus = useMemo(() => {
    const cut = data.updated ? isoMinusDays(data.updated, 90) : "0000";
    const agg = new Map<string, { buy: Set<string>; sell: Set<string> }>();
    for (const m of data.members) {
      for (const tr of m.trades) {
        if (tr.date < cut) continue;
        const e = agg.get(tr.ticker) || { buy: new Set(), sell: new Set() };
        if (tr.side === "buy") e.buy.add(m.id);
        else if (tr.side === "sell") e.sell.add(m.id);
        agg.set(tr.ticker, e);
      }
    }
    return [...agg.entries()]
      .map(([ticker, e]) => ({ ticker, buy: e.buy.size, sell: e.sell.size, net: e.buy.size - e.sell.size }))
      .filter((r) => r.buy + r.sell >= 2)
      .sort((a, b) => b.net - a.net || b.buy - a.buy)
      .slice(0, 8);
  }, [data.members, data.updated]);

  return (
    <div className="space-y-6">
      {/* 筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          <Seg active={party === "all"} onClick={() => setParty("all")}>{t("全部", "All")}</Seg>
          <Seg active={party === "D"} onClick={() => setParty("D")} dot="bg-[#3B82F6]">{t("民主党", "Dem")}</Seg>
          <Seg active={party === "R"} onClick={() => setParty("R")} dot="bg-[#EF4444]">{t("共和党", "Rep")}</Seg>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          <Seg active={side === "all"} onClick={() => setSide("all")}>{t("买卖", "Buy+Sell")}</Seg>
          <Seg active={side === "buy"} onClick={() => setSide("buy")}>{t("买入", "Buys")}</Seg>
          <Seg active={side === "sell"} onClick={() => setSide("sell")}>{t("卖出", "Sells")}</Seg>
        </div>
      </div>

      {/* 推荐:横向滚动 */}
      {recommended.length > 0 && (
        <section>
          <h2 className="mb-2 text-[12px] font-medium uppercase tracking-wider text-faint">{t("热门议员", "Most active")}</h2>
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {recommended.map((m, i) => (
              <Link key={`rec-${m.id}-${i}`} href={`/congress/${m.id}`}
                className="group relative w-[150px] shrink-0 rounded-xl border border-line bg-surface p-3 text-center transition hover:border-line-2">
                {m.n_trades >= hotCut && (
                  <span className="absolute left-2 top-2 rounded bg-down px-1.5 py-0.5 text-[9px] font-bold text-white">Hot</span>
                )}
                <Avatar m={m} size={56} />
                <div className="mt-2 truncate text-[13px] font-semibold text-ink group-hover:text-accent">{m.name}</div>
                <div className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-faint">
                  <span className={`h-1.5 w-1.5 rounded-full ${PARTY_META[m.party].dot}`} />
                  {m.party === "?" ? m.state : `${PARTY_META[m.party][lang === "en" ? "en" : "label"].slice(0, lang === "en" ? 3 : 1)} · ${m.district}`}
                </div>
                <div className="mt-2 flex items-center justify-center gap-1">
                  <SideChip t={m.latest} />
                  <TickerLogo sym={m.latest.ticker} />
                  <span className="tnum truncate text-[11px] font-medium text-ink">{m.latest.ticker}</span>
                </div>
                <div className="tnum mt-1 text-[10px] text-faint">{m.latest.size} · {fmtDate(m.latest.date, lang)}</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 国会共识 */}
      {consensus.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-5">
          <header className="mb-3 flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-[15px] font-semibold text-ink">{t("国会共识", "Capitol consensus")}</h2>
            <span className="text-xs text-faint">{t("近 90 天净买入最集中 · 「均」= 五方均分", "Net-bought by the most members, last 90d · avg = 5-master score")}</span>
          </header>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {consensus.map((r, i) => (
              <Link key={`con-${r.ticker}-${i}`} href={`/stock/${r.ticker}?market=us`}
                className="group flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition hover:bg-surface-2">
                <span className="tnum w-4 shrink-0 text-right text-[10px] text-faint">{i + 1}</span>
                <TickerLogo sym={r.ticker} />
                <span className="tnum w-14 shrink-0 text-[12px] font-semibold text-ink group-hover:text-accent">{r.ticker}</span>
                <span className="tnum shrink-0 rounded-full bg-up-soft px-2 py-0.5 text-[11px] font-semibold text-up">{r.buy} {t("买", "buy")}</span>
                {r.sell > 0 && <span className="tnum shrink-0 text-[11px] text-down">{r.sell} {t("卖", "sell")}</span>}
                <span className="flex-1" />
                {avg[r.ticker] != null && (
                  <span className={`tnum shrink-0 text-[11px] font-semibold ${avg[r.ticker] >= 65 ? "text-up" : avg[r.ticker] >= 50 ? "text-accent" : "text-muted"}`}>
                    {t("均", "avg")} {avg[r.ticker]}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 议员卡片 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {members.map((m, i) => <MemberCard key={`grid-${m.id}-${i}`} m={m} avg={avg} />)}
      </div>

      <p className="text-center text-[11px] leading-relaxed text-faint">
        {t(
          `数据 = 美国众议院书记官 PTR 公开申报(${data.n_members} 位议员 · ${data.n_trades.toLocaleString()} 笔股票交易)。议员须在交易后 45 天内申报 —— 这是「滞后的公开」,不是实时。金额为法定区间,非精确值。仅众议院电子申报普通股,国债/期权/扫描件未纳入 · 非投资建议。`,
          `Data = U.S. House Clerk PTR filings (${data.n_members} members · ${data.n_trades.toLocaleString()} stock trades). Members file within 45 days of a trade — this is delayed disclosure, not real time. Amounts are statutory ranges. House e-filed common stock only · not financial advice.`,
        )}
      </p>
    </div>
  );
}

function MemberCard({ m, avg }: { m: CongressMember; avg: Record<string, number> }) {
  const { t, lang } = useLang();
  const buys = m.trades.filter((x) => x.side === "buy").length;
  return (
    <section className="rounded-xl border border-line bg-surface p-5 transition hover:border-line-2">
      <header className="mb-3 flex items-start gap-3">
        <Link href={`/congress/${m.id}`}><Avatar m={m} size={44} /></Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={`/congress/${m.id}`} className="truncate text-[15px] font-semibold text-ink hover:text-accent">{m.name}</Link>
            {!m.current && <span className="shrink-0 rounded border border-line bg-surface-2 px-1 py-0.5 text-[9px] text-faint">{t("已离任", "Former")}</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-faint">
            <span className={`h-1.5 w-1.5 rounded-full ${PARTY_META[m.party].dot}`} />
            <span className={PARTY_META[m.party].tone}>{lang === "en" ? PARTY_META[m.party].en : PARTY_META[m.party].label}</span>
            <span>· {m.district}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="tnum text-[15px] font-semibold text-ink">{m.n_trades}</div>
          <div className="text-[10px] text-faint">{t("笔", "trades")}</div>
        </div>
      </header>

      <div className="space-y-0.5">
        {m.trades.slice(0, 4).map((tr, i) => {
          const a = avg[tr.ticker];
          return (
            <Link key={`${tr.ticker}-${tr.date}-${i}`} href={`/stock/${tr.ticker}?market=us`}
              className="group flex items-center gap-2 rounded-md px-1.5 py-1 transition hover:bg-surface-2">
              <SideChip t={tr} />
              <TickerLogo sym={tr.ticker} />
              <span className="tnum w-14 shrink-0 text-[12px] font-semibold text-ink group-hover:text-accent">{tr.ticker}</span>
              {a != null && <span className={`tnum shrink-0 text-[10px] ${a >= 65 ? "text-up" : a >= 50 ? "text-accent" : "text-faint"}`}>{t("均", "avg")} {a}</span>}
              <span className="flex-1" />
              <span className="tnum shrink-0 text-[11px] text-muted">{tr.size}</span>
              <span className="tnum w-12 shrink-0 text-right text-[10px] text-faint">{fmtDate(tr.date, lang)}</span>
            </Link>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <Link href={`/congress/${m.id}`} className="text-xs font-medium text-accent hover:underline">
          {t(`全部 ${m.n_trades} 笔`, `All ${m.n_trades} trades`)} →
        </Link>
        <span className="text-[10px] text-faint">{buys}/{m.trades.length} {t("近期为买入", "recent buys")}</span>
      </div>
    </section>
  );
}

function Seg({ active, onClick, dot, children }: { active: boolean; onClick: () => void; dot?: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition ${active ? "bg-surface-3 text-ink" : "text-muted hover:text-ink"}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
      {children}
    </button>
  );
}

function isoMinusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}
