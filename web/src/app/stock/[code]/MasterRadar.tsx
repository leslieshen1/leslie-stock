import { MASTERS } from "@/lib/masters";
import type { UsPanel } from "@/lib/us-panel";

// 5 方评分雷达图(纯 SVG,服务端渲染)。形状即分歧:饱满=共识,尖刺=打架。
const CX = 170, CY = 130, R = 78, N = 5;

function pt(frac: number, i: number): [number, number] {
  const a = ((i * 360) / N - 90) * (Math.PI / 180);
  return [CX + R * frac * Math.cos(a), CY + R * frac * Math.sin(a)];
}
function color(s: number | null): string {
  if (s == null) return "#586172";
  if (s >= 70) return "#3fd093"; // up
  if (s >= 55) return "#e0734d"; // accent
  if (s >= 40) return "#7e8796"; // muted
  return "#ef6a6a";             // down
}
function anchorOf(i: number): "start" | "middle" | "end" {
  const [x] = pt(1, i);
  if (Math.abs(x - CX) < 6) return "middle";
  return x > CX ? "start" : "end";
}

export default function MasterRadar({ panel }: { panel: UsPanel["panel"] }) {
  const rows = MASTERS.map((m) => ({ name: m.name, score: panel[m.key]?.score ?? null }));
  const present = rows.map((r) => r.score).filter((s): s is number => s != null);
  const div = present.length >= 2 ? Math.max(...present) - Math.min(...present) : 0;

  const rings = [0.25, 0.5, 0.75, 1].map((f) => rows.map((_, i) => pt(f, i).join(",")).join(" "));
  const dataPoly = rows.map((r, i) => pt((r.score ?? 0) / 100, i).join(",")).join(" ");

  return (
    <svg viewBox="0 0 360 250" className="w-full max-w-[360px]" role="img" aria-label="5 方评分雷达图">
      <defs>
        <radialGradient id="mr-fill" cx="50%" cy="50%" r="62%">
          <stop offset="0%" stopColor="rgba(224,115,77,0.34)" />
          <stop offset="100%" stopColor="rgba(224,115,77,0.04)" />
        </radialGradient>
        <filter id="mr-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 网格环 */}
      {rings.map((r, i) => (
        <polygon key={`g${i}`} points={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
      ))}
      {/* 轴线 */}
      {rows.map((_, i) => {
        const [x, y] = pt(1, i);
        return <line key={`a${i}`} x1={CX} y1={CY} x2={x} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />;
      })}

      {/* 从中心弹出的动效(纯 CSS,服务端渲染也能跑) */}
      <style>{`@keyframes mrPop{from{opacity:0;transform:scale(.25)}to{opacity:1;transform:scale(1)}}.mr-data{transform-box:view-box;transform-origin:${CX}px ${CY}px;animation:mrPop .7s cubic-bezier(.2,.8,.25,1) both}`}</style>
      <g className="mr-data">
        {/* 评分多边形 */}
        <polygon points={dataPoly} fill="url(#mr-fill)" stroke="#e0734d" strokeWidth={1.7}
                 strokeLinejoin="round" filter="url(#mr-glow)" />
        {/* 顶点(按分上色) */}
        {rows.map((r, i) => {
          const [x, y] = pt((r.score ?? 0) / 100, i);
          return <circle key={`v${i}`} cx={x} cy={y} r={r.score == null ? 2 : 3.6} fill={color(r.score)} />;
        })}
      </g>

      {/* 中心:分歧度 */}
      <text x={CX} y={CY - 3} textAnchor="middle" fill="#6b7484" style={{ fontSize: 8, letterSpacing: 1 }}>分歧</text>
      <text x={CX} y={CY + 12} textAnchor="middle" fontWeight={700}
            fill={div >= 40 ? "#e0734d" : "#7e8796"} style={{ fontSize: 16 }}>{div}</text>

      {/* 轴标签:名字 + 分数 */}
      {rows.map((r, i) => {
        const [x, y] = pt(1.16, i);
        const a = anchorOf(i);
        return (
          <text key={`l${i}`} x={x} y={y} textAnchor={a} dominantBaseline="middle">
            <tspan fill="#e7e9ee" fontWeight={600} style={{ fontSize: 10.5 }}>{r.name}</tspan>
            <tspan dx={5} fill={color(r.score)} fontWeight={700} style={{ fontSize: 11.5 }}>
              {r.score ?? "—"}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
