import Link from "next/link";
import WatchlistClient from "./WatchlistClient";

export const metadata = {
 title: "观察列表 · 我不是股神",
};

export default function WatchlistPage() {
  return (
 <main className="mx-auto max-w-5xl px-6 py-10">
 <header className="mb-6 border-b border-line pb-6">
 <div className="mb-3 flex items-center gap-3 text-sm">
 <Link href="/" className="text-muted hover:text-ink">
            ← 脉冲热力图
          </Link>
 <span className="text-faint">/</span>
 <Link href="/scan" className="text-muted hover:text-ink">
            全市场扫描
          </Link>
        </div>
 <div className="flex items-baseline justify-between">
          <div>
 <h1 className="text-3xl font-semibold tracking-tight text-ink">
              我的观察列表
            </h1>
 <p className="mt-1 text-sm text-muted">
 从{" "}
 <Link href="/scan" className="text-accent hover:underline">
                全市场扫描
 </Link>{" "}
              里点 ☆ 加入。仅保存在你这个浏览器（localStorage），不上传服务器。
            </p>
          </div>
        </div>
      </header>

      <WatchlistClient />

 <footer className="mt-16 border-t border-line pt-6 text-center text-xs text-faint">
        我不是股神 · 观察列表存在 localStorage · 清浏览器数据会丢
      </footer>
    </main>
  );
}
