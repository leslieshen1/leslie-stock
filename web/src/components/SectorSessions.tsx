"use client";

// 板块热力 · 双面板对比:左=美股(盘前/盘中/盘后),右=A股(今日涨跌)。
// 两边用同一套 12 大板块(A股由申万 34 行业静态映射而来,见 /api/sector-sessions),按美股市值排、
// 共用同一行高 → 科技对科技对齐排,方便左右比。移动端 flex-col 上下叠。颜色=涨跌、市值加权。
import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

type SKey = "pre" | "mid" | "post";
type Row = { sector: string; capB: number; pre: number | null; mid: number | null; post: number | null };
type ARow = { sector: string; capB: number; pct: number };
type Resp = { sectors: Row[]; aSectors: ARow[]; session: string; day: string; isToday: boolean };

const SKEYS: { k: SKey; label: string }[] = [{ k: "pre", label: "盘前" }, { k: "mid", label: "盘中" }, { k: "post", label: "盘后" }];
// session 中文值是 /api/sector-sessions 口径(也用于 session===label 匹配),只在显示时翻译
const SESS_EN: Record<string, string> = { 盘前: "Pre", 盘中: "Open", 盘后: "After", 休市: "Closed", 实时: "Live", 午间休市: "Lunch" };
const SEG_EN: Record<string, string> = {
  科技: "Tech", 金融: "Financials", 工业: "Industrials", 可选消费: "Cons. Disc.", 必需消费: "Cons. Staples",
  医疗: "Health", 材料: "Materials", 能源: "Energy", 通信媒体: "Comm.", 公用事业: "Utilities", 地产: "Real Estate", 其他: "Other",
};

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

function Cell({ p, live }: { p: number | null; live?: boolean }) {
  if (p == null) return <div className="flex items-center justify-center rounded-md border border-dashed border-line/40 text-[12px] text-faint/45">—</div>;
  const c = heat(p);
  return (
    <div className={`flex items-center justify-center rounded-md text-[13px] font-medium tnum ${live ? "ring-1 ring-white/30" : ""}`} style={{ background: c.bg, color: c.fg }}>
      {fp(p)}
    </div>
  );
}

export default function SectorSessions() {
  const { t, lang } = useLang();
  const sLabel = (s: string) => (lang === "en" ? (SESS_EN[s] ?? s) : s);
  const segLabel = (s: string) => (lang === "en" ? (SEG_EN[s] ?? s) : s);
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

  const us = data?.sectors || null;
  const aArr = data?.aSectors || [];
  const session = data?.session || "";

  // 统一大板块顺序(美股市值序,A 股独有的接尾)+ 共用行高(按该板块美股市值,无则用 A 股)→ 两面板对齐
  const usMap = new Map((us || []).map((x) => [x.sector, x]));
  const aMap = new Map(aArr.map((x) => [x.sector, x]));
  const order = us ? [...us.map((x) => x.sector), ...aArr.filter((x) => !usMap.has(x.sector)).map((x) => x.sector)] : [];
  const capForH = (seg: string) => usMap.get(seg)?.capB ?? aMap.get(seg)?.capB ?? 1;
  const sqrtSum = order.reduce((s, seg) => s + Math.sqrt(Math.max(1, capForH(seg))), 0) || 1;
  const rowH = (seg: string) => Math.min(76, Math.max(34, Math.round((Math.sqrt(Math.max(1, capForH(seg))) / sqrtSum) * 540)));

  const usGrid = "minmax(60px,82px) repeat(3, minmax(0,1fr))";
  const aGrid = "minmax(60px,82px) minmax(0,1fr)";

  const SectorCell = ({ name, cap }: { name: string; cap: string }) => (
    <div className="flex flex-col justify-center overflow-hidden rounded-md bg-surface px-2">
      <span className="truncate text-[12px] leading-tight text-ink">{segLabel(name)}</span>
      <span className="text-[10px] leading-tight text-faint tnum">{cap}</span>
    </div>
  );

  return (
    <section className="mt-8">
      <header className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-ink">{t("板块热力 · 美股 vs A股", "Sector Heat · US vs A-share")}</h2>
        <span className="text-xs text-faint">{t("同12大板块对齐 · 行高=市值 · 颜色=涨跌", "same 12 sectors · height = cap · color = change")}</span>
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
        <div className="flex flex-col gap-3 lg:flex-row">
          {/* 美股面板 */}
          <div className="flex-1 overflow-hidden rounded-2xl border border-line bg-base/40 p-2">
            <div className="mb-1.5 flex items-baseline gap-2 px-1">
              <span className="text-[13px] font-semibold text-accent">{t("美股", "US")}</span>
              <span className="text-[10px] text-faint">
                {session && (data?.isToday ? `${t("当前", "Now")} · ${sLabel(session)}` : `${t("上一交易日", "Prev")} ${data?.day || ""}`)}
              </span>
            </div>
            <div className="mb-1 grid gap-1 px-1 text-[11px] text-faint" style={{ gridTemplateColumns: usGrid }}>
              <span className="pl-1">{t("板块 · 市值", "Sector · Cap")}</span>
              {SKEYS.map((c) => (
                <span key={c.k} className={`flex items-center justify-center gap-1 ${session === c.label ? "font-medium text-up" : ""}`}>
                  {session === c.label && <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-up" />}
                  {sLabel(c.label)}
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              {order.map((seg) => {
                const r = usMap.get(seg);
                return (
                  <div key={seg} className="grid gap-1" style={{ gridTemplateColumns: usGrid, height: rowH(seg) }} title={r ? `${seg} · ${fcapUS(r.capB)}` : seg}>
                    <SectorCell name={seg} cap={r ? fcapUS(r.capB) : "—"} />
                    {SKEYS.map((c) => <Cell key={c.k} p={r?.[c.k] ?? null} live={session === c.label} />)}
                  </div>
                );
              })}
            </div>
          </div>

          {/* A股面板 */}
          <div className="flex-1 overflow-hidden rounded-2xl border border-line bg-base/40 p-2">
            <div className="mb-1.5 flex items-baseline gap-2 px-1">
              <span className="text-[13px] font-semibold text-down">{t("A股", "A-share")}</span>
              <span className="text-[10px] text-faint">{t("今日 · 腾讯实时", "Today · live")}</span>
            </div>
            <div className="mb-1 grid gap-1 px-1 text-[11px] text-faint" style={{ gridTemplateColumns: aGrid }}>
              <span className="pl-1">{t("板块 · 市值", "Sector · Cap")}</span>
              <span className="flex items-center justify-center">{t("今日涨跌", "Change")}</span>
            </div>
            <div className="flex flex-col gap-1">
              {order.map((seg) => {
                const r = aMap.get(seg);
                return (
                  <div key={seg} className="grid gap-1" style={{ gridTemplateColumns: aGrid, height: rowH(seg) }} title={r ? `${seg} · ${fcapA(r.capB)}` : seg}>
                    <SectorCell name={seg} cap={r ? fcapA(r.capB) : "—"} />
                    <Cell p={r?.pct ?? null} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <p className="mt-1.5 text-[10px] text-faint">
        {t(
          "左=美股(盘前/盘中/盘后,当前段实时·过去段定格)· 右=A股(今日,腾讯实时)· 同 12 大板块(A股申万行业映射)· 市值加权 · 非投资建议",
          "Left = US (pre/open/after, current live) · Right = A-share (today, live) · same 12 sectors (A-share mapped from SW industries) · cap-weighted · not financial advice",
        )}
      </p>
    </section>
  );
}
