"use client";

// 板块热力 · 双面板:左=美股(盘前/盘中/盘后),右=A股(今日涨跌)。
// 每个面板各按"自己市场"的真实市值排序与定高(不强行左右对齐 —— A 股工业/材料该大就大,不再镜像美股);
// 大板块可展开看子板块:美股=AI算力/存储/光模块…(数据层 sub),A股=申万子行业(api 聚合)。颜色=涨跌、市值加权。
import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

type Cellv = number | null;
type GRow = { sector: string; capB: number; vals: Cellv[]; subs?: GRow[] };

// ---- API 原始结构 ----
type USub = { sector: string; capB: number; pre?: Cellv; mid?: Cellv; post?: Cellv; d7?: Cellv; d30?: Cellv };
type URow = { sector: string; capB: number; pre: Cellv; mid: Cellv; post: Cellv; d7?: Cellv; d30?: Cellv; subs?: USub[] };
type ASub = { sector: string; capB: number; pct: number; d7?: Cellv; d30?: Cellv };
type ARow = { sector: string; capB: number; pct: number; d7?: Cellv; d30?: Cellv; subs?: ASub[] };
type Resp = { sectors: URow[]; aSectors: ARow[]; session: string; day: string; isToday: boolean };

const SEG_EN: Record<string, string> = {
  科技: "Tech", 金融: "Financials", 工业: "Industrials", 可选消费: "Cons. Disc.", 必需消费: "Cons. Staples",
  医疗: "Health", 材料: "Materials", 能源: "Energy", 通信媒体: "Comm.", 公用事业: "Utilities", 地产: "Real Estate", 其他: "Other",
};
const SESS_EN: Record<string, string> = { 盘前: "Pre", 盘中: "Open", 盘后: "After", 休市: "Closed", 午间休市: "Lunch" };
const SESS_IDX: Record<string, number> = { 盘前: 0, 盘中: 1, 盘后: 2 };

function heat(p: number): { bg: string; fg: string } {
  if (p >= -0.05 && p <= 0.05) return { bg: "hsl(220 6% 27%)", fg: "rgba(255,255,255,.82)" };
  const t = Math.min(1, Math.abs(p) / 3);
  return p < 0
    ? { bg: `hsl(0 ${50 + t * 26}% ${40 - t * 18}%)`, fg: "#fff" }
    : { bg: `hsl(150 ${44 + t * 26}% ${34 - t * 15}%)`, fg: "#fff" };
}
const fp = (p: number) => `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
const fcapUS = (b: number) => (b >= 1000 ? `$${(b / 1000).toFixed(1)}T` : `$${Math.round(b)}B`);
const fcapA = (b: number) => (b >= 10000 ? `¥${(b / 10000).toFixed(1)}万亿` : `¥${Math.round(b)}亿`);

function Cell({ p, live }: { p: Cellv; live?: boolean }) {
  if (p == null) return <div className="flex items-center justify-center rounded-md border border-dashed border-line/40 text-[12px] text-faint/45">—</div>;
  const c = heat(p);
  return (
    <div className={`flex items-center justify-center rounded-md text-[13px] font-medium tnum ${live ? "ring-1 ring-white/30" : ""}`} style={{ background: c.bg, color: c.fg }}>
      {fp(p)}
    </div>
  );
}

// 单个面板:自有排序(传入前已排好)、自有定高、可展开子板块。各面板独立 open 状态。
function HeatPanel({
  title, titleCls, sub, headLabel, cols, liveCol, rows, capFmt, segLabel, live,
}: {
  title: string; titleCls: string; sub: string; headLabel: string;
  cols: string[]; liveCol: number; rows: GRow[];
  capFmt: (b: number) => string; segLabel: (s: string) => string;
  live?: boolean;  // true=该市场此刻交易中(脉动绿「实时」);false=休市(灰);undefined=区间窗口不显示
}) {
  const { t } = useLang();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const grid = `minmax(62px,88px) repeat(${cols.length}, minmax(0,1fr))`;
  const sqrtSum = rows.reduce((s, r) => s + Math.sqrt(Math.max(1, r.capB)), 0) || 1;
  const rowH = (capB: number) => Math.min(74, Math.max(34, Math.round((Math.sqrt(Math.max(1, capB)) / sqrtSum) * 520)));
  const toggle = (s: string) => setOpen((o) => { const n = new Set(o); if (n.has(s)) n.delete(s); else n.add(s); return n; });

  return (
    <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-line bg-base/40 p-2">
      <div className="mb-1.5 flex items-baseline gap-2 px-1">
        <span className={`text-[13px] font-semibold ${titleCls}`}>{title}</span>
        {live !== undefined && (live
          ? <span className="inline-flex items-center gap-1 self-center rounded-full bg-up/10 px-1.5 py-px text-[9px] font-semibold leading-none text-up"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-up" />{t("实时", "LIVE")}</span>
          : <span className="self-center rounded-full bg-surface-3 px-1.5 py-px text-[9px] font-medium leading-none text-faint">{t("休市", "Closed")}</span>)}
        <span className="truncate text-[10px] text-faint">{sub}</span>
      </div>
      <div className="mb-1 grid gap-1 px-1 text-[11px] text-faint" style={{ gridTemplateColumns: grid }}>
        <span className="pl-1">{headLabel}</span>
        {cols.map((c, i) => (
          <span key={c} className={`flex items-center justify-center gap-1 ${i === liveCol ? "font-medium text-up" : ""}`}>
            {i === liveCol && <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-up" />}{c}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((r) => {
          const hasSubs = !!(r.subs && r.subs.length > 1);
          const isOpen = open.has(r.sector);
          return (
            <div key={r.sector} className="flex flex-col gap-1">
              <div className="grid gap-1" style={{ gridTemplateColumns: grid, height: rowH(r.capB) }}>
                <button
                  type="button"
                  onClick={() => hasSubs && toggle(r.sector)}
                  className={`flex flex-col justify-center overflow-hidden rounded-md bg-surface px-2 text-left ${hasSubs ? "cursor-pointer hover:bg-surface-2" : "cursor-default"}`}
                  title={hasSubs ? (isOpen ? "收起子板块" : "展开子板块") : r.sector}
                >
                  <span className="flex items-center gap-1 truncate text-[12px] text-ink">
                    {hasSubs && <span className={`shrink-0 text-[8px] text-faint transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>}
                    <span className="truncate">{segLabel(r.sector)}</span>
                  </span>
                  <span className="text-[10px] text-faint tnum">{capFmt(r.capB)}</span>
                </button>
                {r.vals.map((v, i) => <Cell key={i} p={v} live={i === liveCol} />)}
              </div>
              {isOpen && r.subs!.map((s) => (
                <div key={s.sector} className="grid gap-1 pl-3" style={{ gridTemplateColumns: grid, height: 30 }}>
                  <div className="flex flex-col justify-center overflow-hidden rounded bg-surface/50 px-2">
                    <span className="truncate text-[11px] leading-tight text-muted">{segLabel(s.sector)}</span>
                    <span className="text-[9px] leading-tight text-faint tnum">{capFmt(s.capB)}</span>
                  </div>
                  {s.vals.map((v, i) => <Cell key={i} p={v} live={i === liveCol} />)}
                </div>
              ))}
            </div>
          );
        })}
        {rows.length === 0 && <div className="py-8 text-center text-xs text-faint">—</div>}
      </div>
    </div>
  );
}

// A 股是否在交易时段(中国时间,周一~周五 9:30–11:30 / 13:00–15:00)。客户端按 Asia/Shanghai 计算,与用户本地时区无关。
function aShareLive(): boolean {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
    const wd = p.find((x) => x.type === "weekday")?.value;
    if (wd === "Sat" || wd === "Sun") return false;
    const hh = +(p.find((x) => x.type === "hour")?.value ?? "0") % 24; // 部分实现午夜返回 "24"
    const mm = +(p.find((x) => x.type === "minute")?.value ?? "0");
    const m = hh * 60 + mm;
    return (m >= 570 && m <= 690) || (m >= 780 && m <= 900); // 9:30–11:30, 13:00–15:00
  } catch { return false; }
}

export default function SectorSessions() {
  const { t, lang } = useLang();
  const segLabel = (s: string) => (lang === "en" ? (SEG_EN[s] ?? s) : s);
  const sLabel = (s: string) => (lang === "en" ? (SESS_EN[s] ?? s) : s);
  const [data, setData] = useState<Resp | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/sector-sessions").then((r) => r.json())
        .then((j) => { if (alive) setData(j); })
        .catch(() => { if (alive) setData({ sectors: [], aSectors: [], session: "", day: "", isToday: false }); });
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const [range, setRange] = useState<"today" | "d7" | "d30">("today");
  const us = data?.sectors || null;
  const session = data?.session || "";
  const isToday = !!data?.isToday;

  // 时间窗:今日(美股盘前/盘中/盘后·A股今日)/ 近7天 / 近1月(单列窗口收益;美股有30天历史,A股暂无→—)
  // 美股数据源(Nasdaq screener)只有常规交易时段:盘前/盘后无实时行情 → 今日窗只显示「最近一个真实常规时段」的单列,
  // 诚实标注是实时还是收盘价(别再用三列假装盘前/盘后会动)。盘前=上一收盘,盘中=实时,盘后=今日收盘,休市=最近收盘。
  const usLiveNow = session === "盘中";
  const usCur = (r: { pre: Cellv; mid: Cellv; post: Cellv }): Cellv =>
    session === "盘前" ? r.pre : session === "盘后" ? r.post : session === "盘中" ? r.mid : (r.post ?? r.mid ?? r.pre);
  const usVals = (r: { pre: Cellv; mid: Cellv; post: Cellv; d7?: Cellv; d30?: Cellv }): Cellv[] =>
    range === "d7" ? [r.d7 ?? null] : range === "d30" ? [r.d30 ?? null] : [usCur(r)];
  const usRows: GRow[] = (us || []).map((r) => ({
    sector: r.sector, capB: r.capB, vals: usVals(r),
    subs: r.subs?.map((s) => ({ sector: s.sector, capB: s.capB, vals: usVals({ pre: s.pre ?? null, mid: s.mid ?? null, post: s.post ?? null, d7: s.d7, d30: s.d30 }) })),
  }));
  const aVal = (r: { pct: number; d7?: Cellv; d30?: Cellv }): Cellv[] =>
    range === "d7" ? [r.d7 ?? null] : range === "d30" ? [r.d30 ?? null] : [r.pct];
  const aRows: GRow[] = (data?.aSectors || []).map((r) => ({
    sector: r.sector, capB: r.capB, vals: aVal(r),
    subs: r.subs?.map((s) => ({ sector: s.sector, capB: s.capB, vals: aVal(s) })),
  }));

  const usLiveCol = range === "today" && usLiveNow ? 0 : -1;
  const usCols = range === "d7" ? [t("近7天", "7D")] : range === "d30" ? [t("近1月", "1M")]
    : [usLiveNow ? sLabel("盘中") : session === "盘后" ? t("今日收盘", "Close") : t("上一交易日收盘", "Prev close")];
  const aCols = range === "today" ? [t("今日涨跌", "Change")] : range === "d7" ? [t("近7天", "7D")] : [t("近1月", "1M")];
  const usSub = !us || !us.length ? ""
    : range === "d7" ? t("近 7 个交易日 · 市值加权", "Past 7 sessions · cap-weighted")
    : range === "d30" ? t("近 1 个月 · 市值加权", "Past month · cap-weighted")
    : (usLiveNow ? t("盘中 · 实时", "Regular · live")
       : session === "盘后" ? `${t("今日收盘", "Today's close")} · ${t("此源无盘后实时", "no after-hours feed")}`
       : `${t("上一交易日收盘", "Prev close")} · ${t("此源无盘前实时", "no pre-market feed")}`);
  const aHasWin = (data?.aSectors || []).some((r) => (range === "d7" ? r.d7 : r.d30) != null);
  const aSub = range === "today" ? t("今日 · 腾讯实时", "Today · live")
    : aHasWin ? (range === "d7" ? t("近 7 个交易日 · 市值加权", "Past 7 sessions · cap-weighted") : t("近 1 个月 · 市值加权", "Past month · cap-weighted"))
    : t("趋势待 A 股历史攒够", "trend pending A-share history");

  // 「实时」徽章只在今日窗口有意义。美股只有盘中是真实时(盘前/盘后此源无数据,不亮绿、不显徽章);A股按中国时间。
  const usLive = range === "today" ? (usLiveNow || undefined) : undefined;
  const aLive = range === "today" ? aShareLive() : undefined;

  return (
    <section className="mt-8">
      <header className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="text-lg font-semibold text-ink">{t("板块热力 · 美股 vs A股", "Sector Heat · US vs A-share")}</h2>
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-[11px]">
          {([["today", t("今日", "Today")], ["d7", t("近7天", "7D")], ["d30", t("近1月", "1M")]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setRange(k)} className={`rounded-md px-2.5 py-1 font-medium transition ${range === k ? "bg-surface-3 text-ink" : "text-muted hover:text-ink"}`}>{lbl}</button>
          ))}
        </div>
        <span className="hidden text-xs text-faint sm:inline">{t("各按本市场市值排 · 点板块展开子板块", "each by own-market cap · click to expand")}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-faint">
          {[-3, -1, 0, 1, 3].map((v) => <i key={v} className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: heat(v).bg }} />)}
          <span className="ml-1">−3% → +3%</span>
        </span>
      </header>

      {!us ? (
        <div className="flex h-[360px] items-center justify-center text-sm text-faint">{t("加载板块…", "Loading sectors…")}</div>
      ) : us.length === 0 ? (
        <div className="flex h-[360px] items-center justify-center text-sm text-faint">{t("暂无数据", "No data")}</div>
      ) : (
        // ≥768px 双面板并排用满宽度(收成单列后更怕右侧留白);窄屏堆叠并 items-stretch 撑满,不再 items-start 留白
        <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-start">
          <HeatPanel
            title={t("美股", "US")} titleCls="text-accent" sub={usSub} headLabel={t("板块 · 市值", "Sector · Cap")}
            cols={usCols} liveCol={usLiveCol} live={usLive}
            rows={usRows} capFmt={fcapUS} segLabel={segLabel}
          />
          <HeatPanel
            title={t("A股", "A-share")} titleCls="text-down" sub={aSub} headLabel={t("板块 · 市值", "Sector · Cap")}
            cols={aCols} liveCol={-1} live={aLive}
            rows={aRows} capFmt={fcapA} segLabel={segLabel}
          />
        </div>
      )}

      <p className="mt-1.5 text-[10px] text-faint">
        {t(
          "今日=美股盘前/盘中/盘后·A股今日;近7天/近1月=区间市值加权收益(美股有30天历史;A股趋势待攒够历史再开)· 两侧各按本市场市值排序定高 · 点大板块看子板块 · 非投资建议",
          "Today = US pre/open/after · A-share today; 7D/1M = window cap-weighted return (US has 30d history; A-share trend pending) · each by own-market cap · click to expand · not financial advice",
        )}
      </p>
    </section>
  );
}
