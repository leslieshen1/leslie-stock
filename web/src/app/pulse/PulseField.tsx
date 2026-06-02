"use client";

import { useEffect, useRef } from "react";
import {
  LAYERS as DEFAULT_LAYERS,
  type CompanyWithHeat,
  type Layer,
  type Edge,
} from "@/lib/supply-chain";

interface Particle {
  data: ScoredCompany;
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetY: number;
  baseR: number;
  phase: number;
  flickerPhase: number;
  dischargeNextT: number;
  appearAt: number;
  crossPhase: number;
}

export type ColorMode = "heat" | "triple";

interface ScoredCompany extends CompanyWithHeat {
  triple: number;     // 三方综合平均分 0-100
}

interface Props {
  items: ScoredCompany[];
  edges: Edge[];
  marketAvg: number;            // mode 对应的全局平均
  colorMode: ColorMode;
  onSelect: (c: CompanyWithHeat | null) => void;
  selectedId: string | null;
  highlightLayer: string | null;
  /** 当前 industry 的 layers（不传 = 用默认 AI L0-L7）。layer.id 必须和 item.layer 对得上。 */
  layers?: { id: string; name: string }[];
}

// ===================== 8 档色阶（冷端拉黑） =====================
// 深紫黑（死气沉沉）→ 深蓝 → 蓝 → 青 → 翠绿 → 琥珀 → 橙 → 品红
const STOPS = [
  { p: 0.00, h: 252, s: 55, l: 18 }, // 死气深紫黑（极冷·deep value）
  { p: 0.12, h: 246, s: 70, l: 32 }, // 深蓝紫
  { p: 0.28, h: 218, s: 82, l: 50 }, // blue
  { p: 0.42, h: 178, s: 75, l: 48 }, // cyan
  { p: 0.56, h: 145, s: 72, l: 48 }, // emerald
  { p: 0.70, h:  68, s: 88, l: 54 }, // lime
  { p: 0.82, h:  35, s: 95, l: 56 }, // amber
  { p: 0.92, h:  12, s: 95, l: 56 }, // orange
  { p: 1.00, h: 340, s: 92, l: 60 }, // 品红 危险
];

function hslLerp(a: typeof STOPS[number], b: typeof STOPS[number], k: number) {
  let dh = b.h - a.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return {
    h: (a.h + dh * k + 360) % 360,
    s: a.s + (b.s - a.s) * k,
    l: a.l + (b.l - a.l) * k,
  };
}

function heatColor(heat: number, alpha: number): string {
  const t = Math.max(0, Math.min(100, heat)) / 100;
  let i = 0;
  while (i < STOPS.length - 1 && STOPS[i + 1].p < t) i++;
  const a = STOPS[i];
  const b = STOPS[Math.min(i + 1, STOPS.length - 1)];
  const span = (b.p - a.p) || 1;
  const k = (t - a.p) / span;
  const { h, s, l } = hslLerp(a, b, k);
  return `hsla(${h.toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%, ${alpha})`;
}

// Triple 色阶：低分 = 红警（基本面差），高分 = 金/翠绿（顶级好资产）
// 这样和 heat 模式的红色含义一致：红 = 避开
const TRIPLE_STOPS = [
  { p: 0.00, h: 358, s: 88, l: 50 }, // 红警（基本面差）
  { p: 0.20, h:  18, s: 92, l: 54 }, // 橙
  { p: 0.40, h:  42, s: 92, l: 56 }, // 琥珀（中性偏弱）
  { p: 0.55, h: 200, s: 65, l: 52 }, // 蓝（合理）
  { p: 0.70, h: 160, s: 70, l: 48 }, // 翠绿（好）
  { p: 0.85, h: 145, s: 78, l: 46 }, // 深绿
  { p: 1.00, h: 165, s: 90, l: 50 }, // teal 金（顶级）
];

function tripleColor(score: number, alpha: number): string {
  const t = Math.max(0, Math.min(100, score)) / 100;
  let i = 0;
  while (i < TRIPLE_STOPS.length - 1 && TRIPLE_STOPS[i + 1].p < t) i++;
  const a = TRIPLE_STOPS[i];
  const b = TRIPLE_STOPS[Math.min(i + 1, TRIPLE_STOPS.length - 1)];
  const span = (b.p - a.p) || 1;
  const k = (t - a.p) / span;
  const { h, s, l } = hslLerp(a, b, k);
  return `hsla(${h.toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%, ${alpha})`;
}

export default function PulseField({
  items, edges, marketAvg, colorMode,
  onSelect, selectedId, highlightLayer,
  layers,
}: Props) {
  // 当前 industry 的 layers（不传 = AI 默认）
  const LAYERS_LIVE: { id: string; name: string }[] = layers && layers.length > 0
    ? layers
    : (DEFAULT_LAYERS as Layer[]).map((L) => ({ id: L.id, name: L.name }));

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const hoverRef = useRef<Particle | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId);
  const highlightRef = useRef<string | null>(highlightLayer);
  const colorModeRef = useRef<ColorMode>(colorMode);
  const layersRef = useRef(LAYERS_LIVE);
  const rafRef = useRef<number | null>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const tickerMapRef = useRef<Map<string, Particle>>(new Map());

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { highlightRef.current = highlightLayer; }, [highlightLayer]);
  useEffect(() => { colorModeRef.current = colorMode; }, [colorMode]);
  useEffect(() => { layersRef.current = LAYERS_LIVE; }, [LAYERS_LIVE]);

  // 每个粒子在当前 mode 下的实际颜色 score
  // heat mode: 直接用 heat (高=过热=红)
  // triple mode: 直接用 triple (高=优质=绿/金)
  function scoreOf(p: Particle): number {
 return colorModeRef.current === "heat" ? p.data.heat : p.data.triple;
  }
  function colorOf(score: number, alpha: number): string {
 return colorModeRef.current === "heat" ? heatColor(score, alpha) : tripleColor(score, alpha);
  }

  function layoutParticles(w: number, h: number) {
    const LIVE = layersRef.current;
    const laneH = h / LIVE.length;
    const padX = 100;
    const usableW = w - padX - 30;

    const now = performance.now();
    const parts: Particle[] = items.map((data) => {
      const layerIdx = LIVE.findIndex((L) => L.id === data.layer);
      const laneTop = layerIdx * laneH;
      const sameLayer = items.filter((x) => x.layer === data.layer);
      const sameIdx = sameLayer.indexOf(data);
      const xRatio = (sameIdx + 0.5) / sameLayer.length;
      const x = padX + xRatio * usableW + (Math.random() - 0.5) * 28;
      // 初始 y 随机分布 lane 内
      const y = laneTop + laneH * 0.5 + (Math.random() - 0.5) * laneH * 0.55;
      // targetY 在 tick 里动态算（按 colorMode 切换：高分上浮、低分下沉）
      const targetY = y;
      const baseR = 2.8 + Math.log10(Math.max(1, data.marketCapB)) * 2.4;
      // 入场：按层 stagger 130ms，同层内再随机 0-80ms 错峰
      const appearAt = now + layerIdx * 130 + Math.random() * 80;
      return {
        data, x, y,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.10,
        targetY,
        baseR,
        phase: Math.random() * 4000,
        flickerPhase: Math.random() * 1000,
        dischargeNextT: now + 500 + Math.random() * 3000,
        appearAt,
        crossPhase: Math.random() * Math.PI * 2,
      };
    });
    particlesRef.current = parts;

    // ticker → particle map（连线用）
    const map = new Map<string, Particle>();
    for (const p of parts) map.set(p.data.ticker, p);
    tickerMapRef.current = map;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
 const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function resize() {
      if (!wrap || !canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      sizeRef.current = { w, h };
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      layoutParticles(w, h);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    function onMove(e: MouseEvent) {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    function onLeave() { mouseRef.current = null; hoverRef.current = null; }
    function onClick() { onSelect(hoverRef.current ? hoverRef.current.data : null); }
 canvas.addEventListener("mousemove", onMove);
 canvas.addEventListener("mouseleave", onLeave);
 canvas.addEventListener("click", onClick);

    function tick(t: number) {
      if (!ctx) return;
      const { w, h } = sizeRef.current;

      // 拖尾背景：从 0.20 调到 0.45，让画面更快擦除（不再糊）
 ctx.fillStyle = "rgba(6, 8, 16, 0.45)";
      ctx.fillRect(0, 0, w, h);

      // 层背景线 + 标签
      const LIVE = layersRef.current;
      const laneH = h / LIVE.length;

      // ===== 产业链上下游主轴（spine）：左侧垂直轴 + 节点 + 箭头流向 =====
      const spineX = 22;
      const spinePulseT = (t / 2200) % 1; // 0..1 循环
      // 主轴垂直线（贯穿所有节点中心）
 ctx.strokeStyle = "rgba(180, 200, 255, 0.18)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(spineX, laneH * 0.5);
      ctx.lineTo(spineX, h - laneH * 0.5);
      ctx.stroke();

      // 节点间的「流光」 — 一个亮点沿主轴从上往下走（上游→下游）
      if (LIVE.length > 1) {
        const flowY = laneH * 0.5 + (h - laneH) * spinePulseT;
        const flowGrad = ctx.createRadialGradient(spineX, flowY, 0, spineX, flowY, 14);
 flowGrad.addColorStop(0, "rgba(180, 220, 255, 0.65)");
 flowGrad.addColorStop(1, "rgba(180, 220, 255, 0)");
        ctx.fillStyle = flowGrad;
        ctx.beginPath();
        ctx.arc(spineX, flowY, 14, 0, Math.PI * 2);
        ctx.fill();
      }

      // 节点 + 向下箭头
      for (let i = 0; i < LIVE.length; i++) {
        const cy = i * laneH + laneH * 0.5;
        const L = LIVE[i];
        const dim = highlightRef.current && highlightRef.current !== L.id;
        // 节点圈
 ctx.fillStyle = dim ? "rgba(180, 200, 255, 0.3)" : "rgba(180, 220, 255, 0.85)";
        ctx.beginPath();
        ctx.arc(spineX, cy, 4, 0, Math.PI * 2);
        ctx.fill();
        // 节点外圈光晕
 ctx.strokeStyle = dim ? "rgba(180, 200, 255, 0.12)" : "rgba(180, 220, 255, 0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(spineX, cy, 7, 0, Math.PI * 2);
        ctx.stroke();

        // 向下箭头（最后一层不画）
        if (i < LIVE.length - 1) {
          const arrowY = cy + laneH * 0.5;
 ctx.fillStyle = dim ? "rgba(180, 200, 255, 0.18)" : "rgba(180, 220, 255, 0.55)";
          ctx.beginPath();
          ctx.moveTo(spineX - 3.5, arrowY - 3);
          ctx.lineTo(spineX + 3.5, arrowY - 3);
          ctx.lineTo(spineX, arrowY + 2);
          ctx.closePath();
          ctx.fill();
        }
      }

      // 顶部「上游」/ 底部「下游 / 应用」标签
 ctx.fillStyle = "rgba(180, 220, 255, 0.55)";
 ctx.font = "9px 'JetBrains Mono', monospace";
 ctx.textBaseline = "top";
 ctx.fillText("上游", spineX - 9, 6);
 ctx.textBaseline = "bottom";
 ctx.fillText("下游", spineX - 9, h - 6);

      // ===== Layer 背景分隔线 + 标签 =====
      for (let i = 0; i < LIVE.length; i++) {
        const yTop = i * laneH;
        const L = LIVE[i];
        const dim = highlightRef.current && highlightRef.current !== L.id;
 ctx.strokeStyle = dim ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.065)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(40, yTop); // 从 spine 右侧起，避免与轴重叠
        ctx.lineTo(w, yTop);
        ctx.stroke();

 ctx.fillStyle = dim ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.55)";
 ctx.font = "10px 'JetBrains Mono', monospace";
 ctx.textBaseline = "top";
        ctx.fillText(L.id, 40, yTop + 10);
 ctx.font = "13px 'Inter', system-ui, sans-serif";
 ctx.fillStyle = dim ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.85)";
        ctx.fillText(L.name, 70, yTop + 8);
      }

      // 鼠标命中
      let nearest: Particle | null = null;
      let nearestDist = 20;
      const m = mouseRef.current;

      // 上浮 / 下沉 + 普通漂浮（未入场的粒子也要算位置，但不参与碰撞反弹）
      for (const p of particlesRef.current) {
        const appearD = t - p.appearAt;
        if (appearD < 0) continue;
        p.x += p.vx;
        p.y += p.vy;

        const layerIdx = LIVE.findIndex((L) => L.id === p.data.layer);
        const laneTop = layerIdx * laneH;
        const laneTopB = laneTop + 22;
        const laneBot = (layerIdx + 1) * laneH - 8;
        // 动态 targetY: 当前 mode score 决定上浮 / 下沉
        const s = scoreOf(p) / 100;
        p.targetY = laneTop + 28 + (1 - s) * (laneH - 50);
        p.y += (p.targetY - p.y) * 0.012;

        if (p.x < 100 || p.x > w - 28) p.vx *= -1;
        if (p.y < laneTopB || p.y > laneBot) p.vy *= -1;
      }

      // ===== 连线：默认所有上下游 edges 微亮显示 + hover/selected 节点对应连线高亮 =====
      const focusTicker =
        (hoverRef.current && hoverRef.current.data.ticker) ||
        (selectedIdRef.current
          ? particlesRef.current.find((p) => p.data.id === selectedIdRef.current)?.data.ticker ?? null
          : null);

      const tm = tickerMapRef.current;
      for (const e of edges) {
        const a = tm.get(e.from);
        const b = tm.get(e.to);
        if (!a || !b) continue;
        const isFocused = focusTicker && (e.from === focusTicker || e.to === focusTicker);
        // 默认 baseline，focus 时 + 0.45
        const baseAlpha = isFocused
          ? 0.20 + 0.06 * e.strength
          : (focusTicker ? 0.025 : 0.06 + 0.015 * e.strength);
        const sa = scoreOf(a);
        const sb = scoreOf(b);
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0, colorOf(sa, baseAlpha));
        grad.addColorStop(1, colorOf(sb, baseAlpha));
        ctx.strokeStyle = grad;
        ctx.lineWidth = isFocused ? 0.8 + e.strength * 0.4 : 0.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();

        // 流光粒子（focus 时显示）
        if (isFocused) {
          const pulseT = ((t / 1600) % 1);
          const midS = (sa + sb) / 2;
          const fx = a.x + (b.x - a.x) * pulseT;
          const fy = a.y + (b.y - a.y) * pulseT;
          ctx.fillStyle = colorOf(midS, 0.95);
          ctx.beginPath();
          ctx.arc(fx, fy, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ===== 粒子绘制 =====
      for (const p of particlesRef.current) {
        // 入场进度（0 = 未到、1 = 完全入场）
        const appearD = t - p.appearAt;
        if (appearD < -50) continue;
        const appearProgress = Math.max(0, Math.min(1, appearD / 520));
        if (appearProgress <= 0) continue;
        // 纯 easeOut 淡入，去掉弹跳
        const ease = 1 - Math.pow(1 - appearProgress, 3);
        const sizeMul = ease;
        const introAlpha = ease;

        const s = scoreOf(p);
        const dim = highlightRef.current && highlightRef.current !== p.data.layer;
        const isSelected = selectedIdRef.current === p.data.id;
        // 选中时其他粒子大幅淡出（focus 模式）
        const focusFade = selectedIdRef.current && !isSelected ? 0.35 : 1;
        const alphaScale = (dim ? 0.20 : 1) * introAlpha * focusFade;
        const r = p.baseR * sizeMul;

        // 单圈脉冲，且仅高分（≥75）才有，alpha 减半
        if (appearProgress >= 0.7 && s >= 75) {
          const period = 5000 - s * 35;
          const phase = ((t + p.phase) % period) / period;
          const ringR = r + phase * (r * 4 + 6);
          const ringA = (1 - phase) * 0.3 * alphaScale;
          ctx.strokeStyle = colorOf(s, ringA);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
          ctx.stroke();
        }

        // glow 光晕 — 收缩到 1.6 倍，alpha 降低
        const glowR = r * 1.6;
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
        glow.addColorStop(0, colorOf(s, 0.72 * alphaScale));
        glow.addColorStop(1, colorOf(s, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
        ctx.fill();

        // 核心
        ctx.fillStyle = colorOf(s, 1 * alphaScale);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();

        // 选中外圈
        if (isSelected) {
 ctx.strokeStyle = "rgba(255,255,255,0.95)";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.baseR + 7, 0, Math.PI * 2);
          ctx.stroke();
        }

        // 大粒子（市值 ≥ $200B）显示 ticker 标签（淡入）
        if (p.data.marketCapB >= 200 && !dim && appearProgress >= 0.6) {
 ctx.font = "9px 'JetBrains Mono', monospace";
 ctx.textAlign = "center";
 ctx.textBaseline = "top";
          ctx.fillStyle = `rgba(255,255,255,${0.55 * introAlpha * focusFade})`;
          ctx.fillText(p.data.ticker, p.x, p.y + p.baseR + 4);
 ctx.textAlign = "start";
        }

        // hover 检测
        if (m) {
          const dx = m.x - p.x;
          const dy = m.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = p;
          }
        }
      }
      hoverRef.current = nearest;

      // Tooltip
      if (nearest && m) {
        const ns = scoreOf(nearest);
        const tip = `${nearest.data.ticker}  ·  ${nearest.data.name}`;
 const label = colorModeRef.current === "heat" ? "热度" : "三方";
        const tip2 = `${label} ${ns} · ${nearest.data.region} · $${nearest.data.marketCapB}B`;
 ctx.font = "12px 'Inter', system-ui, sans-serif";
        const w1 = ctx.measureText(tip).width;
        const w2 = ctx.measureText(tip2).width;
        const boxW = Math.max(w1, w2) + 16;
        const boxH = 38;
        let tx = nearest.x + 14;
        let ty = nearest.y - boxH - 10;
        if (tx + boxW > w) tx = nearest.x - boxW - 14;
        if (ty < 0) ty = nearest.y + 14;
 ctx.fillStyle = "rgba(6,8,16,0.94)";
        ctx.strokeStyle = colorOf(ns, 0.92);
        ctx.lineWidth = 1;
        ctx.fillRect(tx, ty, boxW, boxH);
        ctx.strokeRect(tx, ty, boxW, boxH);
 ctx.fillStyle = "#fff";
 ctx.textBaseline = "top";
        ctx.fillText(tip, tx + 8, ty + 6);
 ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.fillText(tip2, tx + 8, ty + 21);
      }

      // Calm Mode: 取消 vignette + 心跳缩放
      // （之前会让整个画面颤动，干扰阅读）

      // cursor
 if (canvas) canvas.style.cursor = nearest ? "pointer" : "default";

      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      ro.disconnect();
 canvas.removeEventListener("mousemove", onMove);
 canvas.removeEventListener("mouseleave", onLeave);
 canvas.removeEventListener("click", onClick);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
 if (wrap) wrap.style.transform = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, edges, marketAvg, onSelect]);

  return (
    <div
      ref={wrapRef}
 className="relative h-[720px] w-full overflow-hidden rounded-2xl bg-[#06080F] origin-center will-change-transform"
    >
 <canvas ref={canvasRef} className="block h-full w-full" />
 <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-white/10" />
    </div>
  );
}
