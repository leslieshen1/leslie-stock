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
import PortfolioTabs from "./PortfolioTabs";
import { T } from "@/lib/i18n";

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

  const holdings = (
    <>
 <section className="mb-10">
 <h2 className="mb-4 text-lg font-medium text-muted"><T zh="持仓总览" en="Holdings Overview" /></h2>
        {positions.length === 0 ? (
 <div className="rounded-xl border border-dashed border-line-2 bg-surface p-12 text-center">
 <p className="mb-1 text-muted"><T zh="持仓管理即将上线" en="Position tracking coming soon" /></p>
 <p className="text-sm text-faint">
              <T zh="先在上方「观察列表」里追踪你关注的票" en="Use the Watchlist tab above to track the names you care about" />
            </p>
          </div>
        ) : (
 <div className="overflow-hidden rounded-xl border border-line bg-surface">
 <div className="overflow-x-auto">
 <table className="w-full min-w-[640px] text-sm">
 <thead className="bg-surface text-xs uppercase tracking-wider text-muted">
                <tr>
 <th className="px-4 py-3 text-left font-medium"><T zh="股票" en="Stock" /></th>
 <th className="px-4 py-3 text-left font-medium"><T zh="市场" en="Market" /></th>
 <th className="px-4 py-3 text-right font-medium"><T zh="买入价" en="Cost" /></th>
 <th className="px-4 py-3 text-right font-medium"><T zh="股数" en="Shares" /></th>
 <th className="px-4 py-3 text-right font-medium"><T zh="仓位" en="Weight" /></th>
 <th className="px-4 py-3 text-right font-medium"><T zh="持有" en="Held" /></th>
 <th className="px-4 py-3 text-left font-medium"><T zh="买入逻辑" en="Thesis" /></th>
                </tr>
              </thead>
 <tbody className="divide-y divide-line">
                {positions.map((p) => (
 <tr key={p.code} className="hover:bg-surface-2">
 <td className="px-4 py-4">
 <Link href={`/stock/${p.code}?market=${p.market}`} className="block hover:text-accent">
 <div className="font-medium text-ink hover:text-accent">{p.name}</div>
 <div className="font-mono text-xs text-muted">{p.code}</div>
                      </Link>
                    </td>
 <td className="px-4 py-4">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
 p.market === "a"
 ? "bg-red-50 text-down"
 : "bg-surface-2 text-accent"
                        }`}
                      >
 {p.market === "a" ? <T zh="A 股" en="A-share" /> : <T zh="港股" en="HK" />}
                      </span>
                    </td>
 <td className="px-4 py-4 text-right font-mono text-muted">
                      {p.buy_price.toFixed(2)}
                    </td>
 <td className="px-4 py-4 text-right font-mono text-muted">
                      {p.shares.toLocaleString()}
                    </td>
 <td className="px-4 py-4 text-right font-mono text-muted">
                      {p.position_pct.toFixed(1)}%
                    </td>
 <td className="px-4 py-4 text-right text-muted">
                      <T zh={`${dayDiff(p.buy_date)} 天`} en={`${dayDiff(p.buy_date)}d`} />
                    </td>
 <td className="px-4 py-4 max-w-md text-muted">{p.thesis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </section>

      {positionData.length > 0 && (
 <section className="mb-10">
 <h2 className="mb-4 text-lg font-medium text-muted">
            <T zh="每只持仓的 AI 观点" en="AI Views on Each Holding" />
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
 <h2 className="text-lg font-medium text-muted">
            <T zh="盘后简报" en="Post-market Briefing" />
            {briefing && (
 <span className="ml-2 text-sm text-faint">· {briefing.date}</span>
            )}
          </h2>
        </div>
        {briefing ? (
          <article
 className="prose-leslie overflow-x-auto rounded-xl border border-line bg-surface p-4 sm:p-8"
            dangerouslySetInnerHTML={{ __html: briefing.html }}
          />
        ) : (
 <div className="rounded-xl border border-dashed border-line-2 bg-surface p-12 text-center">
 <p className="text-muted"><T zh="盘后简报即将上线" en="Post-market briefing coming soon" /></p>
          </div>
        )}
      </section>
    </>
  );

  return (
 <main className="mx-auto max-w-6xl px-6 pb-10 pt-3">
 <header className="mb-8 flex items-baseline justify-between border-b border-line pb-6">
        <div>
 <h1 className="text-3xl font-semibold tracking-tight text-ink"><T zh="我的组合" en="My Portfolio" /></h1>
 <p className="mt-1 text-sm text-muted">
            <T zh="观察列表 + 持仓,都在这里。观察仅存于你这个浏览器（localStorage）" en="Watchlist + holdings in one place. The watchlist lives only in this browser (localStorage)" />
          </p>
        </div>
 <div className="text-right">
 <p className="text-xs uppercase tracking-wider text-faint"><T zh="今日" en="Today" /></p>
 <p className="text-lg font-medium text-muted">{today}</p>
        </div>
      </header>

      <PortfolioTabs holdings={holdings} />

 <footer className="mt-16 border-t border-line pt-6 text-center text-xs text-faint">
        <T zh="我不是股神 · 五方独立判读 · v0.6" en="Not a Stock God · Five independent reads · v0.6" />
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
 <div className="rounded-xl border border-line bg-surface p-6">
 <div className="mb-4 flex items-baseline justify-between border-b border-line pb-3">
        <div>
          <Link
            href={`/stock/${position.code}?market=${position.market}`}
 className="font-semibold text-ink hover:text-accent"
          >
            {position.name}
 <span className="ml-2 font-mono text-xs text-muted">
              {position.code}
            </span>
          </Link>
 <p className="mt-0.5 text-xs text-muted">
            <T
              zh={`仓位 ${position.position_pct}% · 持有 ${dayDiff(position.buy_date)} 天 · 买入价 ¥${position.buy_price}`}
              en={`Weight ${position.position_pct}% · held ${dayDiff(position.buy_date)}d · cost ¥${position.buy_price}`}
            />
          </p>
        </div>
        {analysis && (
 <div className="text-right">
 <p className="text-xs uppercase tracking-wider text-faint"><T zh="BG 得分" en="BG Score" /></p>
            <p
              className={`font-mono text-xl font-semibold ${
                analysis.overall_score >= 80
 ? "text-up"
                  : analysis.overall_score >= 65
 ? "text-accent"
 : "text-muted"
              }`}
            >
              {analysis.overall_score.toFixed(1)}
            </p>
          </div>
        )}
      </div>

      {!hasAnything && (
 <div className="rounded-lg bg-surface p-4 text-sm text-muted">
          <T zh="还没有 AI 分析数据。" en="No AI analysis yet." />
          <Link
            href={`/stock/${position.code}?market=${position.market}`}
 className="ml-1 text-accent hover:text-accent"
          >
            <T zh="去生成 →" en="Generate →" />
          </Link>
        </div>
      )}

      {analysis?.verdict && (
 <div className="mb-3 rounded-lg border border-accent/30 bg-accent-soft p-4">
 <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent">
            <T zh="段永平 / 巴菲特视角 · GLM-5.1" en="Duan Yongping / Buffett lens · GLM-5.1" />
          </p>
 <p className="text-sm text-ink leading-relaxed">{analysis.verdict}</p>
        </div>
      )}

      {news?.summary && (
 <div className="mb-3 rounded-lg border border-line bg-surface p-4">
 <div className="mb-1 flex items-center gap-2">
 <span className="text-xs font-semibold uppercase tracking-wider text-muted">
              <T zh={`最近 ${news.days || 7} 天 GLM 解读`} en={`GLM read · last ${news.days || 7} days`} />
            </span>
            {news.summary.overall_signal && (
 <span className="text-sm">{news.summary.overall_signal}</span>
            )}
            {news.summary.action_suggestion && (
 <span className="rounded bg-surface px-2 py-0.5 text-[10px] font-medium text-muted">
                <T zh="建议：" en="Action: " />{news.summary.action_suggestion}
              </span>
            )}
          </div>
 <p className="text-sm text-muted leading-relaxed">
            {news.summary.narrative}
          </p>
          {news.summary.sell_condition_triggered &&
 news.summary.sell_condition_triggered !== "无" && (
 <p className="mt-2 text-xs font-medium text-down">
                 <T zh="卖出条件触发：" en="Sell trigger: " />{news.summary.sell_condition_triggered}
              </p>
            )}
        </div>
      )}

      {position.sell_conditions.length > 0 && (
 <div className="border-t border-line pt-3">
 <p className="mb-1 text-xs font-medium text-muted"><T zh="你设的卖出条件：" en="Your sell rules:" /></p>
 <ul className="space-y-0.5 text-xs text-muted">
            {position.sell_conditions.map((c, i) => (
              <li key={i}>• {c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
