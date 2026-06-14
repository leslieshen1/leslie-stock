"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
} from "recharts";
import type {
  Analysis, AleabitSignal, AnalysisVersion, FinancialQuarter, RecentEvent,
} from "@/lib/data";
import { INDUSTRIES, type IndustryId } from "@/lib/supply-chain";
import { type TickerHolder, CHANGE_META, TYPE_META } from "@/lib/whales-types";

// 从 INDUSTRIES.tickers 反查 + sector 关键词 fallback
const SECTOR_KW: { kw: string[]; id: IndustryId; emoji: string; name: string }[] = [
 { kw: ["稀有", "金属", "锗", "稀土", "钨", "钽", "锡", "铟"], id: "rare-metals", emoji: "", name: "稀有 / 战略金属" },
 { kw: ["军工", "国防", "航发", "导弹", "雷达"], id: "defense", emoji: "", name: "国防 / 军工" },
 { kw: ["医药", "生物", "CRO", "医械"], id: "biotech", emoji: "", name: "生物医药" },
 { kw: ["机器人", "humanoid", "人形"], id: "humanoid", emoji: "", name: "人形机器人" },
];

function lookupIndustry(code: string, sector?: string): { id: IndustryId; emoji: string; name: string } {
  // 优先看 INDUSTRIES.tickers
  for (const ind of INDUSTRIES) {
    if (ind.tickers?.includes(code)) {
      return { id: ind.id, emoji: ind.emoji, name: ind.name };
    }
  }
  // fallback by sector keywords
 const s = (sector || "").toLowerCase();
  for (const m of SECTOR_KW) {
    if (m.kw.some((k) => s.includes(k.toLowerCase()))) {
      return { id: m.id, emoji: m.emoji, name: m.name };
    }
  }
 return { id: "AI", emoji: "", name: "AI 产业链" };
}

type Props = {
  code: string;
 market: "a" | "hk" | "us";
  initial: Analysis | null;
  holders?: TickerHolder[];
  hasPanel?: boolean;
};

export default function StockDetailClient({ code, market, initial, holders = [], hasPanel = false }: Props) {
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);

  if (!initial) {
    const marketLabel = market === "a" ? "A 股" : market === "hk" ? "港股" : "美股";
    const isSH = market === "a" && code.startsWith("6");
    const xqSym = market === "a" ? `${isSH ? "SH" : "SZ"}${code}` : code;
    const links: { label: string; href: string }[] =
      market === "us"
        ? [
            { label: "雪球", href: `https://xueqiu.com/S/${code}` },
            { label: "Yahoo Finance", href: `https://finance.yahoo.com/quote/${code}` },
            { label: "TradingView", href: `https://www.tradingview.com/symbols/${code}/` },
          ]
        : market === "hk"
        ? [
            { label: "雪球", href: `https://xueqiu.com/S/${code}` },
            { label: "富途", href: `https://www.futunn.com/stock/${code}-HK` },
          ]
        : [
            { label: "雪球", href: `https://xueqiu.com/S/${xqSym}` },
            { label: "东方财富", href: `https://quote.eastmoney.com/${isSH ? "sh" : "sz"}${code}.html` },
          ];

    return (
      <div className="space-y-8">
        <section className="rounded-2xl border border-line bg-surface p-8 text-center">
          <p className="mb-1.5 text-base font-medium text-ink">{hasPanel ? "外部资料 & 持仓" : "暂无深度分析"}</p>
          <p className="mx-auto mb-6 max-w-md text-sm leading-relaxed text-muted">
            {hasPanel
              ? "五方独立判读见上。也可以去这些地方核对行情与基本面:"
              : `深度分析目前重点覆盖 A 股，${marketLabel}标的还在排队。先去这些地方看行情与基本面：`}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {links.map((l) => (
              <a
                key={l.label}
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-line bg-surface-2 px-3.5 py-1.5 text-sm text-ink transition hover:border-accent/40 hover:text-accent"
              >
                {l.label} ↗
              </a>
            ))}
            <Link
              href="/"
              className="rounded-lg border border-line px-3.5 py-1.5 text-sm text-muted transition hover:text-ink"
            >
              ← 回热力图
            </Link>
          </div>
        </section>

        {/* 即使没有深度分析，也展示已收录的聪明钱持仓（美股大票常有 13F / 议员数据） */}
        {holders.length > 0 && <HoldersSection holders={holders} market={market} />}
      </div>
    );
  }

  const a = initial.aleabit;
  const history = initial.analyses_history || [];
 const serenityHistory = history.filter((h) => h.framework === "serenity");
  const latestSerenity = serenityHistory[serenityHistory.length - 1];

  // 选中版本（默认最新）
  const currentVersion = useMemo(() => {
    if (selectedVersion) {
      const v = serenityHistory.find((h) => h.version === selectedVersion);
      if (v) return v;
    }
    return latestSerenity || null;
  }, [selectedVersion, serenityHistory, latestSerenity]);

  const score = currentVersion?.score ?? a?.bottleneck_score ?? 0;
 const verdict = currentVersion?.verdict_label || a?.verdict_label || "";
 const layer = currentVersion?.layer_label || a?.layer_label || "";
 const thesis = currentVersion?.thesis || a?.thesis || "";
  const signals = a?.signals || [];
  const redFlags = currentVersion?.red_flags || a?.red_flags || [];
  const signalsHit = currentVersion?.signals_hit || a?.signals_hit || 0;

  const mc = initial.raw_quote?.market_cap as number | null | undefined;
  const pe = initial.raw_quote?.pe_ttm as number | null | undefined;
  const pb = initial.raw_quote?.pb as number | null | undefined;
 const mcStr = mc ? `${(mc / 1e8).toFixed(1)} 亿` : "—";

  const ticker = code; // for external links
 const isSH = market === "a" && code.startsWith("6");
 const xueqiuPrefix = market === "a" ? (isSH ? "SH" : "SZ") : market === "hk" ? "" : "";
 const eastPrefix = isSH ? "SH" : "SZ";

  // 产业链热力图跳转
  const ind = lookupIndustry(code, initial.sector);
  const heatmapHref = `/?industry=${ind.id}&highlight=${code}`;

  return (
 <div className="space-y-8">
      {/* ============ HERO ============ */}
 <section className={`rounded-2xl border bg-surface ${hasPanel ? "border-line p-6" : "border-line p-8"}`}>
        {/* 有五方面板时,瓶颈分只是其中一方(Serenity)的专项视角,降权不再当主评分 */}
        {hasPanel && (
          <header className="mb-4 flex items-baseline gap-2">
            <h2 className="text-base font-semibold text-ink">Serenity · 瓶颈狙击</h2>
            <span className="text-xs text-muted">五方中专看产业链「卡脖子」环节的一方 —— 多数公司本就不在这条线上</span>
          </header>
        )}
 <div className="grid grid-cols-1 gap-6 md:grid-cols-[auto_1fr] md:items-start">
          {/* 评分(有五方面板时缩小、改标签) */}
 <div className="flex items-center gap-6">
 <div className="text-center">
              <div className={`font-mono font-bold tracking-tight ${scoreColor(score)} ${hasPanel ? "text-4xl" : "text-6xl"}`}>
 {score || "—"}
              </div>
 <div className="mt-1 text-xs uppercase tracking-wider text-faint">
                {hasPanel ? "瓶颈分" : "Bottleneck Score"}
              </div>
            </div>
 <div className={`w-px bg-line ${hasPanel ? "h-14" : "h-20"}`} />
            <div>
 <p className="text-xs uppercase tracking-wider text-faint">Signals</p>
 <p className={`mt-1 font-mono font-semibold text-ink ${hasPanel ? "text-2xl" : "text-3xl"}`}>
 {signalsHit}<span className="text-base text-faint">/{signals.length || 6}</span>
              </p>
 <p className="mt-3 text-xs uppercase tracking-wider text-faint">Red Flags</p>
 <p className={`mt-1 font-mono font-semibold text-down ${hasPanel ? "text-xl" : "text-2xl"}`}>
                {redFlags.length}
              </p>
            </div>
          </div>

          {/* 右侧文字 */}
          <div>
            {verdict && (
 <p className="mb-3 text-2xl font-semibold leading-snug text-ink">
                {verdict}
              </p>
            )}
            {layer && (
 <p className="mb-4 text-sm leading-relaxed text-accent">
                {layer}
              </p>
            )}
 <div className="flex flex-wrap items-center gap-4 text-sm">
 <span className="text-muted">市值 <span className="font-mono text-ink">{mcStr}</span></span>
 {pe != null && <span className="text-muted">PE <span className="font-mono text-ink">{pe.toFixed(1)}</span></span>}
 {pb != null && <span className="text-muted">PB <span className="font-mono text-ink">{pb.toFixed(1)}</span></span>}
 {initial.sector && <span className="text-muted">{initial.sector}</span>}
            </div>

            {/* 产业链热力图入口 — 最显眼，蓝紫色 */}
 <div className="mt-5 flex flex-wrap items-center gap-2">
              <Link
                href={heatmapHref}
 className="group inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                title={`在「${ind.name}」热力图中查看`}
              >
                                <span>在「{ind.name}」热力图查看</span>
 <span className="opacity-70 transition group-hover:translate-x-0.5">→</span>
              </Link>
            </div>

            {/* External links */}
 <div className="mt-3 flex flex-wrap gap-2">
 <ExtLink href={`http://www.cninfo.com.cn/new/disclosure/stock?stockCode=${ticker}`} label="巨潮 F10" />
 {market === "a" && (
                <>
 <ExtLink href={`https://xueqiu.com/S/${xueqiuPrefix}${ticker}`} label="雪球" />
 <ExtLink href={`https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/Index?type=web&code=${eastPrefix}${ticker}`} label="东方财富 F10" />
                </>
              )}
 {market === "hk" && <ExtLink href={`https://xueqiu.com/S/${ticker}`} label="雪球 HK" />}
 {market === "us" && <ExtLink href={`https://xueqiu.com/S/${ticker}`} label="雪球 US" />}
            </div>
          </div>
        </div>
      </section>

      {/* ============ 评分演化 Timeline ============ */}
      {serenityHistory.length > 1 && (
 <section className="rounded-2xl border border-line bg-surface p-6">
 <header className="mb-5 flex items-baseline justify-between">
 <h2 className="text-base font-semibold text-ink"> 评分演化</h2>
 <p className="text-xs text-muted">
              {serenityHistory.length} 个版本 · 点击切换查看历史 thesis
            </p>
          </header>
          <VersionTimeline
            versions={serenityHistory}
            current={currentVersion}
            onSelect={(v) => setSelectedVersion(v)}
          />
        </section>
      )}

      {/* ============ 当前 thesis ============ */}
      {thesis && (
 <section className="rounded-2xl border border-accent/30 bg-surface p-6">
 <header className="mb-4 flex items-baseline justify-between">
 <h2 className="text-base font-semibold text-ink">
 Thesis {currentVersion && <span className="ml-2 text-xs text-accent">({currentVersion.version})</span>}
            </h2>
            {currentVersion && (
 <p className="text-xs text-muted">
 {currentVersion.model || "—"} · {(currentVersion.created_at || "").slice(0, 10)}
              </p>
            )}
          </header>
 <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-ink">
            {thesis}
          </div>
        </section>
      )}

      {/* ============ Signals 网格 ============ */}
      {signals.length > 0 && (
 <section className="rounded-2xl border border-line bg-surface p-6">
 <header className="mb-5 flex items-baseline justify-between">
 <h2 className="text-base font-semibold text-ink">✓ 瓶颈信号</h2>
 <p className="text-xs text-muted">
 命中 <span className="font-mono font-semibold text-up">{signalsHit}</span> / {signals.length}
            </p>
          </header>
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {signals.map((s, i) => (
              <SignalCard key={i} s={s} />
            ))}
          </div>
        </section>
      )}

      {/* ============ Red Flags ============ */}
      {redFlags.length > 0 && (
 <section className="rounded-2xl border border-down/30 bg-down-soft/60 p-6">
 <header className="mb-4">
 <h2 className="text-base font-semibold text-down"> Red Flags</h2>
 <p className="text-xs text-down">{currentVersion?.version || "—"} 标注的风险点（{redFlags.length} 条）</p>
          </header>
 <ul className="space-y-2.5">
            {redFlags.map((f, i) => (
 <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-down">
 <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-down" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ============ 谁在持仓 ============ */}
      <HoldersSection holders={holders} market={market} />

      {/* ============ 财务面 ============ */}
      {initial.financials?.quarters && initial.financials.quarters.length > 0 && (
        <FinancialsSection quarters={initial.financials.quarters} />
      )}

      {/* ============ 关键公告 ============ */}
      {initial.recent_events && initial.recent_events.length > 0 && (
        <EventsSection events={initial.recent_events} code={code} market={market} />
      )}

      {/* ============ AI 资本支出关联（如有）============ */}
      {a?.ai_relevance && (
 <section className="rounded-2xl border border-line bg-surface-2/60 p-6">
 <h2 className="mb-2 text-base font-semibold text-accent"> AI 资本支出关联</h2>
 <p className="text-sm leading-relaxed text-accent">{a.ai_relevance}</p>
        </section>
      )}

      {/* ============ Disclaimer ============ */}
 <p className="text-center text-xs text-faint">
        基于 Serenity / 段巴 BG / aleabit 公开框架的风格复刻 · NOT 投资建议 ·
        数据源：巨潮 公告 + Tushare 财务 + 手动 fact-check
      </p>
    </div>
  );
}

// ============================================================
// 版本时间线
// ============================================================

function VersionTimeline({
  versions, current, onSelect,
}: {
  versions: AnalysisVersion[];
  current: AnalysisVersion | null;
  onSelect: (v: string) => void;
}) {
  return (
    <div>
 <div className="flex flex-wrap items-stretch gap-2">
        {versions.map((v, i) => {
          const isCurrent = current?.version === v.version;
          const prev = versions[i - 1];
          const delta = prev && v.score != null && prev.score != null ? v.score - prev.score : null;
          return (
            <button
              key={v.version}
              onClick={() => onSelect(v.version)}
              className={`flex-1 min-w-[140px] rounded-xl border p-3 text-left transition ${
                isCurrent
 ? "border-accent/30 bg-surface-2 "
 : "border-line bg-surface hover:border-line-2 hover:bg-surface-2"
              }`}
            >
 <div className="flex items-baseline justify-between">
 <span className={`font-mono text-xs uppercase tracking-wider ${isCurrent ? "text-accent" : "text-faint"}`}>
                  {v.version}
                </span>
                {delta !== null && delta !== 0 && (
 <span className={`font-mono text-xs ${delta > 0 ? "text-up" : "text-down"}`}>
 {delta > 0 ? "+" : ""}{delta}
                  </span>
                )}
              </div>
              <div className={`mt-1 font-mono text-2xl font-semibold ${scoreColor(v.score || 0)}`}>
 {v.score ?? "—"}
              </div>
 <div className="mt-1 line-clamp-2 text-xs leading-snug text-muted">
                {v.verdict_label}
              </div>
 <div className="mt-2 font-mono text-[10px] text-faint">
 {(v.created_at || "").slice(0, 10)}
 {v.pre_labeled && <span className="ml-1 text-accent">[pre]</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Signal Card
// ============================================================

function SignalCard({ s }: { s: AleabitSignal }) {
 const hit = s.hit === "yes" || (s.hit as unknown) === true || (s.hit as unknown) === 1;
 const partial = s.hit === "partial";
 const icon = hit ? "✓" : partial ? "◐" : "✗";
  const tone = hit
 ? "border-up/30 bg-up-soft/60"
    : partial
 ? "border-accent/30 bg-accent-soft/60"
 : "border-line bg-surface/60";
  const iconTone = hit
 ? "bg-up text-white"
    : partial
 ? "bg-accent text-white"
 : "bg-line-2 text-ink";

  // v2+ 用了 evidence 字段
  const evidence = (s as unknown as { evidence?: string }).evidence;
  const note = evidence || s.note;

  return (
    <div className={`flex items-start gap-3 rounded-xl border p-3 ${tone}`}>
      <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${iconTone}`}>
        {icon}
      </span>
 <div className="min-w-0 flex-1">
 <p className="text-sm font-medium text-ink">{s.name}</p>
 {note && <p className="mt-1 text-xs leading-relaxed text-muted">{note}</p>}
      </div>
    </div>
  );
}

// ============================================================
// 谁在持仓（聪明钱）
// ============================================================

function HoldersSection({ holders, market }: { holders: TickerHolder[]; market: string }) {
  if (holders.length === 0) {
    // 空 = 信号:机构白马不碰,纯题材/游资盘（A 股 meme 视角）
    return (
 <section className="rounded-2xl border border-line bg-surface p-6">
 <h2 className="mb-2 text-base font-semibold text-ink"> 谁在持仓</h2>
 <p className="text-sm leading-relaxed text-muted">
 {market === "a"
 ? "顶流基金 / 名人持仓里暂未出现这只 —— 机构白马不重仓,偏题材 / 游资盘(meme game 的典型特征)。"
 : "暂无已收录的名人 / 机构持仓数据。"}
        </p>
      </section>
    );
  }

  const maxPct = Math.max(...holders.map((h) => h.pct || 0), 1);

  return (
 <section className="rounded-2xl border border-line bg-surface p-6">
 <header className="mb-4 flex items-baseline justify-between">
 <h2 className="text-base font-semibold text-ink"> 谁在持仓</h2>
 <Link href="/whales" className="text-xs text-accent hover:underline">
          全部聪明钱 →
        </Link>
      </header>
 <div className="space-y-2.5">
        {holders.map((h, i) => {
 const cm = CHANGE_META[h.change_type || "hold"];
          const tm = TYPE_META[h.type];
 const isPolitician = h.type === "politician";
          const barW = ((h.pct || 0) / maxPct) * 100;
          // 议员:买卖方向色
 const buy = h.change_type === "add" || h.change_type === "new";
 const sell = h.change_type === "trim" || h.change_type === "exit";
          return (
 <div key={i} className="flex items-center gap-3">
              <Link
                href={`/whales`}
 className="w-28 shrink-0 truncate text-sm font-medium text-ink hover:text-accent"
 title={h.entity || ""}
              >
 <span className="text-[10px] text-faint">{tm.label}</span> {h.investor}
              </Link>
              {isPolitician ? (
                <>
                  <span className={`w-12 shrink-0 rounded border px-1 py-0.5 text-center text-[10px] font-medium ${
 buy ? "bg-up-soft text-up border-up/30"
 : sell ? "bg-down-soft text-down border-down/30"
 : "bg-surface text-muted border-line"}`}>
 {buy ? "买入" : sell ? "卖出" : "持有"}
                  </span>
 <span className="flex-1 font-mono text-xs text-muted">{h.amount_range}</span>
 <span className="shrink-0 font-mono text-[10px] text-faint">{h.trade_date}</span>
                </>
              ) : (
                <>
 <div className="relative h-5 flex-1 overflow-hidden rounded bg-surface-2">
                    <div
                      className={`absolute inset-y-0 left-0 rounded ${
 h.type === "superinvestor" ? "bg-blue-400/70" : "bg-accent/70"
                      }`}
                      style={{ width: `${barW}%` }}
                    />
                  </div>
 <span className="w-12 shrink-0 text-right font-mono text-sm text-muted">{h.pct}%</span>
                  <span className={`w-14 shrink-0 rounded border px-1 py-0.5 text-center text-[10px] font-medium ${cm.tone}`}>
                    {cm.label}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
 {holders.some((h) => (h.pct || 0) < 1 && h.type === "superinvestor") && (
 <p className="mt-3 text-xs text-faint">
           占比 &lt;1% 多为试探仓 / 研究标记,非重仓 conviction —— 看占比,别看名单。
        </p>
      )}
    </section>
  );
}

// ============================================================
// 财务面（8 季 + chart + table）
// ============================================================

function FinancialsSection({ quarters }: { quarters: FinancialQuarter[] }) {
  const data = useMemo(
    () =>
      [...quarters].reverse().map((q) => ({
 period: q.period.slice(2, 6) + "Q" + Math.ceil(parseInt(q.period.slice(4, 6)) / 3),
        rawPeriod: q.period,
        revenue: q.revenue ? Math.round(q.revenue / 1e8 * 100) / 100 : null,
        roe: q.roe,
        net_margin: q.net_margin,
        gross_margin: q.gross_margin,
        or_yoy: q.or_yoy,
        debt: q.debt_to_assets,
      })),
    [quarters]
  );

  return (
 <section className="rounded-2xl border border-line bg-surface p-6">
 <header className="mb-5 flex items-baseline justify-between">
 <h2 className="text-base font-semibold text-ink"> 财务面（{quarters.length} 季）</h2>
 <p className="text-xs text-muted">来源 Tushare fina_indicator + income</p>
      </header>

 <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 营收 + YoY% */}
        <div>
 <p className="mb-1 text-xs font-medium text-muted">营收（亿元） + YoY%</p>
 <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -20 }}>
 <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
 <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#a1a1aa" }} />
 <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} />
              <Tooltip
 formatter={(v, n) => [v as number, n === "revenue" ? "营收(亿)" : (n as string)]}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
 <Bar dataKey="revenue" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* ROE + 净利率 + 毛利率 */}
        <div>
 <p className="mb-1 text-xs font-medium text-muted">ROE · 净利率 · 毛利率（%）</p>
 <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -20 }}>
 <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
 <XAxis dataKey="period" tick={{ fontSize: 11, fill: "#a1a1aa" }} />
 <YAxis tick={{ fontSize: 11, fill: "#a1a1aa" }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
 <ReferenceLine y={0} stroke="#e4e4e7" />
 <Line type="monotone" dataKey="roe" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="ROE" />
 <Line type="monotone" dataKey="net_margin" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} name="净利率" />
 <Line type="monotone" dataKey="gross_margin" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="毛利率" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 表格 */}
 <div className="mt-6 overflow-x-auto">
 <table className="w-full min-w-[640px] text-sm">
          <thead>
 <tr className="border-b border-line text-left text-xs text-muted">
 <th className="py-2 pr-3">Period</th>
 <th className="py-2 pr-3 text-right">营收 (亿)</th>
 <th className="py-2 pr-3 text-right">YoY%</th>
 <th className="py-2 pr-3 text-right">净利率%</th>
 <th className="py-2 pr-3 text-right">毛利率%</th>
 <th className="py-2 pr-3 text-right">ROE%</th>
 <th className="py-2 pr-3 text-right">负债率%</th>
            </tr>
          </thead>
          <tbody>
            {quarters.map((q) => (
 <tr key={q.period} className="border-b border-line text-muted">
 <td className="py-2 pr-3 font-mono text-xs">{q.period}</td>
 <td className="py-2 pr-3 text-right font-mono">{fmtYi(q.revenue)}</td>
                <td className={`py-2 pr-3 text-right font-mono ${signedColor(q.or_yoy)}`}>{fmtNum(q.or_yoy, 1)}</td>
                <td className={`py-2 pr-3 text-right font-mono ${signedColor(q.net_margin)}`}>{fmtNum(q.net_margin, 1)}</td>
 <td className="py-2 pr-3 text-right font-mono">{fmtNum(q.gross_margin, 1)}</td>
 <td className="py-2 pr-3 text-right font-mono">{fmtNum(q.roe, 1)}</td>
 <td className="py-2 pr-3 text-right font-mono">{fmtNum(q.debt_to_assets, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ============================================================
// 公告 events
// ============================================================

const TIER_META = {
 1: { label: "业绩 / 资本运作", color: "rose", emoji: "" },
 2: { label: "产能 / 战略合作", color: "amber", emoji: "" },
 3: { label: "股东动作", color: "blue", emoji: "" },
 4: { label: "风险", color: "zinc", emoji: "" },
 5: { label: "IR / 调研记录", color: "violet", emoji: "" },
} as const;

function EventsSection({ events, code, market }: { events: RecentEvent[]; code: string; market: string }) {
  const grouped = useMemo(() => {
    const g: Record<number, RecentEvent[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    for (const e of events) g[e.tier]?.push(e);
    return g;
  }, [events]);

  return (
 <section className="rounded-2xl border border-line bg-surface p-6">
 <header className="mb-5 flex items-baseline justify-between">
 <h2 className="text-base font-semibold text-ink"> 关键公告（最近 1 年）</h2>
 <p className="text-xs text-muted">
          共 {events.length} 条 · 数据源：巨潮资讯（Tushare anns_d）
        </p>
      </header>

 <div className="space-y-5">
        {[1, 2, 3, 4, 5].map((tier) => {
          const items = grouped[tier];
          if (!items || items.length === 0) return null;
          const meta = TIER_META[tier as 1 | 2 | 3 | 4 | 5];
          return (
            <div key={tier}>
 <div className="mb-2 flex items-center gap-2">
 <h3 className="text-sm font-semibold text-muted">
                  Tier {tier} — {meta.label}
                </h3>
 <span className="font-mono text-xs text-faint">{items.length} 条</span>
              </div>
 <ul className="space-y-1.5">
                {items.slice(0, 12).map((e, i) => (
                  <EventRow key={i} event={e} />
                ))}
              </ul>
              {items.length > 12 && (
 <p className="mt-2 font-mono text-xs text-faint">
                  +{items.length - 12} 条更多（去巨潮 F10 看完整列表）
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EventRow({ event }: { event: RecentEvent }) {
  const link = event.pdf_url || event.url;
  return (
 <li className="flex items-center gap-3 rounded-lg py-1 px-2 text-sm transition hover:bg-surface-2">
 <span className="shrink-0 text-xs">{event.pdf_url ? "" : ""}</span>
 <span className="shrink-0 font-mono text-xs text-faint">{event.ann_date}</span>
      <a
        href={link}
 target="_blank"
 rel="noopener noreferrer"
 className="min-w-0 flex-1 truncate text-muted hover:text-accent hover:underline"
        title={event.title}
      >
        {event.title}
      </a>
      {event.keyword && (
 <span className="hidden shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline-block">
          {event.keyword}
        </span>
      )}
    </li>
  );
}

// ============================================================
// 小工具
// ============================================================

function ExtLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted transition hover:border-line-2 hover:text-ink"
    >
 {label} <span className="text-faint">↗</span>
    </a>
  );
}

function scoreColor(score: number): string {
 if (score >= 90) return "text-accent";
 if (score >= 80) return "text-up";
 if (score >= 70) return "text-accent";
 if (score >= 50) return "text-orange-600";
 return "text-muted";
}

function signedColor(v: number | null | undefined): string {
 if (v == null) return "text-faint";
 if (v > 0) return "text-up";
 if (v < 0) return "text-down";
 return "text-muted";
}

function fmtYi(v: number | null | undefined): string {
 if (v == null) return "—";
  return v.toFixed(2);
}

function fmtNum(v: number | null | undefined, decimals = 2): string {
 if (v == null) return "—";
  return v.toFixed(decimals);
}
