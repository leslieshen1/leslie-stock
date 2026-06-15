import type { Metadata } from "next";
import Link from "next/link";
import { T } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "关于 / 方法论 · About | 我不是股神",
  description: "我不是股神(Not a Stock God)是什么、五方判读是谁、分怎么算、数据哪来、多久更新。",
};

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-2.5 space-y-2.5 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

const MASTERS: { name: string; school: string; lens: string; lensEn: string }[] = [
  { name: "巴菲特", school: "Buffett", lens: "护城河 + 长期 —— 看生意质地、ROE、能力圈,贵了也不追。", lensEn: "Moat + long term — business quality, ROE, circle of competence; won’t chase overvaluation." },
  { name: "段永平", school: "Duan", lens: "商业模式 + 企业文化 + 不为清单(stop-doing),要“价格合理的好生意”。", lensEn: "Business model + culture + a stop-doing list; a good business at a fair price." },
  { name: "德鲁肯米勒", school: "Druckenmiller", lens: "趋势 + 动量 + 宏观,集中下注、错了快砍。", lensEn: "Trend + momentum + macro; concentrated bets, cut fast when wrong." },
  { name: "Serenity", school: "@aleabitoreddit", lens: "瓶颈狙击 —— 专找供应链上卡脖子、不可替代的节点(半导体 / 光子 / 机器人供应链)。", lensEn: "Bottleneck sniper — irreplaceable choke points in the supply chain (semis / photonics / robotics)." },
  { name: "情绪", school: "Sentiment", lens: "资金面 + 题材 + 市场情绪,谁在被买、热度在哪。", lensEn: "Flows + themes + market sentiment — what’s being bought and where the heat is." },
];

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        <T zh="关于 · 方法论" en="About · Methodology" />
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        <T
          zh="你不是股神,但股神陪你一起看股票。这是一个把公开数据和多种投资方法论可视化的研究工具 —— 帮你更快看懂一只票,而不是替你做决定。"
          en="You’re not a stock god — but five of them watch the market with you. This is a research tool that visualizes public data and several investment methodologies — to help you understand a stock faster, not to decide for you."
        />
      </p>

      <Section title={<T zh="五方判读是谁" en="Who the five are" />}>
        <p>
          <T
            zh="同一只票,五种互不相同的投资框架各自独立打分(0–100)。它们用不同的尺子,所以经常打架 —— 而分歧本身就是信息:五方都点头的票稳,五方吵翻的票值得你亲自研究。"
            en="For the same stock, five distinct investment frameworks each score it independently (0–100). They use different yardsticks, so they often disagree — and the disagreement is the signal: a stock all five like is steadier; one they fight over is worth your own digging."
          />
        </p>
        <div className="mt-3 space-y-2.5">
          {MASTERS.map((m) => (
            <div key={m.school} className="rounded-lg border border-line bg-surface px-3.5 py-2.5">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-ink">{m.name}</span>
                <span className="font-mono text-[11px] text-faint">{m.school}</span>
              </div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
                <T zh={m.lens} en={m.lensEn} />
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title={<T zh="重要:人设是 AI 模拟,不是真人" en="Important: the masters are AI simulations" />}>
        <div className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-[13px] leading-relaxed text-ink">
          <T
            zh="巴菲特 / 段永平 / 德鲁肯米勒 / Serenity 等名字,只用于标识“按其公开方法论运行的 AI 智能体”。所有评分、判读、对决里的虚拟盘业绩与持仓,都是 AI 生成的,并非本人真实观点、业绩或持仓,也未获其授权或背书,不代表其本人。仅供研究参考,非投资建议。"
            en="Names like Buffett / Duan / Druckenmiller / Serenity only label AI agents that run on each person’s publicly known methodology. All scores, readings, and the Arena’s paper-trading results and holdings are AI-generated — NOT the real person’s actual views, performance, or holdings, not authorized or endorsed by them, and not representing them. For research only; not investment advice."
          />
        </div>
      </Section>

      <Section title={<T zh="分怎么算" en="How the scores work" />}>
        <p>
          <T
            zh="每一方按自己的框架对公司的业务、财务、产业链位置与时机独立评估,给出 0–100 的分与一句判读理由。列表里的“均分”是五方平均;“分歧”是五方评分的极差,数值越大代表越有争议。这些是方法论的结构化表达,不是预测,更不是买卖信号。"
            en="Each lens independently assesses the company’s business, financials, supply-chain position, and timing under its own framework, giving a 0–100 score plus a one-line rationale. In lists, “avg” is the five-way average; “divergence” is the spread between them — larger means more contested. These are structured expressions of methodology, not predictions, and not buy/sell signals."
          />
        </p>
      </Section>

      <Section title={<T zh="数据哪来 · 多久更新" en="Data sources · update cadence" />}>
        <p>
          <T
            zh="实时价格、市盈率等盘面数据来自第三方公开来源(腾讯行情、Yahoo、Nasdaq、新浪),页面打开时实时拉取;每个交易日收盘后自动刷新一次行情快照。五方判读由 AI 深度生成,按批次更新,不是每分钟变动。数据可能延迟或有误,按“现状”提供。"
            en="Live prices, P/E, and other quote data come from public third-party sources (Tencent, Yahoo, Nasdaq, Sina), fetched on page load; a quote snapshot auto-refreshes once after each trading day’s close. The five-master readings are AI-generated in batches and don’t change minute-to-minute. Data may be delayed or inaccurate and is provided “as-is.”"
          />
        </p>
      </Section>

      <Section title={<T zh="怎么用" en="How to use it" />}>
        <ol className="ml-4 list-decimal space-y-1.5">
          <li><T zh="在热力图或列表里找一只票,颜色/分数一眼看出市场怎么看它。" en="Find a stock on the heatmap or list; color/score show how the market sees it at a glance." /></li>
          <li><T zh="点开个股,看五方各自的判读、分歧焦点、产业链定位和盘面数据。" en="Open a stock to see each lens’s reading, the divergence, supply-chain position, and quote data." /></li>
          <li><T zh="在列表里按“均分”或“分歧”排序、按某一方筛选,定位你想深挖的票。" en="In the list, sort by avg or divergence, or filter by one lens, to surface what you want to dig into." /></li>
        </ol>
      </Section>

      <div className="mt-9 flex flex-wrap gap-3 border-t border-line pt-6">
        <Link href="/" className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-2 text-sm font-semibold text-accent transition hover:brightness-110">
          <T zh="开始看 →" en="Start exploring →" />
        </Link>
        <Link href="/terms" className="rounded-lg border border-line bg-surface px-4 py-2 text-sm text-muted transition hover:text-ink">
          <T zh="服务条款" en="Terms" />
        </Link>
        <Link href="/privacy" className="rounded-lg border border-line bg-surface px-4 py-2 text-sm text-muted transition hover:text-ink">
          <T zh="隐私政策" en="Privacy" />
        </Link>
      </div>
    </main>
  );
}
