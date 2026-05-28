import Link from "next/link";
import { loadAleabitManifest } from "@/lib/data";
import ScanClient from "./ScanClient";

export default function ScanPage() {
  const items = loadAleabitManifest();

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-6 border-b border-zinc-200 pb-6">
        <div className="mb-3 flex items-center gap-3 text-sm">
          <Link href="/" className="text-zinc-500 hover:text-zinc-900">
            ← 脉冲热力图
          </Link>
          <span className="text-zinc-300">/</span>
          <Link href="/watchlist" className="text-violet-600 hover:text-violet-800 font-medium">
            ⭐ 我的观察列表
          </Link>
        </div>
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
              Serenity 瓶颈狙击 · A 股全市场扫描
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              基于 @aleabitoreddit 的方法论 · 通用 chokepoint 框架（任何产业链） · 共 {items.length} 只 A 股 · 点 ☆ 加入观察列表
            </p>
          </div>
        </div>
      </header>

      <ScanClient items={items} />

      <footer className="mt-16 border-t border-zinc-200 pt-6 text-center text-xs text-zinc-400">
        我不是股神 · Not a Stock Guru · Serenity 框架复刻（非投资建议）
      </footer>
    </main>
  );
}
