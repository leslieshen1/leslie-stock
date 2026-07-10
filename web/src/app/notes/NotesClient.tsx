"use client";

// 雷司令投资笔记 · 纸感手账壳
// 桌面 lg+:三栏(大栏目 92px / 条目列表 248px / 内容区);移动:两级下钻(栏目卡片流 → 条目 → 阅读)。
// 全库免费公开(2026-07 起,兑换码体系退役,基建保留在 API 层未删)。
// 内容 md 支持 :::chart JSON 块 → 程序化 SVG K线图解(全库图风格统一、随时可重生成)。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, ChevronLeft, ChevronRight, BookOpen } from "lucide-react";
import type { Toc, NoteMeta } from "@/lib/notes";

/* ---------------- 纸感调色(独立于站点主题) ---------------- */
const PAPER = "#f7f3ea";
const CARD = "#fffdf8";
const INK = "#2a2620";
const MUT = "#6b6459";
const FAINT = "#a89f90";
const LINE = "#e2d9c8";
const ACC = "#c2410c";  // 批注橙红:唯一的强调色
const UP = "#b93a32";   // 涨(纸感降饱和红)
const DN = "#2e7d51";   // 跌(纸感降饱和绿)
const SERIF = '"Songti SC","STSong","Noto Serif SC","Source Han Serif SC",serif';

/* ---------------- SVG K线图解渲染器 ---------------- */
type ChartSpec = {
  h?: number;
  candles: [number, number, number, number][]; // [open, high, low, close]
  ma?: number[];                                // 均线周期列表,如 [5, 10]
  lines?: { y: number; label?: string }[];      // 水平虚线(支撑/阻力/颈线)
  marks?: { i: number; txt: string; below?: boolean }[]; // 第 i 根蜡烛的标注
  cap?: string;                                 // 图注
};

function sma(vals: number[], p: number): (number | null)[] {
  return vals.map((_, i) => {
    if (i < p - 1) return null;
    let s = 0;
    for (let j = i - p + 1; j <= i; j++) s += vals[j];
    return s / p;
  });
}

function KChart({ spec }: { spec: ChartSpec }) {
  const W = 560;
  const H = spec.h || 210;
  const padT = 26, padB = 14, padX = 14;
  const n = spec.candles.length;
  if (!n) return null;
  const ys = spec.candles.flatMap((c) => [c[1], c[2]]).concat((spec.lines || []).map((l) => l.y));
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad; hi += pad;
  const y = (v: number) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
  const slot = (W - padX * 2) / n;
  const bw = Math.min(slot * 0.55, 26);
  const cx = (i: number) => padX + slot * i + slot / 2;
  const closes = spec.candles.map((c) => c[3]);
  const maColors = [ACC, "#8a7b5c", "#5a6b8a"];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {(spec.lines || []).map((l, k) => (
        <g key={`l${k}`}>
          <line x1={padX} x2={W - padX} y1={y(l.y)} y2={y(l.y)} stroke={FAINT} strokeWidth={1} strokeDasharray="5 4" />
          {l.label && <text x={W - padX} y={y(l.y) - 4} textAnchor="end" fontSize={11} fill={MUT}>{l.label}</text>}
        </g>
      ))}
      {spec.candles.map((c, i) => {
        const [o, h, l, cl] = c;
        const up = cl >= o;
        const col = up ? UP : DN;
        const bodyT = y(Math.max(o, cl)), bodyB = y(Math.min(o, cl));
        return (
          <g key={i}>
            <line x1={cx(i)} x2={cx(i)} y1={y(h)} y2={y(l)} stroke={col} strokeWidth={1.2} />
            <rect x={cx(i) - bw / 2} y={bodyT} width={bw} height={Math.max(bodyB - bodyT, 1.5)}
                  fill={up ? CARD : col} stroke={col} strokeWidth={1.4} rx={1} />
          </g>
        );
      })}
      {(spec.ma || []).map((p, k) => {
        const line = sma(closes, p);
        const pts = line.map((v, i) => (v == null ? null : `${cx(i)},${y(v)}`)).filter(Boolean).join(" ");
        return <polyline key={`ma${p}`} points={pts} fill="none" stroke={maColors[k % 3]} strokeWidth={1.6} opacity={0.85} />;
      })}
      {(spec.marks || []).map((m, k) => {
        const c = spec.candles[m.i];
        if (!c) return null;
        const ty = m.below ? y(c[2]) + 16 : y(c[1]) - 10;
        const ay1 = m.below ? ty - 10 : ty + 3;
        const ay2 = m.below ? y(c[2]) + 3 : y(c[1]) - 3;
        return (
          <g key={`m${k}`}>
            <line x1={cx(m.i)} x2={cx(m.i)} y1={ay1} y2={ay2} stroke={ACC} strokeWidth={1} />
            <text x={cx(m.i)} y={m.below ? ty + 10 : ty} textAnchor="middle" fontSize={12} fill={ACC} style={{ fontFamily: SERIF }}>{m.txt}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------------- Markdown 渲染(纸感排版) ---------------- */
type Block =
  | { k: "h2" | "h3" | "p" | "quote"; text: string }
  | { k: "ul"; items: string[] }
  | { k: "chart"; spec: ChartSpec };

function parseMd(md: string): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.startsWith(":::chart")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith(":::")) { buf.push(lines[i]); i++; }
      i++; // 跳过结尾 :::
      try { blocks.push({ k: "chart", spec: JSON.parse(buf.join("\n")) }); } catch { /* 配置错误的图静默跳过 */ }
      continue;
    }
    if (ln.startsWith("### ")) { blocks.push({ k: "h3", text: ln.slice(4) }); i++; continue; }
    if (ln.startsWith("## ")) { blocks.push({ k: "h2", text: ln.slice(3) }); i++; continue; }
    if (ln.startsWith("> ")) { blocks.push({ k: "quote", text: ln.slice(2) }); i++; continue; }
    if (ln.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) { items.push(lines[i].slice(2)); i++; }
      blocks.push({ k: "ul", items });
      continue;
    }
    if (ln.trim()) { blocks.push({ k: "p", text: ln }); }
    i++;
  }
  return blocks;
}

function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((seg, i) =>
        seg.startsWith("**")
          ? <strong key={i} className="font-semibold" style={{ color: INK }}>{seg.slice(2, -2)}</strong>
          : <span key={i}>{seg}</span>
      )}
    </>
  );
}

function MdView({ md }: { md: string }) {
  const blocks = useMemo(() => parseMd(md), [md]);
  return (
    <div className="space-y-4 text-[15px] leading-[1.9]" style={{ color: "#3d372e" }}>
      {blocks.map((b, i) => {
        if (b.k === "h2") return (
          <h2 key={i} className="pt-3 text-[19px] font-bold tracking-wide" style={{ fontFamily: SERIF, color: INK }}>
            <span style={{ color: ACC }}>◆ </span>{b.text}
          </h2>
        );
        if (b.k === "h3") return <h3 key={i} className="pt-1 text-[16px] font-bold" style={{ fontFamily: SERIF, color: INK }}>{b.text}</h3>;
        if (b.k === "quote") return (
          <blockquote key={i} className="border-l-2 py-0.5 pl-3 text-[14px]" style={{ borderColor: ACC, color: MUT }}>
            <Rich text={b.text} />
          </blockquote>
        );
        if (b.k === "ul") return (
          <ul key={i} className="space-y-1.5 pl-1">
            {b.items.map((it, j) => (
              <li key={j} className="flex gap-2">
                <span className="mt-[2px] shrink-0" style={{ color: ACC }}>·</span>
                <span><Rich text={it} /></span>
              </li>
            ))}
          </ul>
        );
        if (b.k === "chart") return (
          <figure key={i} className="rounded-md border px-3 pb-2 pt-3" style={{ borderColor: LINE, backgroundColor: CARD }}>
            <KChart spec={b.spec} />
            {b.spec.cap && <figcaption className="pt-1 text-center text-[12px]" style={{ color: FAINT }}>{b.spec.cap}</figcaption>}
          </figure>
        );
        return <p key={i}><Rich text={b.text} /></p>;
      })}
    </div>
  );
}

/* ---------------- 主组件 ---------------- */
type Phase = "home" | "list" | "read"; // 移动端三视图;桌面恒三栏

export default function NotesClient() {
  const [toc, setToc] = useState<Toc | null>(null);
  const [tocErr, setTocErr] = useState(false);
  const [secKey, setSecKey] = useState<string>("");
  const [artId, setArtId] = useState<string>("");
  const [cache, setCache] = useState<Record<string, string>>({});
  const [artState, setArtState] = useState<"idle" | "loading" | "error">("idle");
  const [phase, setPhase] = useState<Phase>("home");
  const [q, setQ] = useState("");
  const [readSet, setReadSet] = useState<Set<string>>(new Set());

  /* 初始化:进度 + 目录 */
  useEffect(() => {
    try {
      setReadSet(new Set(JSON.parse(localStorage.getItem("sg_nb_read") || "[]")));
    } catch { /* 隐私模式等,静默 */ }
    fetch("/api/notes/toc", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.sections ? setToc(j) : setTocErr(true)))
      .catch(() => setTocErr(true));
  }, []);

  const sections = toc?.sections || [];
  const activeSec = sections.find((s) => s.key === secKey) || null;
  const flat = useMemo(() => sections.flatMap((s) => s.items.map((it) => ({ ...it, sec: s.key, secT: s.t }))), [sections]);
  const activeMeta = flat.find((f) => f.id === artId) || null;
  const hits = useMemo(() => {
    const kw = q.trim();
    if (!kw) return [];
    return flat.filter((f) => f.t.toLowerCase().includes(kw.toLowerCase())).slice(0, 20);
  }, [q, flat]);

  const markRead = useCallback((id: string) => {
    setReadSet((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev).add(id);
      try { localStorage.setItem("sg_nb_read", JSON.stringify([...next])); } catch { /* noop */ }
      return next;
    });
  }, []);

  /* 打开一篇 */
  const openArt = useCallback(async (meta: NoteMeta & { sec?: string }) => {
    setArtId(meta.id);
    if (meta.sec) setSecKey(meta.sec);
    setPhase("read");
    setQ("");
    if (cache[meta.id]) { setArtState("idle"); markRead(meta.id); return; }
    setArtState("loading");
    try {
      const r = await fetch(`/api/notes/art?id=${encodeURIComponent(meta.id)}`);
      const j = await r.json();
      if (!j.md) { setArtState("error"); return; }
      setCache((c) => ({ ...c, [meta.id]: j.md }));
      setArtState("idle");
      markRead(meta.id);
    } catch { setArtState("error"); }
  }, [cache, markRead]);

  const idx = flat.findIndex((f) => f.id === artId);
  const prev = idx > 0 ? flat[idx - 1] : null;
  const next = idx >= 0 && idx < flat.length - 1 ? flat[idx + 1] : null;
  const total = flat.length;
  const readCount = flat.filter((f) => readSet.has(f.id)).length;

  /* ---------- 子渲染 ---------- */
  const SecList = ({ compact }: { compact?: boolean }) => (
    <div className={compact ? "" : "space-y-1"}>
      {activeSec?.items.map((it) => {
        const active = it.id === artId;
        return (
          <button key={it.id} onClick={() => openArt({ ...it, sec: activeSec.key })}
            className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[13.5px] transition-colors"
            style={{
              backgroundColor: active ? "#f0e9da" : "transparent",
              color: active ? INK : MUT,
              fontWeight: active ? 600 : 400,
            }}>
            {readSet.has(it.id)
              ? <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ backgroundColor: ACC }} />
              : <span className="h-[5px] w-[5px] shrink-0 rounded-full border" style={{ borderColor: FAINT }} />}
            <span className="min-w-0 flex-1 truncate">{it.t}</span>
          </button>
        );
      })}
    </div>
  );

  const Reader = () => {
    if (!activeMeta) return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-3 text-center" style={{ color: FAINT }}>
        <BookOpen size={28} strokeWidth={1.2} />
        <p className="text-[13px]">选一篇开始读 · 全库 {total} 篇 · 已读 {readCount} 篇</p>
      </div>
    );
    return (
      <div className="mx-auto max-w-[680px]">
        <p className="text-[12px] tracking-wide" style={{ color: FAINT }}>
          {activeMeta.secT} <span className="px-1">/</span> 第 {idx + 1} 篇
        </p>
        <h1 className="mt-1.5 text-[26px] font-bold leading-snug" style={{ fontFamily: SERIF, color: INK }}>{activeMeta.t}</h1>
        <div className="my-4 h-px w-14" style={{ backgroundColor: ACC }} />

        {artState === "loading" && <p className="py-10 text-center text-[13px]" style={{ color: FAINT }}>翻页中…</p>}
        {artState === "error" && <p className="py-10 text-center text-[13px]" style={{ color: FAINT }}>这一页没翻开,稍后再试</p>}
        {artState === "idle" && cache[activeMeta.id] && <MdView md={cache[activeMeta.id]} />}

        <div className="mt-10 flex items-center justify-between border-t pt-4 text-[13px]" style={{ borderColor: LINE }}>
          {prev ? (
            <button onClick={() => openArt(prev)} className="flex items-center gap-1 transition-colors hover:opacity-70" style={{ color: MUT }}>
              <ChevronLeft size={14} /><span className="max-w-[140px] truncate sm:max-w-[220px]">{prev.t}</span>
            </button>
          ) : <span />}
          {next ? (
            <button onClick={() => openArt(next)} className="flex items-center gap-1 transition-colors hover:opacity-70" style={{ color: MUT }}>
              <span className="max-w-[140px] truncate sm:max-w-[220px]">{next.t}</span><ChevronRight size={14} />
            </button>
          ) : <span />}
        </div>
      </div>
    );
  };

  /* ---------- 加载 / 错误壳 ---------- */
  if (!toc) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: PAPER, color: FAINT }}>
        <p className="text-[13px] tracking-widest">{tocErr ? "笔记暂时没翻开,稍后再来" : "翻开笔记…"}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: PAPER, color: INK }}>
      {/* 顶栏:极简纸感 */}
      <header className="sticky top-0 z-30 border-b backdrop-blur-sm" style={{ borderColor: LINE, backgroundColor: "rgba(247,243,234,0.92)" }}>
        <div className="mx-auto flex h-[54px] max-w-[1180px] items-center gap-3 px-4">
          <button onClick={() => { setPhase("home"); setQ(""); }} className="flex items-baseline gap-2">
            <span className="text-[17px] font-bold tracking-wide" style={{ fontFamily: SERIF }}>雷司令投资笔记</span>
            <span className="hidden text-[11px] sm:inline" style={{ color: FAINT }}>{toc.tagline}</span>
          </button>
          <div className="ml-auto flex items-center gap-3">
            <div className="relative hidden items-center sm:flex">
              <Search size={13} className="absolute left-2.5" style={{ color: FAINT }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜 K线 / MACD / 止损…"
                className="w-[190px] rounded border py-1.5 pl-7 pr-2 text-[12.5px] outline-none placeholder:text-[#b5ab99]"
                style={{ borderColor: LINE, backgroundColor: CARD, color: INK }} />
            </div>
            <span className="text-[11.5px] tabular-nums" style={{ color: FAINT }}>已读 {readCount}/{total}</span>
            <a href="/" className="rounded border px-2.5 py-1 text-[11.5px] transition-colors hover:opacity-80"
              style={{ borderColor: LINE, color: MUT }}>
              我不是股神 ↗
            </a>
          </div>
        </div>
        {/* 搜索结果浮层 */}
        {hits.length > 0 && (
          <div className="absolute left-0 right-0 top-[54px] border-b shadow-sm" style={{ borderColor: LINE, backgroundColor: CARD }}>
            <div className="mx-auto max-w-[1180px] px-4 py-2">
              {hits.map((h) => (
                <button key={h.id} onClick={() => openArt(h)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-[#f0e9da]" style={{ color: MUT }}>
                  <span style={{ color: FAINT }}>{h.secT}</span><span className="font-medium" style={{ color: INK }}>{h.t}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* ===== 桌面三栏 ===== */}
      <div className="mx-auto hidden max-w-[1180px] gap-0 px-4 lg:grid lg:grid-cols-[104px_248px_1fr]">
        {/* 一级:大栏目 */}
        <nav className="sticky top-[54px] h-[calc(100vh-54px)] overflow-y-auto border-r py-4 pr-2" style={{ borderColor: LINE }}>
          {sections.map((s) => {
            const active = s.key === secKey;
            const done = s.items.filter((it) => readSet.has(it.id)).length;
            return (
              <button key={s.key} onClick={() => { setSecKey(s.key); }}
                className="mb-1 flex w-full flex-col items-center gap-1 rounded-md px-1 py-2.5 transition-colors"
                style={{ backgroundColor: active ? "#f0e9da" : "transparent" }}>
                <span className="text-[19px] leading-none">{s.icon}</span>
                <span className="text-[11.5px] font-medium" style={{ color: active ? INK : MUT, fontFamily: SERIF }}>{s.t}</span>
                <span className="text-[9.5px] tabular-nums" style={{ color: done === s.items.length && done > 0 ? ACC : FAINT }}>{done}/{s.items.length}</span>
              </button>
            );
          })}
        </nav>
        {/* 二级:条目 */}
        <aside className="sticky top-[54px] h-[calc(100vh-54px)] overflow-y-auto border-r px-2 py-4" style={{ borderColor: LINE }}>
          {activeSec ? (
            <>
              <p className="px-2.5 pb-2 text-[11px] leading-relaxed" style={{ color: FAINT }}>{activeSec.blurb}</p>
              <SecList />
            </>
          ) : (
            <p className="px-3 pt-8 text-center text-[12px] leading-loose" style={{ color: FAINT }}>← 点左侧栏目<br />展开这一章的目录</p>
          )}
        </aside>
        {/* 三级:内容 */}
        <main className="min-h-[calc(100vh-54px)] px-8 py-7">
          <Reader />
        </main>
      </div>

      {/* ===== 移动两级下钻 ===== */}
      <div className="lg:hidden">
        {phase === "home" && (
          <div className="mx-auto max-w-[560px] px-4 py-5">
            <div className="relative mb-4 flex items-center sm:hidden">
              <Search size={13} className="absolute left-3" style={{ color: FAINT }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜 K线 / MACD / 止损…"
                className="w-full rounded border py-2 pl-8 pr-3 text-[13px] outline-none placeholder:text-[#b5ab99]"
                style={{ borderColor: LINE, backgroundColor: CARD, color: INK }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {sections.map((s) => {
                const done = s.items.filter((it) => readSet.has(it.id)).length;
                return (
                  <button key={s.key} onClick={() => { setSecKey(s.key); setPhase("list"); }}
                    className="rounded-lg border p-4 text-left transition-transform active:scale-[0.98]"
                    style={{ borderColor: LINE, backgroundColor: CARD }}>
                    <div className="text-[22px]">{s.icon}</div>
                    <div className="mt-2 text-[15px] font-bold" style={{ fontFamily: SERIF }}>{s.t}</div>
                    <div className="mt-1 text-[11px] leading-relaxed" style={{ color: FAINT }}>{s.blurb}</div>
                    <div className="mt-2 text-[10.5px] tabular-nums" style={{ color: done > 0 ? ACC : FAINT }}>{done}/{s.items.length} 已读</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {phase === "list" && activeSec && (
          <div className="mx-auto max-w-[560px] px-4 py-4">
            <button onClick={() => setPhase("home")} className="mb-3 flex items-center gap-1 text-[12.5px]" style={{ color: MUT }}>
              <ChevronLeft size={14} />全部栏目
            </button>
            <h2 className="flex items-center gap-2 text-[19px] font-bold" style={{ fontFamily: SERIF }}>
              <span>{activeSec.icon}</span>{activeSec.t}
            </h2>
            <p className="mt-1 pb-3 text-[12px]" style={{ color: FAINT }}>{activeSec.blurb}</p>
            <SecList />
          </div>
        )}
        {phase === "read" && (
          <div className="mx-auto max-w-[620px] px-4 py-4">
            <button onClick={() => setPhase("list")} className="mb-4 flex items-center gap-1 text-[12.5px]" style={{ color: MUT }}>
              <ChevronLeft size={14} />{activeSec?.t || "目录"}
            </button>
            <Reader />
          </div>
        )}
      </div>

      {/* 页脚免责(合规三处之一) */}
      <footer className="border-t py-6 text-center text-[11px] leading-relaxed" style={{ borderColor: LINE, color: FAINT }}>
        <p style={{ fontFamily: SERIF }}>雷司令投资笔记</p>
        <p className="mt-1">本笔记为投资知识科普资料,不构成任何投资建议 · 投资有风险,决策请独立</p>
      </footer>

    </div>
  );
}
