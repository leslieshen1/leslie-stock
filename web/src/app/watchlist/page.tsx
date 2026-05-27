import { loadWatchlistEnriched } from "@/lib/data";
import SearchBox from "@/components/SearchBox";
import WatchlistDashboard from "../WatchlistDashboard";

export const metadata = {
  title: "观察列表 · Leslie-stock",
};

export default function WatchlistPage() {
  const items = loadWatchlistEnriched();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-8 border-b border-zinc-200 pb-6">
        <div className="mb-5 flex items-baseline justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
              我的观察列表
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              段永平 + 巴菲特 DNA · 通过 Claude 对话添加 ·
              <span className="ml-2 inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-xs">
                {items.length} 只跟踪中
              </span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-zinc-400">今日</p>
            <p className="text-lg font-medium text-zinc-700">{today}</p>
          </div>
        </div>
        <SearchBox />
      </header>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-16 text-center">
          <p className="mb-3 text-lg text-zinc-700">观察列表为空</p>
          <p className="text-sm text-zinc-500">
            打开 Claude Code 和我聊一只股票（&ldquo;分析下 XX&rdquo;），<br />
            觉得好的告诉我&ldquo;加入观察列表&rdquo;，就会出现在这里。
          </p>
        </div>
      ) : (
        <WatchlistDashboard items={items} />
      )}

      <footer className="mt-16 border-t border-zinc-200 pt-6 text-center text-xs text-zinc-400">
        Leslie-stock · 段永平 + 巴菲特投资 DNA · v0.4
      </footer>
    </main>
  );
}
