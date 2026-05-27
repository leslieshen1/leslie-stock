"use client";

import { useEffect, useRef, useState } from "react";
import FinancialsCharts from "@/components/FinancialsCharts";
import type { Analysis, DimensionScore, AleabitAnalysis, AleabitSignal } from "@/lib/data";

type Props = {
  code: string;
  market: "a" | "hk" | "us";
  initial: Analysis | null;
};

type PerspectiveTab = "bg" | "aleabit" | "combined";

export default function StockDetailClient({ code, market, initial }: Props) {
  const [data, setData] = useState<Analysis | null>(initial);
  const [status, setStatus] = useState<
    "idle" | "starting" | "pending" | "ok" | "error"
  >(initial ? "ok" : "idle");
  const [elapsed, setElapsed] = useState(0);
  const [tab, setTab] = useState<PerspectiveTab>("bg");
  const startedAtRef = useRef<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (status === "pending" || status === "starting") {
      const tick = setInterval(() => {
        if (startedAtRef.current) {
          setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
        }
      }, 1000);
      return () => clearInterval(tick);
    }
  }, [status]);

  async function generate(force = false) {
    setStatus("starting");
    startedAtRef.current = Date.now();
    setElapsed(0);

    try {
      const resp = await fetch(
        `/api/analyze/${code}?market=${market}${force ? "&force=1" : ""}`,
        { method: "POST" }
      );
      const body = await resp.json();
      if (body.status === "ok" && body.data) {
        setData(body.data);
        setStatus("ok");
        return;
      }
      setStatus("pending");
      pollRef.current = setInterval(pollOnce, 3000);
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }

  async function pollOnce() {
    try {
      const resp = await fetch(`/api/analyze/${code}?market=${market}`);
      if (resp.status === 404) return;
      const body = await resp.json();
      if (body.status === "ok" && body.data) {
        setData(body.data);
        setStatus("ok");
        if (pollRef.current) clearInterval(pollRef.current);
      }
    } catch (e) {
      console.error(e);
    }
  }

  if (!data && status === "idle") {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center">
        <p className="mb-2 text-lg text-zinc-700">还没分析过这只股票</p>
        <p className="mb-6 text-sm text-zinc-500">
          点击下面按钮，调用 <strong>GLM-5.1</strong>{" "}
          按 BG_DNA 框架（段永平 + 巴菲特）做深度评估。耗时约 60-120 秒。
        </p>
        <button
          onClick={() => generate(false)}
          className="rounded-lg bg-zinc-900 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-700 transition"
        >
          🤖 生成 BG 深度分析
        </button>
      </div>
    );
  }

  if (!data && (status === "starting" || status === "pending")) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center">
        <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900" />
        <p className="mb-2 text-lg text-zinc-700">GLM-5.1 正在分析中…</p>
        <p className="text-sm text-zinc-500">
          已耗时 {elapsed} 秒（通常 60-120 秒完成）
        </p>
      </div>
    );
  }

  if (!data && status === "error") {
    return (
      <div className="rounded-xl border border-rose-300 bg-rose-50 p-8 text-center">
        <p className="mb-4 text-rose-700">分析失败 — 请重试</p>
        <button
          onClick={() => generate(true)}
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white"
        >
          重试
        </button>
      </div>
    );
  }

  const hasAleabit = !!data!.aleabit;

  return (
    <>
      {/* 三视角 Tab 切换 */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-1">
          <PerspectiveTabButton active={tab === "bg"} onClick={() => setTab("bg")}>
            💎 段巴框架
          </PerspectiveTabButton>
          <PerspectiveTabButton
            active={tab === "aleabit"}
            onClick={() => setTab("aleabit")}
            disabled={!hasAleabit}
          >
            🎯 Serenity 瓶颈
          </PerspectiveTabButton>
          <PerspectiveTabButton
            active={tab === "combined"}
            onClick={() => setTab("combined")}
          >
            ⚖️ 综合判断
          </PerspectiveTabButton>
        </div>
        <p className="text-xs text-zinc-400">
          更新于 {new Date(data!.updated_at).toLocaleString("zh-CN")} ·
          <button
            onClick={() => generate(true)}
            disabled={status === "pending" || status === "starting"}
            className="ml-1 text-blue-600 hover:text-blue-800 disabled:text-zinc-400"
          >
            {status === "pending" || status === "starting"
              ? `重新生成中…（${elapsed}s）`
              : "🔄 重新生成"}
          </button>
        </p>
      </div>

      {tab === "bg" && <BGPerspective data={data!} />}
      {tab === "aleabit" && (
        hasAleabit ? <AleabitPerspective a={data!.aleabit!} /> : <AleabitMissing />
      )}
      {tab === "combined" && <CombinedPerspective data={data!} />}
    </>
  );
}

// ============================================================
// 视角 1: 段巴框架（原有内容）
// ============================================================

function BGPerspective({ data }: { data: Analysis }) {
  return (
    <>
      <div className="mb-6 flex items-baseline justify-between rounded-xl border border-zinc-200 bg-white px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-zinc-400">BG 综合得分</p>
          <p className={`mt-1 font-mono text-3xl font-semibold ${scoreColor(data.overall_score)}`}>
            {data.overall_score.toFixed(1)}
            <span className="ml-1 text-base text-zinc-400">/100</span>
          </p>
          <p className="mt-1 text-sm text-zinc-600">{data.overall_grade}</p>
        </div>
        <div className="text-right">
          {data.llm_used && (
            <p className="mb-2 inline-flex rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              GLM-{data.llm_model?.includes("5") ? "5.1" : "4.5"} 已分析
            </p>
          )}
        </div>
      </div>

      {data.verdict && (
        <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-800">
            段永平 / 巴菲特视角 · GLM-5.1
          </p>
          <p className="text-zinc-800 leading-relaxed">{data.verdict}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DimensionCard label="1. 商业模式" d={data.dimensions.business_model} />
        <DimensionCard label="2. 护城河" d={data.dimensions.moat} />
        <DimensionCard label="3. 管理层" d={data.dimensions.management} />
        <DimensionCard label="4. 财务质量" d={data.dimensions.financials} />
        <DimensionCard label="5. 估值" d={data.dimensions.valuation} />
        <DimensionCard label="6. 能力圈" d={data.dimensions.circle} />
      </div>

      {data.raw_quote && (
        <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6">
          <p className="mb-3 text-sm font-semibold text-zinc-700">实时行情</p>
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Stat label="现价" value={fmt(data.raw_quote.price)} />
            <Stat
              label="今涨幅"
              value={fmt(data.raw_quote.change_pct, "%")}
              color={signedColor(data.raw_quote.change_pct as number)}
            />
            <Stat label="PE TTM" value={fmt(data.raw_quote.pe_ttm)} />
            <Stat label="PB" value={fmt(data.raw_quote.pb)} />
          </div>
        </div>
      )}

      {data.financials_history && (
        <div className="mt-8">
          <h2 className="mb-3 text-base font-semibold text-zinc-800">5 年财务走势</h2>
          <FinancialsCharts history={data.financials_history} />
        </div>
      )}

      {data.sell_triggers && data.sell_triggers.length > 0 && (
        <div className="mt-8 rounded-xl border border-rose-200 bg-rose-50 p-6">
          <p className="mb-3 text-sm font-semibold text-rose-800">🚨 卖出触发条件</p>
          <ul className="space-y-1.5 text-sm text-rose-900">
            {data.sell_triggers.map((t, i) => (
              <li key={i}>• {t}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

// ============================================================
// 视角 2: Serenity (aleabit) 瓶颈狙击
// ============================================================

function AleabitPerspective({ a }: { a: AleabitAnalysis }) {
  return (
    <>
      <div className="mb-6 flex items-baseline justify-between rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-violet-500">
            Bottleneck Score · Serenity Framework
          </p>
          <p className={`mt-1 font-mono text-3xl font-semibold ${bottleneckColor(a.bottleneck_score)}`}>
            {a.bottleneck_score}
            <span className="ml-1 text-base text-violet-400">/100</span>
          </p>
          <p className="mt-1 text-sm text-violet-700">{a.verdict_label}</p>
        </div>
        <div className="text-right">
          <p className="mb-1 text-xs uppercase tracking-wider text-violet-400">供应链层级</p>
          <p className="font-mono text-lg font-semibold text-violet-800">
            {a.supply_chain_layer ? `Layer ${a.supply_chain_layer}` : "N/A"}
          </p>
          <p className="text-xs text-violet-500">{a.layer_label}</p>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Serenity Thesis · @aleabitoreddit voice
        </p>
        <p className="font-mono text-sm text-zinc-800 leading-relaxed">{a.thesis}</p>
      </div>

      <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <p className="text-sm font-semibold text-zinc-800">7 项瓶颈信号</p>
          <p className="text-xs text-zinc-500">
            命中 <span className="font-mono font-semibold text-violet-700">{a.signals_hit}</span> / 7
          </p>
        </div>
        <ul className="space-y-3">
          {a.signals.map((s, i) => (
            <SignalRow key={i} s={s} />
          ))}
        </ul>
      </div>

      {a.red_flags.length > 0 && (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-6">
          <p className="mb-3 text-sm font-semibold text-rose-800">⚠️ Red Flags</p>
          <ul className="space-y-1.5 text-sm text-rose-900">
            {a.red_flags.map((f, i) => (
              <li key={i}>• {f}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-sky-200 bg-sky-50 p-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-sky-700">
          AI 资本支出关联
        </p>
        <p className="text-sm text-sky-900 leading-relaxed">{a.ai_relevance}</p>
      </div>

      <p className="mt-6 text-center text-xs text-zinc-400">
        基于 Serenity 公开框架的风格复刻 · NOT 投资建议 ·
        bottleneck_score 命中度 = (yes × 1 + partial × 0.5) / 7 × 100
      </p>
    </>
  );
}

function SignalRow({ s }: { s: AleabitSignal }) {
  const icon = s.hit === "yes" ? "✓" : s.hit === "partial" ? "◐" : "✗";
  const color =
    s.hit === "yes"
      ? "text-emerald-600 bg-emerald-50 border-emerald-200"
      : s.hit === "partial"
      ? "text-amber-600 bg-amber-50 border-amber-200"
      : "text-zinc-400 bg-zinc-50 border-zinc-200";

  return (
    <li className="flex items-start gap-3">
      <span
        className={`shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full border font-mono text-xs ${color}`}
      >
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-800">{s.name}</p>
        <p className="mt-0.5 text-xs text-zinc-600 leading-relaxed">{s.note}</p>
      </div>
    </li>
  );
}

function AleabitMissing() {
  return (
    <div className="rounded-xl border border-dashed border-violet-300 bg-violet-50 p-12 text-center">
      <p className="mb-3 text-lg text-violet-800">还没生成 Serenity 瓶颈分析</p>
      <p className="text-sm text-violet-600">
        这只股票还没有 aleabit 风格的瓶颈狙击评估。
        <br />
        和我对话说&ldquo;按 Serenity 框架分析这只股&rdquo;，我会做出来。
      </p>
    </div>
  );
}

// ============================================================
// 视角 3: 综合判断
// ============================================================

function CombinedPerspective({ data }: { data: Analysis }) {
  const a = data.aleabit;
  const bgScore = data.overall_score;
  const bsScore = a?.bottleneck_score ?? 0;
  const bothStrong = bgScore >= 75 && bsScore >= 65;
  const bgOnly = bgScore >= 75 && bsScore < 50;
  const aleabitOnly = bsScore >= 65 && bgScore < 60;

  let verdict: string;
  let verdictTone: string;
  let verdictIcon: string;
  if (bothStrong) {
    verdict = "两个框架都看好 — 罕见的高确信度标的。段巴会买做长期，Serenity 会做 alpha 仓位。";
    verdictTone = "border-emerald-300 bg-emerald-50 text-emerald-900";
    verdictIcon = "🎯";
  } else if (bgOnly) {
    verdict = "段巴框架看好，但不在 Serenity 的 AI 供应链射程内 — 适合稳健长持仓位，不是 alpha 进取仓位。";
    verdictTone = "border-amber-300 bg-amber-50 text-amber-900";
    verdictIcon = "💎";
  } else if (aleabitOnly) {
    verdict = "Serenity 瓶颈信号强，但段巴框架估值或商业模式有保留 — 短期 thesis trade，不适合长期重仓。";
    verdictTone = "border-violet-300 bg-violet-50 text-violet-900";
    verdictIcon = "🎲";
  } else {
    verdict = "两个框架都没有高确信度信号 — 继续观察，不主动加仓。";
    verdictTone = "border-zinc-300 bg-zinc-50 text-zinc-700";
    verdictIcon = "🟡";
  }

  return (
    <>
      <div className={`mb-6 rounded-xl border-2 p-6 ${verdictTone}`}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider opacity-70">
          综合判断
        </p>
        <p className="text-lg font-semibold leading-relaxed">
          {verdictIcon} {verdict}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-amber-200 bg-white p-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-700">
            💎 段巴框架（长期价值）
          </p>
          <p className={`mb-2 font-mono text-3xl font-semibold ${scoreColor(bgScore)}`}>
            {bgScore.toFixed(1)}
            <span className="ml-1 text-base text-zinc-400">/100</span>
          </p>
          <p className="mb-3 text-sm text-zinc-600">{data.overall_grade}</p>
          {data.verdict && (
            <p className="text-sm text-zinc-700 leading-relaxed line-clamp-4">
              {data.verdict}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-violet-200 bg-white p-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-violet-700">
            🎯 Serenity 瓶颈（AI 供应链 alpha）
          </p>
          {a ? (
            <>
              <p className={`mb-2 font-mono text-3xl font-semibold ${bottleneckColor(bsScore)}`}>
                {bsScore}
                <span className="ml-1 text-base text-violet-400">/100</span>
              </p>
              <p className="mb-3 text-sm text-violet-700">{a.verdict_label}</p>
              <p className="text-sm text-zinc-700 leading-relaxed line-clamp-4">
                {a.thesis}
              </p>
            </>
          ) : (
            <p className="text-sm text-zinc-400">— 暂无 aleabit 分析 —</p>
          )}
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6">
        <p className="mb-3 text-sm font-semibold text-zinc-700">两个视角对比</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
              <th className="py-2">维度</th>
              <th className="py-2 text-amber-700">段巴框架</th>
              <th className="py-2 text-violet-700">Serenity 瓶颈</th>
            </tr>
          </thead>
          <tbody className="text-zinc-700">
            <tr className="border-b border-zinc-100">
              <td className="py-2 text-zinc-500">看什么</td>
              <td className="py-2">商业模式 / 护城河 / 估值</td>
              <td className="py-2">AI capex 供应链节点</td>
            </tr>
            <tr className="border-b border-zinc-100">
              <td className="py-2 text-zinc-500">时间框架</td>
              <td className="py-2">5-10 年</td>
              <td className="py-2">月到季度，重磅 1-2 年</td>
            </tr>
            <tr className="border-b border-zinc-100">
              <td className="py-2 text-zinc-500">仓位风格</td>
              <td className="py-2">能力圈内重仓长持</td>
              <td className="py-2">高 beta 小盘 alpha 狙击</td>
            </tr>
            <tr>
              <td className="py-2 text-zinc-500">关键风险</td>
              <td className="py-2">估值 / 一票否决 (Stop Doing)</td>
              <td className="py-2">thesis 兑现时间不确定</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

// ============================================================
// 共享组件
// ============================================================

function PerspectiveTabButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-zinc-900 text-white"
          : disabled
          ? "text-zinc-300 cursor-not-allowed"
          : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50"
      }`}
    >
      {children}
    </button>
  );
}

function DimensionCard({ label, d }: { label: string; d: DimensionScore }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-semibold text-zinc-800">{label}</h3>
        <div className="text-right">
          <p className={`font-mono text-2xl font-semibold ${scoreColor(d.score)}`}>
            {d.score > 0 ? d.score.toFixed(0) : "—"}
          </p>
          <p className="text-xs text-zinc-500">{d.grade}</p>
        </div>
      </div>
      {d.flags.length > 0 && (
        <ul className="mb-2 space-y-1 text-sm">
          {d.flags.map((f, i) => (
            <li key={i} className="text-zinc-700">
              {f}
            </li>
          ))}
        </ul>
      )}
      <ul className="space-y-1 text-sm text-zinc-600">
        {d.details.slice(0, 6).map((det, i) => (
          <li key={i}>{det}</li>
        ))}
      </ul>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-0.5 font-mono text-base font-medium ${color || "text-zinc-800"}`}>
        {value}
      </p>
    </div>
  );
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-600";
  if (score >= 65) return "text-amber-600";
  if (score >= 50) return "text-orange-600";
  return "text-zinc-500";
}

function bottleneckColor(score: number): string {
  if (score >= 75) return "text-violet-700";
  if (score >= 55) return "text-violet-500";
  if (score >= 30) return "text-zinc-500";
  return "text-zinc-400";
}

function signedColor(v: number | null | undefined): string {
  if (typeof v !== "number") return "text-zinc-800";
  if (v > 0) return "text-rose-600";
  if (v < 0) return "text-emerald-600";
  return "text-zinc-800";
}

function fmt(v: unknown, suffix = ""): string {
  if (v === null || v === undefined || v === "-") return "—";
  if (typeof v === "number") return v.toFixed(2) + suffix;
  return String(v) + suffix;
}
