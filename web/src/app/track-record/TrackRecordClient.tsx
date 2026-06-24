"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

// 判读后表现:前端直读 GitHub data-live 分支的 judgment-perf.json(每 5 分钟由免费的 GitHub Actions 重算)。
// 关键:fetch 直连 raw.githubusercontent(数据 GitHub → 用户,不经 Vercel 函数 / 带宽)= 真·零 Vercel 成本。
const PERF_URL = "https://raw.githubusercontent.com/leslieshen1/leslie-stock/data-live/judgment-perf.json";

type Bucket = { label: string; avgScore: number; ret: number; excess: number; n: number };
type Perf = { anchor: string; asOf: number; n: number; market: number; buckets: Bucket[] };

function fmtPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}
function sgn(v: number): string {
  return v > 0.005 ? "text-up" : v < -0.005 ? "text-down" : "text-faint";
}

export default function TrackRecordClient() {
  const { t, lang } = useLang();
  const [data, setData] = useState<Perf | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "pending" | "err">("loading");

  useEffect(() => {
    let alive = true;
    fetch(PERF_URL, { cache: "no-store" })
      .then((r) => {
        if (r.status === 404) throw new Error("pending");
        if (!r.ok) throw new Error("http");
        return r.json();
      })
      .then((j: Perf) => {
        if (!alive) return;
        if (!j?.buckets?.length) throw new Error("empty");
        setData(j);
        setState("ok");
      })
      .catch((e) => {
        if (!alive) return;
        setState(e.message === "pending" || e.message === "empty" ? "pending" : "err");
      });
    return () => {
      alive = false;
    };
  }, []);

  if (state === "loading") {
    return <div className="py-16 text-center text-sm text-faint">{t("加载中…", "Loading…")}</div>;
  }
  if (state === "pending") {
    return (
      <div className="rounded-2xl border border-line bg-surface px-6 py-10 text-center">
        <div className="text-sm text-ink">{t("数据生成中", "Generating…")}</div>
        <div className="mt-1.5 text-xs text-faint">
          {t("首批表现快照将在下一次自动更新后出现(每 5 分钟一次)。", "The first snapshot appears after the next auto-refresh (every 5 min).")}
        </div>
      </div>
    );
  }
  if (state === "err" || !data) {
    return <div className="py-16 text-center text-sm text-faint">{t("暂时取不到数据,稍后再试。", "Data unavailable, try again later.")}</div>;
  }

  const days = Math.max(1, Math.round((data.asOf - new Date(data.anchor + "T20:00:00+08:00").getTime()) / 86400000));
  const asOf = new Date(data.asOf);
  const asOfStr = `${asOf.getMonth() + 1}/${asOf.getDate()} ${String(asOf.getHours()).padStart(2, "0")}:${String(asOf.getMinutes()).padStart(2, "0")}`;
  const top = data.buckets[0];
  const maxAbs = Math.max(0.01, ...data.buckets.map((b) => Math.abs(b.excess)));

  // 一句话客观结论:高分档超额是正/负/几乎为零 —— 不吹不贬,照数据说。
  const verdict =
    top.excess > 0.3
      ? t(`目前高分档比大盘多涨 ${top.excess.toFixed(2)} 个百分点。`, `So far the top bucket beats the market by ${top.excess.toFixed(2)} pts.`)
      : top.excess < -0.3
        ? t(`目前高分档跑输大盘 ${Math.abs(top.excess).toFixed(2)} 个百分点。`, `So far the top bucket trails the market by ${Math.abs(top.excess).toFixed(2)} pts.`)
        : t("目前高分档和大盘基本打平,看不出差别。", "So far the top bucket is basically flat vs the market — no edge yet.");

  return (
    <div className="space-y-5">
      {/* 概览条 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { k: t("冻结判读日", "Frozen on"), v: data.anchor, sub: t(`已 ${days} 天`, `${days} days ago`) },
          { k: t("跟踪样本", "Tracked"), v: `${data.n.toLocaleString()}`, sub: t("只美股", "US stocks") },
          { k: t("大盘等权基准", "Market (eq-wt)"), v: fmtPct(data.market), sub: t("全样本平均涨幅", "avg of all"), color: sgn(data.market) },
          { k: t("截至", "As of"), v: asOfStr, sub: t("每 5 分钟更新", "updates every 5 min") },
        ].map((c) => (
          <div key={c.k} className="rounded-xl border border-line bg-surface px-3.5 py-3">
            <div className="text-[11px] text-faint">{c.k}</div>
            <div className={`mt-1 text-lg font-semibold tabular-nums ${c.color || "text-ink"}`}>{c.v}</div>
            <div className="text-[11px] text-faint">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* 结论一句话 */}
      <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink">{verdict}</div>

      {/* 分档表 */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="grid grid-cols-[1.4fr_0.7fr_0.9fr_1.5fr] gap-2 border-b border-line px-4 py-2.5 text-[11px] font-medium text-faint">
          <div>{t("五方分档", "Score bucket")}</div>
          <div className="text-right">{t("平均分", "Avg")}</div>
          <div className="text-right">{t("判读后涨幅", "Return")}</div>
          <div className="text-right">{t("超额 vs 大盘", "Excess vs market")}</div>
        </div>
        {data.buckets.map((b, i) => (
          <div
            key={b.label}
            className={`grid grid-cols-[1.4fr_0.7fr_0.9fr_1.5fr] items-center gap-2 px-4 py-3 ${i > 0 ? "border-t border-line" : ""}`}
          >
            <div>
              <div className="text-sm text-ink">{b.label}</div>
              <div className="text-[11px] text-faint">{b.n} {t("只", "stocks")}</div>
            </div>
            <div className="text-right text-sm tabular-nums text-muted">{b.avgScore}</div>
            <div className={`text-right text-sm font-medium tabular-nums ${sgn(b.ret)}`}>{fmtPct(b.ret)}</div>
            {/* 超额:从中线 0 向两侧发散的条 */}
            <div className="flex items-center justify-end gap-2">
              <div className="relative hidden h-1.5 w-24 sm:block">
                <div className="absolute left-1/2 top-0 h-full w-px bg-line" />
                <div
                  className={`absolute top-0 h-full rounded-full ${b.excess >= 0 ? "left-1/2 bg-up" : "right-1/2 bg-down"}`}
                  style={{ width: `${(Math.abs(b.excess) / maxAbs) * 50}%` }}
                />
              </div>
              <div className={`w-14 text-right text-sm font-semibold tabular-nums ${sgn(b.excess)}`}>{fmtPct(b.excess)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 诚实边界 —— 不美化、不自贬,照实说 */}
      <div className="space-y-2 rounded-2xl border border-line bg-surface-2 px-4 py-4 text-xs leading-relaxed text-muted">
        <div className="font-medium text-ink">{t("怎么读这张表", "How to read this")}</div>
        <p>
          {t(
            `判读分在 ${data.anchor} 当天锁死,之后不回看、不改分;表里的涨幅是从那天收盘价到现在的真实变化。这是前瞻测试,不是事后挑出来的好票。`,
            `Scores were frozen on ${data.anchor} and never revised. Returns run from that day's close to now — a forward test, not cherry-picked hindsight.`,
          )}
        </p>
        <p>
          {t(
            `窗口只有 ${days} 天,太短。价值判断要数月到数年才见分晓,现在高分和大盘打平、甚至略输都正常,不能据此说"高分一定涨更多"。`,
            `The window is only ${days} days — far too short. Value takes months to years to play out; a flat or slightly-negative edge now means nothing yet.`,
          )}
        </p>
        <p>{t("数据每 5 分钟自动重算,直接来自公开仓库。这是表现追踪,不是投资建议。", "Recomputed every 5 min from a public repo. This is performance tracking, not investment advice.")}</p>
      </div>
    </div>
  );
}
