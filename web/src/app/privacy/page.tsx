import type { Metadata } from "next";
import { T } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "隐私政策 · Privacy | 我不是股神",
  description: "我不是股神(Not a Stock God)隐私政策 —— 无账号、匿名分析、数据存在你本地浏览器。",
};

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        <T zh="隐私政策" en="Privacy Policy" />
      </h1>
      <p className="mt-1.5 text-xs text-faint">
        <T zh="最后更新:2026 年 6 月" en="Last updated: June 2026" />
      </p>

      <Section title={<T zh="1. 不需要账号" en="1. No account" />}>
        <p>
          <T
            zh="本站没有注册、没有登录,不收集你的姓名、邮箱、电话等任何个人身份信息。"
            en="The Site has no sign-up and no login. It does not collect your name, email, phone, or any other personally identifiable information."
          />
        </p>
      </Section>

      <Section title={<T zh="2. 匿名访问分析" en="2. Anonymous usage analytics" />}>
        <p>
          <T
            zh="我们使用 Vercel Analytics 统计匿名的页面访问与基本设备信息(如机型类别、来源),用于改进产品。它不写入用于追踪你的 cookie,也不构建跨站用户画像。"
            en="We use Vercel Analytics to measure anonymous page views and basic device info (e.g., device category, referrer) to improve the product. It does not set tracking cookies and does not build a cross-site profile of you."
          />
        </p>
      </Section>

      <Section title={<T zh="3. 数据存在你自己的浏览器" en="3. Data stays in your browser" />}>
        <p>
          <T
            zh="主题(深/浅色)、语言、观察列表等偏好都存在你浏览器的 localStorage 里,只留在你本地、不上传到我们的服务器。清除浏览器数据即可清空。"
            en="Preferences such as theme (dark/light), language, and your watchlist are stored in your browser’s localStorage. They stay on your device and are not uploaded to our servers. Clearing your browser data clears them."
          />
        </p>
      </Section>

      <Section title={<T zh="4. 第三方" en="4. Third parties" />}>
        <p>
          <T
            zh="本站托管在 Vercel;行情数据来自腾讯、Yahoo、Nasdaq、新浪等公开来源,这些请求由我们的服务器代为发起。点击页面上的邀请链接会跳转到第三方平台(如交易所),你与该平台的交互适用其自己的隐私政策,与本站无关。"
            en="The Site is hosted on Vercel; market data comes from public sources such as Tencent, Yahoo, Nasdaq, and Sina, fetched by our server on your behalf. Clicking a referral link takes you to a third-party platform (e.g., an exchange); your interaction there is governed by that platform’s own privacy policy, not ours."
          />
        </p>
      </Section>

      <Section title={<T zh="5. 不出售数据" en="5. No selling of data" />}>
        <p>
          <T
            zh="我们不出售、不出租你的任何数据 —— 因为我们本就几乎不收集可识别到个人的数据。"
            en="We do not sell or rent any of your data — and we collect almost no personally identifiable data to begin with."
          />
        </p>
      </Section>

      <Section title={<T zh="6. 联系" en="6. Contact" />}>
        <p>
          <T
            zh="对隐私有疑问,可通过站点页脚提供的渠道联系我们。"
            en="For privacy questions, reach us via the channel listed in the site footer."
          />
        </p>
      </Section>

      <p className="mt-9 border-t border-line pt-5 text-xs leading-relaxed text-faint">
        <T
          zh="本页为通俗说明,非法律意见。"
          en="This page is a plain-language summary, not legal advice."
        />
      </p>
    </main>
  );
}
