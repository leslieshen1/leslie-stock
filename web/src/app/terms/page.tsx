import type { Metadata } from "next";
import { T } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "服务条款 · Terms | 我不是股神",
  description: "我不是股神(Not a Stock God)服务条款 —— 非投资建议、人设为 AI 模拟、数据来源与风险声明。",
};

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        <T zh="服务条款" en="Terms of Service" />
      </h1>
      <p className="mt-1.5 text-xs text-faint">
        <T zh="最后更新:2026 年 6 月" en="Last updated: June 2026" />
      </p>

      <Section title={<T zh="1. 这是什么" en="1. What this is" />}>
        <p>
          <T
            zh="「我不是股神 / Not a Stock God」(下称“本站”)是一个信息整理与个人研究工具,把公开的行情、基本面与多种投资方法论用可视化方式呈现。本站所有内容仅供信息参考与学习,不构成投资建议,也不构成对任何证券、基金、加密资产、平台或交易所的要约、招揽或背书。"
            en="“Not a Stock God” (the “Site”) is an information and personal-research tool that visualizes public market data, fundamentals, and various investment methodologies. All content is for informational and educational purposes only. It is not investment advice, and is not an offer, solicitation, or endorsement of any security, fund, crypto asset, platform, or exchange."
          />
        </p>
      </Section>

      <Section title={<T zh="2. 五方人设是 AI 模拟,不是真人" en="2. The five “masters” are AI simulations, not the real people" />}>
        <p>
          <T
            zh="本站出现的巴菲特、段永平、德鲁肯米勒、Serenity(@aleabitoreddit)等名字,仅用于标识“依据其公开投资方法论运行的 AI 智能体”。所有评分、判读、虚拟盘业绩与持仓均由 AI 生成,并非本人的真实观点、发言、业绩或持仓,也未获得任何上述人士的授权或背书,不代表其本人。"
            en="Names such as Buffett, Duan Yongping, Druckenmiller, and Serenity (@aleabitoreddit) are used only to label AI agents that run on each person’s publicly known investment methodology. All scores, readings, paper-trading performance, and holdings are AI-generated. They are NOT the real person’s actual views, statements, track record, or holdings, are not authorized or endorsed by them, and do not represent them."
          />
        </p>
      </Section>

      <Section title={<T zh="3. 数据来源与“按现状”提供" en="3. Data sources & “as-is” provision" />}>
        <p>
          <T
            zh="行情与基本面数据来自第三方公开来源(如腾讯行情、Yahoo、Nasdaq、新浪等),可能延迟、不完整或有误。本站按“现状(as-is)”提供,不对任何数据的准确性、及时性或可用性作出担保。第三方来源可能随时变更或中断。"
            en="Market and fundamental data come from third-party public sources (e.g., Tencent, Yahoo, Nasdaq, Sina). Such data may be delayed, incomplete, or inaccurate. The Site is provided “as-is” with no warranty as to the accuracy, timeliness, or availability of any data. Third-party sources may change or be interrupted at any time."
          />
        </p>
      </Section>

      <Section title={<T zh="4. 风险自负" en="4. Your own risk" />}>
        <p>
          <T
            zh="股票、加密货币、代币化资产均涉及重大风险,可能损失全部本金。你基于本站信息所做的任何决策,后果由你自行承担。投资前请自行研究(DYOR),并咨询有资质的专业人士。"
            en="Stocks, crypto, and tokenized assets carry substantial risk, including the total loss of principal. You are solely responsible for any decisions you make based on the Site. Always do your own research (DYOR) and consult a qualified professional before investing."
          />
        </p>
      </Section>

      <Section title={<T zh="5. 邀请链接与返佣披露" en="5. Referral links & affiliate disclosure" />}>
        <p>
          <T
            zh="部分页面(如“如何买”)包含跳转到第三方平台的邀请链接,本站可能因此获得返佣。这不会增加你的成本,也不代表本站对该平台的背书。是否使用、是否合规,由你自行判断。"
            en="Some pages (e.g., “How to Buy”) contain referral links to third-party platforms, from which the Site may earn a commission. This does not increase your cost and does not constitute an endorsement of that platform. Whether to use it, and whether it is compliant, is your decision."
          />
        </p>
      </Section>

      <Section title={<T zh="6. 地域" en="6. Jurisdiction" />}>
        <p>
          <T
            zh="本站不面向中国大陆用户。你需自行确认在所在司法管辖区访问与使用本站、以及进行任何相关交易是否合法合规。"
            en="The Site is not intended for users in mainland China. You are responsible for confirming that accessing and using the Site — and conducting any related transactions — is lawful and compliant in your jurisdiction."
          />
        </p>
      </Section>

      <Section title={<T zh="7. 知识产权" en="7. Intellectual property" />}>
        <p>
          <T
            zh="本站的设计、文案与可视化为本站所有。行情数据版权归各自来源方所有。第三方商标、人名仅用于指代与说明,相关权利归各自所有者。"
            en="The Site’s design, copy, and visualizations belong to the Site. Market data is owned by its respective sources. Third-party trademarks and names are used for reference and description only; related rights belong to their respective owners."
          />
        </p>
      </Section>

      <Section title={<T zh="8. 变更与中断" en="8. Changes & interruptions" />}>
        <p>
          <T
            zh="本站可能随时修改、暂停或终止任意功能,恕不另行通知,对由此产生的任何损失不承担责任。继续使用即视为接受当时的条款。"
            en="The Site may modify, suspend, or discontinue any feature at any time without notice, and is not liable for any resulting loss. Continued use constitutes acceptance of the then-current terms."
          />
        </p>
      </Section>

      <p className="mt-9 border-t border-line pt-5 text-xs leading-relaxed text-faint">
        <T
          zh="本页为通俗说明,非法律意见。若有疑问请咨询专业人士。"
          en="This page is a plain-language summary, not legal advice. Consult a professional if in doubt."
        />
      </p>
    </main>
  );
}
