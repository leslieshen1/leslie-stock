"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { FinancialsHistory } from "@/lib/data";

type SeriesConfig = {
  key: keyof FinancialsHistory;
  label: string;
  color: string;
 good: number | null; // 红线参考（"健康"的下限或上限）
 goodDir: "above" | "below"; // 红线意义：above=高于线为好，below=低于线为好
  unit: string;
};

const SERIES: SeriesConfig[] = [
 { key: "roe", label: "ROE", color: "#10b981", good: 15, goodDir: "above", unit: "%" },
 { key: "gross_margin", label: "毛利率", color: "#3b82f6", good: 30, goodDir: "above", unit: "%" },
 { key: "net_margin", label: "净利率", color: "#8b5cf6", good: 10, goodDir: "above", unit: "%" },
 { key: "debt_ratio", label: "资产负债率", color: "#f59e0b", good: 60, goodDir: "below", unit: "%" },
];

export default function FinancialsCharts({ history }: { history: FinancialsHistory }) {
  const dates = history.dates || [];
  if (dates.length === 0) {
    return (
 <div className="rounded-xl border border-dashed border-line-2 bg-surface p-8 text-center text-sm text-muted">
         暂无历史财务数据
      </div>
    );
  }

  return (
 <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {SERIES.map((s) => {
        const vals = (history[s.key] as (number | null)[] | undefined) || [];
        const data = dates.map((d, i) => ({
          year: d,
          value: vals[i] !== null && vals[i] !== undefined ? vals[i] : null,
        }));
        if (data.every((d) => d.value === null)) return null;
        return (
 <div key={s.key} className="rounded-xl border border-line bg-surface p-4">
 <div className="mb-2 flex items-baseline justify-between">
 <h3 className="text-sm font-semibold text-ink">{s.label}</h3>
 <span className="text-[10px] text-faint">5 年历史 · {s.unit}</span>
            </div>
 <ResponsiveContainer width="100%" height={180}>
              <LineChart data={data} margin={{ top: 10, right: 18, left: -10, bottom: 0 }}>
 <CartesianGrid stroke="#f4f4f5" />
 <XAxis dataKey="year" tick={{ fontSize: 11, fill: "#71717a" }} stroke="#d4d4d8" />
 <YAxis tick={{ fontSize: 11, fill: "#71717a" }} stroke="#d4d4d8" />
                <Tooltip
                  contentStyle={{
 backgroundColor: "#fff",
 border: "1px solid #e4e4e7",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v) =>
 typeof v === "number" ? `${v.toFixed(2)}${s.unit}` : "—"
                  }
                />
                {s.good !== null && (
                  <ReferenceLine
                    y={s.good}
 stroke={s.goodDir === "above" ? "#10b981" : "#ef4444"}
 strokeDasharray="3 3"
                    label={{
 value: s.goodDir === "above" ? `≥ ${s.good}` : `≤ ${s.good}`,
 position: "right",
                      fontSize: 10,
 fill: "#a1a1aa",
                    }}
                  />
                )}
                <Line
 type="monotone"
 dataKey="value"
                  stroke={s.color}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: s.color }}
                  activeDot={{ r: 6 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}
