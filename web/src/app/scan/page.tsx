import Link from "next/link";
import ScanClient from "./ScanClient";

export const metadata = {
  title: "全市场扫描 · 美股+A股五方判读 · 我不是股神",
  description: "美股 + A 股全市场扫描:段永平/巴菲特/Serenity/德鲁肯米勒/情绪面五方独立判读 + 实时行情筛选。非投资建议。",
};

// 数据(A股 manifest 2.5MB + 美股 1.2MB)改由客户端按需 fetch 静态 JSON,
// 不再 SSR 序列化进 HTML —— 否则页面 ~4MB,手机上 hydrate 1.1万对象会卡死打不开。
export default function ScanPage() {
  return (
 <main className="mx-auto max-w-6xl px-6 pb-10 pt-3">
 <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-3">
 <h1 className="text-[22px] font-semibold tracking-tight text-ink">全市场扫描</h1>
 <p className="hidden text-xs text-faint sm:block">美股 + A股 · 五方判读(段永平/巴菲特/Serenity/德鲁肯米勒/情绪)</p>
 <Link href="/portfolio" className="ml-auto text-xs font-medium text-accent hover:underline"> 我的观察列表</Link>
      </header>

      <ScanClient />

 <footer className="mt-16 border-t border-line pt-6 text-center text-xs text-faint">
        我不是股神 · Not a Stock God · A股 + 美股统一五方判读（非投资建议）
      </footer>
    </main>
  );
}
