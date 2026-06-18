"use client";

// 私密产品分析看板。口令存 localStorage,数据走 /api/stats-data(Bearer 鉴权)。
// 全部自有数据(Upstash),不依赖任何外部分析。
import { useCallback, useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";

type Series = { date: string; dau: number; nw: number; pv: number };
type RetRow = { dayN: number; pct: number | null; n: number };
type Ret = { cohort: string; size: number; row: RetRow[] };
type Top = { label: string; n: number };
type Data = {
  connected: boolean;
  days: number;
  series: Series[];
  retention: Ret[];
  topPages: Top[];
  topClicks: Top[];
  generatedAt: number;
};

type Status = "need-auth" | "bad-auth" | "loading" | "no-store" | "error" | "ok";

const fmt = (n: number) => n.toLocaleString("en-US");
const md = (d: string) => d.slice(5); // MM-DD

export default function StatsClient() {
  const { t } = useLang();
  const [token, setToken] = useState("");
  const [input, setInput] = useState("");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState<Status>("need-auth");

  const load = useCallback(async (tok: string, d: number) => {
    setStatus("loading");
    try {
      const res = await fetch(`/api/stats-data?days=${d}`, { headers: { authorization: `Bearer ${tok}` } });
      if (res.status === 401) {
        try { localStorage.removeItem("sg_stats_token"); } catch {}
        setStatus("bad-auth");
        return;
      }
      if (!res.ok) { setStatus("error"); return; }
      const j = (await res.json()) as Data;
      if (!j.connected) { setData(j); setStatus("no-store"); return; }
      setData(j);
      setStatus("ok");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let saved = "";
    try { saved = localStorage.getItem("sg_stats_token") || ""; } catch {}
    if (saved) { setToken(saved); load(saved, days); }
    else setStatus("need-auth");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const tok = input.trim();
    if (!tok) return;
    try { localStorage.setItem("sg_stats_token", tok); } catch {}
    setToken(tok);
    load(tok, days);
  };

  const changeDays = (d: number) => { setDays(d); if (token) load(token, d); };
  const logout = () => {
    try { localStorage.removeItem("sg_stats_token"); } catch {}
    setToken(""); setInput(""); setData(null); setStatus("need-auth");
  };

  // ---------- 口令门 ----------
  if (status === "need-auth" || status === "bad-auth") {
    return (
      <main className="mx-auto max-w-sm px-4 py-20 sm:px-6">
        <h1 className="text-xl font-semibold text-ink">{t("私密看板", "Private Dashboard")}</h1>
        <p className="mt-1 text-sm text-muted">{t("输入访问口令(STATS_TOKEN)。", "Enter the access token (STATS_TOKEN).")}</p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("口令", "Token")}
            autoFocus
            className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none transition focus:border-accent/60"
          />
          {status === "bad-auth" && <p className="text-xs text-down">{t("口令不对。", "Wrong token.")}</p>}
          <button type="submit" className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-[#1a0f08] transition hover:brightness-110">
            {t("进入", "Enter")}
          </button>
        </form>
      </main>
    );
  }

  if (status === "loading") return <main className="mx-auto max-w-md px-6 py-24 text-center text-sm text-muted">{t("加载中…", "Loading…")}</main>;
  if (status === "error") return <main className="mx-auto max-w-md px-6 py-24 text-center text-sm text-down">{t("读取失败,稍后重试。", "Failed to load. Try again later.")}<button onClick={() => load(token, days)} className="ml-2 underline">{t("重试", "Retry")}</button></main>;

  // ---------- 存储未连接 ----------
  if (status === "no-store") {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <h1 className="text-xl font-semibold text-ink">{t("看板已就绪,但还没接存储", "Dashboard is ready, but storage isn't connected yet")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {t(
            "埋点和看板代码都上线了,只差一个免费的 Upstash Redis。在 Vercel 后台 → Storage → 建一个 Upstash Redis(Marketplace,免费档),链接到本项目,env 会自动注入,然后 redeploy 即可开始收集。",
            "Tracking and dashboard code are live — all that's missing is a free Upstash Redis. In the Vercel dashboard → Storage → create an Upstash Redis (Marketplace, free tier), link it to this project; the env vars inject automatically, then redeploy to start collecting.",
          )}
        </p>
        <button onClick={() => load(token, days)} className="mt-5 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink transition hover:bg-surface-2">{t("重新检查", "Re-check")}</button>
      </main>
    );
  }

  if (!data) return null;
  const s = data.series;
  const last = s[s.length - 1];
  const prev = s[s.length - 2];
  const pv7 = s.slice(-7).reduce((a, b) => a + b.pv, 0);
  const dau7peak = Math.max(0, ...s.slice(-7).map((x) => x.dau));
  const maxV = Math.max(1, ...s.map((x) => x.dau));

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
      {/* 头 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{t("私密看板", "Private Dashboard")} · Stats</h1>
          <p className="mt-1 text-[12px] text-faint">
            {t("自有数据 · 匿名口径(无 cookie / 无 PII) · 按 UTC 天 · 更新于", "First-party data · anonymous (no cookies / no PII) · by UTC day · updated")} {new Date(data.generatedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
            {[7, 30, 60].map((d) => (
              <button key={d} onClick={() => changeDays(d)}
                className={`rounded-md px-2.5 py-1 text-[12px] transition ${days === d ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}>
                {d}{t("天", "d")}
              </button>
            ))}
          </div>
          <button onClick={() => load(token, days)} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] text-muted transition hover:text-ink">{t("刷新", "Refresh")}</button>
          <button onClick={logout} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] text-faint transition hover:text-ink">{t("退出", "Log out")}</button>
        </div>
      </div>

      {/* KPI */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label={t("今日 DAU", "DAU today")} value={fmt(last?.dau ?? 0)} sub={prev ? `${t("昨日", "yesterday")} ${fmt(prev.dau)}` : ""} delta={prev ? (last?.dau ?? 0) - prev.dau : null} />
        <Kpi label={t("今日新用户", "New users today")} value={fmt(last?.nw ?? 0)} sub={t("首次到访", "first visit")} />
        <Kpi label={t("今日 PV", "PV today")} value={fmt(last?.pv ?? 0)} sub={prev ? `${t("昨日", "yesterday")} ${fmt(prev.pv)}` : ""} delta={prev ? (last?.pv ?? 0) - prev.pv : null} />
        <Kpi label={t("近 7 日 PV", "PV last 7d")} value={fmt(pv7)} sub={`${t("DAU 峰值", "DAU peak")} ${fmt(dau7peak)}`} />
      </div>

      {/* DAU / 新用户 趋势 */}
      <section className="mt-6 rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-ink">{t("DAU 趋势", "DAU trend")}</h2>
          <div className="flex items-center gap-3 text-[11px] text-faint">
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-accent" />{t("活跃", "Active")}</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-up" />{t("其中新用户", "of which new")}</span>
            <span>{t("峰值", "Peak")} {fmt(maxV)}</span>
          </div>
        </div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-40 w-full text-accent">
          {s.map((x, i) => {
            const step = 100 / s.length;
            const bw = step * 0.66;
            const xx = i * step + (step - bw) / 2;
            const h = (x.dau / maxV) * 94;
            const nwH = (x.nw / maxV) * 94;
            return (
              <g key={x.date}>
                <rect x={xx} y={100 - h} width={bw} height={h} fill="currentColor" opacity={0.85} />
                {nwH > 0 && <rect x={xx} y={100 - nwH} width={bw} height={nwH} className="text-up" fill="currentColor" />}
              </g>
            );
          })}
        </svg>
        <div className="mt-1.5 flex justify-between text-[10px] text-faint">
          <span>{md(s[0]?.date ?? "")}</span>
          {s.length > 8 && <span>{md(s[Math.floor(s.length / 2)]?.date ?? "")}</span>}
          <span>{md(last?.date ?? "")}{t("（今日）", " (today)")}</span>
        </div>
      </section>

      {/* 留存三角 */}
      <section className="mt-6 rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-ink">{t("留存(新用户 cohort)", "Retention (new-user cohort)")}</h2>
          <span className="text-[11px] text-faint">{t("每行 = 当天首次到访的人,之后第 N 天还回来的比例", "Each row = users who first visited that day, and the % returning on day N")}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[560px] border-separate border-spacing-1 text-center text-[12px]">
            <thead>
              <tr className="text-faint">
                <th className="px-2 py-1 text-left font-medium">Cohort</th>
                <th className="px-1 py-1 font-medium">{t("人数", "Users")}</th>
                {Array.from({ length: 8 }, (_, n) => <th key={n} className="px-1 py-1 font-medium">D{n}</th>)}
              </tr>
            </thead>
            <tbody>
              {[...data.retention].reverse().map((c) => (
                <tr key={c.cohort}>
                  <td className="px-2 py-1 text-left text-muted tnum">{md(c.cohort)}</td>
                  <td className="px-1 py-1 text-ink tnum">{c.size}</td>
                  {c.row.map((cell) => (
                    <td key={cell.dayN} className="relative px-1 py-1 tnum">
                      {cell.pct == null ? (
                        <span className="text-faint/40">·</span>
                      ) : (
                        <span className="relative z-10 text-ink" title={`${cell.n} ${t("人", "users")}`}>{cell.pct}%</span>
                      )}
                      {cell.pct != null && cell.dayN > 0 && (
                        <span className="absolute inset-0 rounded bg-accent" style={{ opacity: (cell.pct / 100) * 0.7 }} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Top 页面 / Top 点击 */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TopList title={t("热门页面（近 7 日 PV）", "Top pages (PV last 7d)")} items={data.topPages} />
        <TopList title={t("热门点击 / 互动（近 7 日）", "Top clicks / interactions (last 7d)")} items={data.topClicks} />
      </div>

      <p className="mt-8 text-center text-[11px] text-faint">{t("仅你可见 · 口令保护 · 数据存于你自己的 Upstash", "Visible only to you · token-protected · data stored in your own Upstash")}</p>
    </main>
  );
}

function Kpi({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: number | null }) {
  return (
    <div className="rounded-xl border border-line bg-base/40 p-4">
      <div className="text-[11px] uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink tnum">{value}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
        {delta != null && delta !== 0 && (
          <span className={delta > 0 ? "text-up" : "text-down"}>{delta > 0 ? "▲" : "▼"} {fmt(Math.abs(delta))}</span>
        )}
        {sub && <span className="text-faint">{sub}</span>}
      </div>
    </div>
  );
}

function TopList({ title, items }: { title: string; items: Top[] }) {
  const { t } = useLang();
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      {items.length === 0 ? (
        <p className="text-[12px] text-faint">{t("还没有数据。", "No data yet.")}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="relative flex items-center justify-between gap-3 overflow-hidden rounded-md px-2.5 py-1.5">
              <span className="absolute inset-y-0 left-0 rounded-md bg-accent/10" style={{ width: `${(it.n / max) * 100}%` }} />
              <span className="relative z-10 min-w-0 flex-1 truncate text-[12px] text-ink" title={it.label}>{it.label || "—"}</span>
              <span className="relative z-10 shrink-0 text-[12px] text-muted tnum">{fmt(it.n)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
