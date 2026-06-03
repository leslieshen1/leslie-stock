import Link from "next/link";
import ScanClient from "./ScanClient";

// 数据(A股 manifest 2.5MB + 美股 1.2MB)改由客户端按需 fetch 静态 JSON,
// 不再 SSR 序列化进 HTML —— 否则页面 ~4MB,手机上 hydrate 1.1万对象会卡死打不开。
export default function ScanPage() {
  return (
 <main className="mx-auto max-w-7xl px-6 py-10">
 <header className="mb-6 border-b border-line pb-6">
 <div className="mb-3 flex items-center gap-3 text-sm">
 <Link href="/" className="text-muted hover:text-ink">
            ← 脉冲热力图
          </Link>
 <span className="text-faint">/</span>
 <Link href="/portfolio" className="text-accent hover:text-accent font-medium">
             我的观察列表
          </Link>
        </div>
 <div className="flex items-baseline justify-between">
          <div>
 <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink">
              全市场扫描
            </h1>
 <p className="mt-1 text-sm text-muted">
              美股 · 市值 / 动量　|　A 股 · 瓶颈狙击评分
            </p>
          </div>
        </div>
      </header>

      <ScanClient />

 <footer className="mt-16 border-t border-line pt-6 text-center text-xs text-faint">
        我不是股神 · Not a Stock Guru · A股 Serenity 框架 + 美股 Nasdaq 全市场（非投资建议）
      </footer>
    </main>
  );
}
