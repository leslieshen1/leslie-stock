import Link from "next/link";
import { loadAleabitManifest } from "@/lib/data";
import ScanClient from "./ScanClient";

export default function ScanPage() {
  const items = loadAleabitManifest();

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-6 border-b border-zinc-200 pb-6">
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
              Serenity 瓶颈狙击 · A 股全市场扫描
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              基于 @aleabitoreddit 的 4 层供应链 + 7 信号 chokepoint checklist · 共 {items.length} 只 A 股
            </p>
          </div>
        </div>
      </header>

      <ScanClient items={items} />

      <footer className="mt-16 border-t border-zinc-200 pt-6 text-center text-xs text-zinc-400">
        Leslie-stock · Serenity 框架复刻（非投资建议）· 风格 / 框架 / 评分都是基于公开方法论的复刻
      </footer>
    </main>
  );
}
