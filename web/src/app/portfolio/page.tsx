import Link from "next/link";
import {
  loadPortfolio,
  loadLatestBriefing,
  loadAnalysis,
  loadNewsAnalysis,
  dayDiff,
  type Position,
  type Analysis,
  type NewsAnalysis,
} from "@/lib/data";

export default function PortfolioPage() {
  const positions = loadPortfolio();
  const briefing = loadLatestBriefing();
  const today = new Date().toISOString().slice(0, 10);

  // 每只持仓的 AI 分析 + 新闻解读
  const positionData = positions.map((p) => ({
    position: p,
    analysis: loadAnalysis(p.code, p.market),
    news: loadNewsAnalysis(p.code, p.market),
  }));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-10 flex items-baseline justify-between border-b border-zinc-200 pb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            我的持仓
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            手动维护 · core/portfolio.csv
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wider text-zinc-400">今日</p>
          <p className="text-lg font-medium text-zinc-700">{today}</p>
        </div>
      </header>

      <section className="mb-10">
        <h2 className="mb-4 text-lg font-medium text-zinc-700">持仓总览</h2>
        {positions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center">
            <p className="text-zinc-500">
              还没有持仓。编辑{" "}
              <code className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-xs">
                core/portfolio.csv
              </code>{" "}
              添加你的持仓。
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">股票</th>
                  <th className="px-4 py-3 text-left font-medium">市场</th>
                  <th className="px-4 py-3 text-right font-medium">买入价</th>
                  <th className="px-4 py-3 text-right font-medium">股数</th>
                  <th className="px-4 py-3 text-right font-medium">仓位</th>
                  <th className="px-4 py-3 text-right font-medium">持有</th>
                  <th className="px-4 py-3 text-left font-medium">买入逻辑</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {positions.map((p) => (
                  <tr key={p.code} className="hover:bg-zinc-50">
                    <td className="px-4 py-4">
                      <Link href={`/stock/${p.code}?market=${p.market}`} className="block hover:text-blue-600">
                        <div className="font-medium text-zinc-900 hover:text-blue-600">{p.name}</div>
                        <div className="font-mono text-xs text-zinc-500">{p.code}</div>
                      </Link>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                          p.market === "a"
                            ? "bg-red-50 text-red-700"
                            : "bg-blue-50 text-blue-700"
                        }`}
                      >
                        {p.market === "a" ? "A 股" : "港股"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-zinc-700">
                      {p.buy_price.toFixed(2)}
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-zinc-700">
                      {p.shares.toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-zinc-700">
                      {p.position_pct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-4 text-right text-zinc-500">
                      {dayDiff(p.buy_date)} 天
                    </td>
                    <td className="px-4 py-4 max-w-md text-zinc-600">{p.thesis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {positionData.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 text-lg font-medium text-zinc-700">
            每只持仓的 AI 观点
          </h2>
          <div className="space-y-4">
            {positionData.map(({ position, analysis, news }) => (
              <PositionAICard
                key={position.code}
                position={position}
                analysis={analysis}
                news={news}
              />
            ))}
          </div>
        </section>
      )}

      <section className="mb-10">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-medium text-zinc-700">
            盘后简报
            {briefing && (
              <span className="ml-2 text-sm text-zinc-400">· {briefing.date}</span>
            )}
          </h2>
          <p className="text-xs text-zinc-400">由 daily_briefing.py 自动生成</p>
        </div>
        {briefing ? (
          <article
            className="prose-leslie rounded-xl border border-zinc-200 bg-white p-8"
            dangerouslySetInnerHTML={{ __html: briefing.html }}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center">
            <p className="text-zinc-500">
              暂无简报。运行{" "}
              <code className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-xs">
                uv run python -m monitor.daily_briefing
              </code>{" "}
              生成。
            </p>
          </div>
        )}
      </section>

      <footer className="mt-16 border-t border-zinc-200 pt-6 text-center text-xs text-zinc-400">
        我不是股神 · 段永平 + 巴菲特投资 DNA · v0.5
      </footer>
    </main>
  );
}

function PositionAICard({
  position,
  analysis,
  news,
}: {
  position: Position;
  analysis: Analysis | null;
  news: NewsAnalysis | null;
}) {
  const hasAnything = analysis || news;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <div className="mb-4 flex items-baseline justify-between border-b border-zinc-100 pb-3">
        <div>
          <Link
            href={`/stock/${position.code}?market=${position.market}`}
            className="font-semibold text-zinc-900 hover:text-blue-600"
          >
            {position.name}
            <span className="ml-2 font-mono text-xs text-zinc-500">
              {position.code}
            </span>
          </Link>
          <p className="mt-0.5 text-xs text-zinc-500">
            仓位 {position.position_pct}% · 持有 {dayDiff(position.buy_date)} 天 · 买入价 ¥{position.buy_price}
          </p>
        </div>
        {analysis && (
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-zinc-400">BG 得分</p>
            <p
              className={`font-mono text-xl font-semibold ${
                analysis.overall_score >= 80
                  ? "text-emerald-600"
                  : analysis.overall_score >= 65
                  ? "text-amber-600"
                  : "text-zinc-500"
              }`}
            >
              {analysis.overall_score.toFixed(1)}
            </p>
          </div>
        )}
      </div>

      {!hasAnything && (
        <div className="rounded-lg bg-zinc-50 p-4 text-sm text-zinc-500">
          还没有 AI 分析数据。
          <Link
            href={`/stock/${position.code}?market=${position.market}`}
            className="ml-1 text-blue-600 hover:text-blue-800"
          >
            去生成 →
          </Link>
        </div>
      )}

      {analysis?.verdict && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-800">
            段永平 / 巴菲特视角 · GLM-5.1
          </p>
          <p className="text-sm text-zinc-800 leading-relaxed">{analysis.verdict}</p>
        </div>
      )}

      {news?.summary && (
        <div className="mb-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600">
              最近 {news.days || 7} 天 GLM 解读
            </span>
            {news.summary.overall_signal && (
              <span className="text-sm">{news.summary.overall_signal}</span>
            )}
            {news.summary.action_suggestion && (
              <span className="rounded bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-700">
                建议：{news.summary.action_suggestion}
              </span>
            )}
          </div>
          <p className="text-sm text-zinc-700 leading-relaxed">
            {news.summary.narrative}
          </p>
          {news.summary.sell_condition_triggered &&
            news.summary.sell_condition_triggered !== "无" && (
              <p className="mt-2 text-xs font-medium text-rose-700">
                🔴 卖出条件触发：{news.summary.sell_condition_triggered}
              </p>
            )}
        </div>
      )}

      {position.sell_conditions.length > 0 && (
        <div className="border-t border-zinc-100 pt-3">
          <p className="mb-1 text-xs font-medium text-zinc-500">你设的卖出条件：</p>
          <ul className="space-y-0.5 text-xs text-zinc-600">
            {position.sell_conditions.map((c, i) => (
              <li key={i}>• {c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
