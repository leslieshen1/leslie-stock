"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Waves, Landmark } from "lucide-react";
import {
  type Investor, type Holding, type InvestorType,
  CHANGE_META, TYPE_META,
} from "@/lib/whales-types";
import { useLang } from "@/lib/i18n";
import type { CongressData } from "@/lib/congress-types";
import CongressView from "./CongressView";

type Filter = "all" | InvestorType;
type Lens = "13f" | "congress";

// 机构头像:无真人照 → 风格化字母牌(渐变按类型),学国会那版的视觉密度
const AV_COLOR: Record<string, { from: string; to: string }> = {
  superinvestor: { from: "#1e3a8a", to: "#3b82f6" }, // 价投 蓝
  fund: { from: "#5b21b6", to: "#a78bfa" },           // 基金 紫
  politician: { from: "#9a3412", to: "#e0734d" },     // 议员 琥珀
  hot_money: { from: "#9f1239", to: "#fb7185" },       // 游资 玫红
  northbound: { from: "#065f46", to: "#10b981" },     // 北向 绿
};
function InvestorAvatar({ inv, size }: { inv: Investor; size: number }) {
  const v = AV_COLOR[inv.type] ?? { from: "#3f3f46", to: "#71717a" };
  const init = ((inv.name_en || inv.name || "?").trim()[0] || "?").toUpperCase();
  const gid = `iav-${inv.slug}-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" className="shrink-0" role="img" aria-label={inv.name}>
      <defs>
        <linearGradient id={gid} x1="6" y1="2" x2="38" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={v.from} /><stop offset="100%" stopColor={v.to} />
        </linearGradient>
      </defs>
      <circle cx="22" cy="22" r="21" fill={`url(#${gid})`} />
      <ellipse cx="22" cy="15" rx="13" ry="8" fill="#fff" opacity="0.12" />
      <text x="22" y="23.5" textAnchor="middle" dominantBaseline="central" fill="#fff"
        fontSize="18" fontWeight="700" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>{init}</text>
    </svg>
  );
}

// 持仓 ticker logo:美股走 parqet,A 股(无 logo 源)用首字母牌
function HoldingLogo({ ticker, market, size = 18 }: { ticker: string; market: string; size?: number }) {
  const [bad, setBad] = useState(false);
  if (market === "a" || bad || !ticker)
    return (
      <span style={{ width: size, height: size, fontSize: size * 0.5 }}
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent/10 font-bold text-accent">
        {ticker?.[0] ?? "?"}
      </span>
    );
  return (
    <img src={`https://assets.parqet.com/logos/symbol/${ticker}?format=png&size=36`} alt={ticker}
      onError={() => setBad(true)} style={{ width: size, height: size }} loading="lazy" decoding="async"
      className="shrink-0 rounded-full border border-line bg-white object-cover" />
  );
}

// 共识分析：把所有超级投资者的持仓按 ticker 聚合
type ConRow = {
  ticker: string; name: string; n: number; avgPct: number;
  buys: number; sells: number; net: number; holders: string[];
};
type Con = {
  nSuper: number; consensus3: number; netBuyCount: number; netSellCount: number;
  mostHeld: ConRow[]; netBuys: ConRow[]; netSells: ConRow[];
};

export default function WhalesClient({ investors, congress, avg }: {
  investors: Investor[];
  congress?: CongressData;
  avg?: Record<string, number>;
}) {
 const { t, lang } = useLang();
 const [lens, setLens] = useState<Lens>("13f");
 const [filter, setFilter] = useState<Filter>("all");

  // 政客/议员归口「国会」镜头(那里 96 人 + 6886 笔,远比 13F 里这 3 个丰富),13F 不再混入
  const insts = useMemo(() => investors.filter((i) => i.type !== "politician"), [investors]);
  const filtered = useMemo(
 () => (filter === "all" ? insts : insts.filter((i) => i.type === filter)),
    [insts, filter],
  );

  const period = useMemo(
    () => investors.find((i) => i.type === "superinvestor")?.latest_period || "",
    [investors],
  );

  const con = useMemo<Con>(() => {
    const map = new Map<string, { ticker: string; name: string;
      holders: { name: string; pct: number | null; change: string | null }[] }>();
    let nSuper = 0;
    for (const inv of investors) {
      if (inv.type !== "superinvestor") continue;
      nSuper++;
      for (const h of inv.holdings) {
        if (!h.ticker) continue;
        const e = map.get(h.ticker) || { ticker: h.ticker, name: h.stock_name || h.ticker, holders: [] };
        e.holders.push({ name: inv.name, pct: h.pct_of_portfolio, change: h.change_type });
        if ((h.stock_name?.length || 0) > e.name.length) e.name = h.stock_name!;
        map.set(h.ticker, e);
      }
    }
    const rows: ConRow[] = [...map.values()].map((e) => {
      const n = e.holders.length;
      const avgPct = e.holders.reduce((s, x) => s + (x.pct || 0), 0) / n;
      const buys = e.holders.filter((x) => x.change === "new" || x.change === "add").length;
      const sells = e.holders.filter((x) => x.change === "trim" || x.change === "exit").length;
      return { ticker: e.ticker, name: e.name, n, avgPct, buys, sells, net: buys - sells,
        holders: e.holders.map((x) => x.name) };
    });
    return {
      nSuper,
      consensus3: rows.filter((r) => r.n >= 3).length,
      netBuyCount: rows.filter((r) => r.net > 0).length,
      netSellCount: rows.filter((r) => r.net < 0).length,
      mostHeld: [...rows].filter((r) => r.n >= 2).sort((a, b) => b.n - a.n || b.avgPct - a.avgPct).slice(0, 12),
      netBuys: [...rows].filter((r) => r.buys > 0).sort((a, b) => b.net - a.net || b.buys - a.buys).slice(0, 8),
      netSells: [...rows].filter((r) => r.sells > 0).sort((a, b) => a.net - b.net || b.sells - a.sells).slice(0, 8),
    };
  }, [investors]);

  const types = useMemo(() => {
    const s = new Set(insts.map((i) => i.type));
 return (["superinvestor", "fund", "private_fund", "hot_money", "northbound"] as InvestorType[]).filter((t) => s.has(t));
  }, [insts]);

  // 顶部 featured 横滑卡(学国会"热门议员"):知名价投,持仓多的在前。不按收益排(13F 无收益)
  const featured = useMemo(
    () => investors.filter((i) => i.type === "superinvestor")
      .sort((a, b) => (b.holdings_count || 0) - (a.holdings_count || 0)).slice(0, 12),
    [investors],
  );

  return (
 <div className="space-y-7">
      {/* Header */}
      <header>
 <div className="flex items-center gap-2.5">
 <Waves className="h-5 w-5 text-accent" strokeWidth={1.75} />
 <h1 className="text-[22px] font-semibold tracking-tight text-ink">{t("聪明钱", "Smart Money")}</h1>
        </div>
 <p className="mt-1.5 text-sm text-muted">
          {lens === "13f"
            ? t(
                "关注仓位占比与季度变动 —— 重仓、建仓与减持代表不同含义,而非仅看是否持有。",
                "Position size and quarterly change matter, not just whether a name is held — a core holding, a new stake and a reduction each carry different meaning.",
              )
            : t(
                "美国国会议员的证券交易须在 45 天内依法公开申报;结合五方评分查看其买卖标的。",
                "Members of Congress must disclose trades within 45 days by law — see who's buying what, and whether it lines up with the five-master read.",
              )}
        </p>
      </header>

      {/* 镜头切换:机构 13F / 国会 Congress */}
      {congress && congress.members.length > 0 && (
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          <LensBtn active={lens === "13f"} onClick={() => setLens("13f")} icon={<Waves className="h-3.5 w-3.5" strokeWidth={2} />}>
            {t("机构 13F", "Institutions")}
          </LensBtn>
          <LensBtn active={lens === "congress"} onClick={() => setLens("congress")} icon={<Landmark className="h-3.5 w-3.5" strokeWidth={2} />}>
            {t(`国会 · ${congress.n_members}`, `Congress · ${congress.n_members}`)}
          </LensBtn>
        </div>
      )}

      {lens === "congress" && congress ? (
        <CongressView data={congress} avg={avg || {}} />
      ) : (
        <>
          {/* 筛选 */}
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
            <FilterBtn active={filter === "all"} onClick={() => setFilter("all")}>{t("全部", "All")}</FilterBtn>
            {types.map((ty) => (
              <FilterBtn key={ty} active={filter === ty} onClick={() => setFilter(ty)}>
                {TYPE_META[ty].label}
              </FilterBtn>
            ))}
          </div>

          {/* 知名价投:横滑 featured(学国会"热门议员")*/}
          {(filter === "all" || filter === "superinvestor") && featured.length > 0 && (
            <section>
              <h2 className="mb-2 text-[12px] font-medium uppercase tracking-wider text-faint">{t("知名价投", "Notable investors")}</h2>
              <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {featured.map((inv) => {
                  const top = inv.holdings[0];
                  return (
                    <Link key={`feat-${inv.slug}`} href={`/whales/${inv.slug}`}
                      className="group w-[150px] shrink-0 rounded-xl border border-line bg-surface p-3 text-center transition hover:border-line-2">
                      <div className="flex justify-center"><InvestorAvatar inv={inv} size={56} /></div>
                      <div className="mt-2 truncate text-[13px] font-semibold text-ink group-hover:text-accent">{inv.name}</div>
                      <div className="mt-0.5 truncate text-[10px] text-faint">{inv.entity || TYPE_META[inv.type].label}</div>
                      {top && (
                        <div className="mt-2 flex items-center justify-center gap-1">
                          <HoldingLogo ticker={top.ticker} market={top.market} size={16} />
                          <span className="tnum truncate text-[11px] font-medium text-ink">{top.ticker}</span>
                          {top.pct_of_portfolio != null && <span className="tnum text-[10px] text-faint">{top.pct_of_portfolio}%</span>}
                        </div>
                      )}
                      <div className="mt-1 text-[10px] text-faint">{inv.holdings_count} {t("持仓", "holdings")}</div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* 聪明钱共识分析 */}
          {(filter === "all" || filter === "superinvestor") && con.mostHeld.length > 0 && (
            <ConsensusPanel con={con} period={period} />
          )}

          {/* 投资者卡片 */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filtered.map((inv) => <InvestorCard key={inv.slug} inv={inv} />)}
          </div>

          <p className="text-center text-xs text-faint">
            {t(
              "美股 13F 季度滞后 45 天 · A 股基金季报 · 仓位为披露时点 · 非投资建议",
              "US 13F lags 45 days · A-share fund filings · positions as of disclosure · not investment advice",
            )}
          </p>
        </>
      )}
    </div>
  );
}

function LensBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 sm:py-1.5 text-[13px] font-medium transition ${active ? "bg-surface-3 text-ink" : "text-muted hover:text-ink"}`}>
      {icon}{children}
    </button>
  );
}

function InvestorCard({ inv }: { inv: Investor }) {
  const { t } = useLang();
  const maxPct = Math.max(...inv.holdings.map((h) => h.pct_of_portfolio || 0), 1);

  return (
 <section className="rounded-xl border border-line bg-surface p-4 sm:p-5 transition hover:border-line-2">
 <header className="mb-4 flex items-start gap-3">
        <Link href={`/whales/${inv.slug}`}><InvestorAvatar inv={inv} size={44} /></Link>
        <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2">
 <Link href={`/whales/${inv.slug}`} className="truncate text-[15px] font-semibold text-ink hover:text-accent">{inv.name}</Link>
 <span className="shrink-0 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
              {TYPE_META[inv.type].label}
            </span>
          </div>
 {inv.entity && <p className="mt-0.5 truncate text-xs text-faint">{inv.entity}</p>}
        </div>
 <div className="shrink-0 text-right">
 <div className="tnum text-[15px] font-semibold text-ink">{inv.holdings_count ?? inv.holdings.length}</div>
 <div className="text-[10px] text-faint">{t("持仓", "holdings")}</div>
        </div>
      </header>

      {inv.notable_for && (
 <p className="mb-4 text-xs leading-relaxed text-muted">{inv.notable_for}</p>
      )}

 <div className="space-y-1">
        {inv.holdings.slice(0, 6).map((h, i) => {
 const clickable = h.market === "a";
 const inner = inv.type === "politician" || inv.type === "hot_money"
            ? <TradeRow h={h} />
            : <HoldingBar h={h} maxPct={maxPct} clickable={clickable} />;
          return clickable ? (
 <Link key={i} href={`/stock/${h.ticker}?market=a`} className="group block rounded-md px-1.5 py-1 transition hover:bg-surface-2">
              {inner}
            </Link>
          ) : (
 <div key={i} className="px-1.5 py-1">{inner}</div>
          );
        })}
      </div>
      {inv.holdings.length > 0 && (
        <Link href={`/whales/${inv.slug}`}
          className="mt-3 inline-block text-xs font-medium text-accent hover:underline">
          {t(`完整持仓 ${inv.holdings.length} 只`, `All ${inv.holdings.length} holdings`)} →
        </Link>
      )}
    </section>
  );
}

// 基金 / 13F:占比条
function HoldingBar({ h, maxPct, clickable }: { h: Holding; maxPct: number; clickable: boolean }) {
 const cm = CHANGE_META[h.change_type || "hold"];
  const barW = ((h.pct_of_portfolio || 0) / maxPct) * 100;
  return (
 <div className="flex items-center gap-2">
 <span className="tnum w-4 shrink-0 text-right text-[10px] text-faint">{h.rank_in_portfolio}</span>
 <HoldingLogo ticker={h.ticker} market={h.market} size={16} />
 <span className={`w-16 sm:w-20 shrink-0 truncate text-[13px] ${clickable ? "text-ink group-hover:text-accent" : "text-muted"}`}>
        {h.stock_name}
      </span>
 <div className="relative h-1.5 flex-1 min-w-[48px] overflow-hidden rounded-full bg-surface-2">
 <div className="absolute inset-y-0 left-0 rounded-full bg-accent/70" style={{ width: `${barW}%` }} />
      </div>
 <span className="tnum w-10 shrink-0 text-right text-xs text-muted">{h.pct_of_portfolio}%</span>
 {h.change_type && h.change_type !== "hold" ? (
        <span className={`hidden sm:inline-flex w-12 shrink-0 rounded border px-1 py-0.5 text-center text-[9px] font-medium ${cm.tone}`}>{cm.label}</span>
 ) : <span className="hidden sm:block w-12 shrink-0" />}
    </div>
  );
}

// 议员:交易流水
function TradeRow({ h }: { h: Holding }) {
 const { t } = useLang();
 const buy = h.change_type === "add" || h.change_type === "new";
 const sell = h.change_type === "trim" || h.change_type === "exit";
  return (
 <div className="flex items-center gap-2.5">
      <span className={`inline-flex w-11 shrink-0 items-center justify-center gap-0.5 rounded border px-1 py-0.5 text-[10px] font-medium ${
 buy ? "text-up border-up/25 bg-up-soft" : sell ? "text-down border-down/25 bg-down-soft" : "text-faint border-line bg-surface-2"}`}>
 {buy ? t("买入", "Buy") : sell ? t("卖出", "Sell") : t("持有", "Hold")}
      </span>
 <span className="flex-1 truncate text-[13px] text-ink">
 <span className="tnum text-xs text-faint">{h.ticker}</span> {h.stock_name}
      </span>
 <span className="tnum shrink-0 text-xs text-muted">{h.amount_range}</span>
 <span className="tnum w-16 shrink-0 text-right text-[10px] text-faint">{h.trade_date}</span>
    </div>
  );
}

function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-2 sm:py-1.5 text-[13px] font-medium transition ${
 active ? "bg-surface-3 text-ink" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

// ===== 聪明钱共识分析面板 =====
function ConsensusPanel({ con, period }: { con: Con; period: string }) {
  const { t } = useLang();
  const maxN = con.mostHeld[0]?.n || 1;
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-[15px] font-semibold text-ink">{t("聪明钱共识", "Smart-money consensus")}</h2>
        <span className="text-xs text-faint">
          {t(`${con.nSuper} 位价投大佬交叉持仓`, `${con.nSuper} value investors, overlapping holdings`)}{period ? ` · ${period}` : ""} · 13F
        </span>
      </header>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label={t("价投大佬", "Value investors")} value={con.nSuper} />
        <Stat label={t("≥3 人共识", "≥3 in agreement")} value={con.consensus3} />
        <Stat label={t("本季净加码", "Net buyers")} value={con.netBuyCount} tone="up" />
        <Stat label={t("本季净减持", "Net sellers")} value={con.netSellCount} tone="down" />
      </div>

      <h3 className="mb-1.5 mt-5 text-[12px] font-medium uppercase tracking-wider text-faint">
        {t("最多大佬共同持有", "Most widely held")}
      </h3>
      <div className="space-y-0.5">
        {con.mostHeld.map((r, i) => (
          <ConsensusRow key={r.ticker} r={r} rank={i + 1} maxN={maxN} />
        ))}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        <MoveCol title={t("本季加码最集中", "Most-bought this quarter")} tone="up" rows={con.netBuys} kind="buy" />
        <MoveCol title={t("本季减持最集中", "Most-sold this quarter")} tone="down" rows={con.netSells} kind="sell" />
      </div>

      <p className="mt-4 text-[11px] text-faint">
        {t(
          "共识不等于正确,机构集中持有同样可能集体误判。数据仅反映持仓与变动,供独立判断参考。",
          "Consensus isn't correctness — crowded positions can be a collective mistake. The data only reflects holdings and changes; use your own judgment.",
        )}
      </p>

    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "up" | "down" }) {
  const c = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
      <div className="text-[10px] text-faint">{label}</div>
      <div className={`tnum mt-0.5 text-lg font-semibold ${c}`}>{value}</div>
    </div>
  );
}

function ConsensusRow({ r, rank, maxN }: { r: ConRow; rank: number; maxN: number }) {
  const { t } = useLang();
  return (
    <Link
      href={`/stock/${r.ticker}?market=us`}
      title={r.holders.join("、")}
      className="group flex items-center gap-2 rounded-md px-1.5 py-1.5 transition hover:bg-surface-2"
    >
      <span className="tnum w-4 shrink-0 text-right text-[10px] text-faint">{rank}</span>
      <span className="tnum w-14 shrink-0 text-[12px] font-semibold text-ink group-hover:text-accent">{r.ticker}</span>
      <span className="hidden w-28 shrink-0 truncate text-[12px] text-muted sm:block">{r.name}</span>
      <span className="tnum shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">{t(`${r.n} 位`, `${r.n}`)}</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent/70" style={{ width: `${(r.n / maxN) * 100}%` }} />
      </div>
      <span className="tnum w-16 shrink-0 text-right text-[11px] text-faint">{t(`均 ${r.avgPct.toFixed(1)}%`, `avg ${r.avgPct.toFixed(1)}%`)}</span>
      {/* 恒占位:net=0 的行少这一列会比别人宽 8px,"均 x%" 整列错位(2026-06-12 抓包) */}
      <span className={`tnum w-8 shrink-0 text-right text-[11px] font-medium ${r.net > 0 ? "text-up" : r.net < 0 ? "text-down" : "text-faint"}`}>
        {r.net > 0 ? `+${r.net}` : r.net < 0 ? r.net : "\u00b7"}
      </span>
    </Link>
  );
}

function MoveCol({ title, tone, rows, kind }: {
  title: string; tone: "up" | "down"; rows: ConRow[]; kind: "buy" | "sell";
}) {
  const { t } = useLang();
  return (
    <div>
      <h3 className="mb-1.5 text-[12px] font-medium uppercase tracking-wider text-faint">{title}</h3>
      <div className="space-y-0.5">
        {rows.length === 0 && <p className="px-1.5 text-xs text-faint">—</p>}
        {rows.map((r) => {
          const cnt = kind === "buy" ? r.buys : r.sells;
          return (
            <Link
              key={r.ticker}
              href={`/stock/${r.ticker}?market=us`}
              className="group flex items-center gap-2 rounded-md px-1.5 py-1 transition hover:bg-surface-2"
            >
              <span className="tnum w-12 shrink-0 text-[12px] font-semibold text-ink group-hover:text-accent">{r.ticker}</span>
              <span className="flex-1 truncate text-[12px] text-muted">{r.name}</span>
              <span className="tnum shrink-0 text-[10px] text-faint">{t(`${r.n}持`, `${r.n} hold`)}</span>
              <span className={`tnum w-12 shrink-0 text-right text-[11px] font-medium ${tone === "up" ? "text-up" : "text-down"}`}>
                {tone === "up" ? "+" : "−"}{cnt}{t(" 位", "")}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
