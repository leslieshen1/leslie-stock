import Link from "next/link";
import { T } from "@/lib/i18n";

export const metadata = {
 title: "如何买美股 · 最低门槛路径 | 我不是股神",
 description: "crypto 用户不用开传统券商,用稳定币(USDC/USDT)在 Binance / Bitget 直接买代币化美股。$5 起,24 小时,秒到账。",
};

export default function HowToBuyPage() {
  return (
 <main className="mx-auto max-w-6xl px-6 py-10">
      {/* Hero */}
 <header className="mb-10">
 <p className="mb-2 text-xs font-medium uppercase tracking-wider text-accent"><T zh="Guide · 2026.06 更新" en="Guide · Updated 2026.06" /></p>
 <h1 className="text-3xl font-semibold tracking-tight text-ink"><T zh="如何买美股" en="How to Buy US Stocks" /></h1>
 <p className="mt-3 text-lg leading-relaxed text-muted">
          <T
            zh="如果你已经有 crypto,"
            en="If you already hold crypto, "
          />
          <strong><T zh="最低门槛的路径不是开传统券商" en="the lowest-friction path isn't a traditional brokerage" /></strong>
          <T
            zh=" —— 而是用稳定币(USDC/USDT)在交易所直接买"
            en=" — it's buying "
          />
          <strong><T zh="代币化美股" en="tokenized US stocks" /></strong>
          <T
            zh="。不用 W-8BEN、不用电汇美元、不用等几天审核。"
            en=" directly on an exchange with stablecoins (USDC/USDT). No W-8BEN, no USD wire, no multi-day review."
          />
        </p>
      </header>

      {/* 门槛对比 */}
 <section className="mb-10 rounded-2xl border border-line bg-surface p-6">
 <h2 className="mb-4 text-base font-semibold text-ink"><T zh="为什么不推荐传统券商" en="Why not a traditional brokerage" /></h2>
 <div className="overflow-x-auto">
 <table className="w-full min-w-[480px] text-sm">
            <thead>
 <tr className="border-b border-line text-left text-xs text-muted">
 <th className="py-2 pr-4"></th>
 <th className="py-2 pr-4"><T zh="传统券商" en="Traditional broker" /><br /><span className="font-normal text-faint"><T zh="盈透 / 嘉信 / 富途" en="IBKR / Schwab / Futu" /></span></th>
 <th className="py-2 text-accent"><T zh="交易所代币化股票" en="Exchange tokenized stocks" /><br /><span className="font-normal text-accent">Binance / Bitget</span></th>
              </tr>
            </thead>
 <tbody className="text-muted">
              {[
 { k: { zh: "开户", en: "Onboarding" }, a: { zh: "W-8BEN 税表 + 身份审核,几天", en: "W-8BEN form + ID review, several days" }, b: { zh: "已有交易所账号即可", en: "Just an existing exchange account" } },
 { k: { zh: "入金", en: "Funding" }, a: { zh: "电汇美元,几天 + 手续费", en: "USD wire, several days + fees" }, b: { zh: "稳定币秒到", en: "Stablecoins arrive in seconds" } },
 { k: { zh: "最低", en: "Minimum" }, a: { zh: "电汇门槛高(常 $1000+)", en: "High wire threshold (often $1000+)" }, b: { zh: "$5（Binance）/ $10（Bitget）", en: "$5 (Binance) / $10 (Bitget)" } },
 { k: { zh: "交易时间", en: "Trading hours" }, a: { zh: "美股盘中（你的半夜）", en: "US market hours (your midnight)" }, b: { zh: "24/5 或 24/7", en: "24/5 or 24/7" } },
 { k: { zh: "跨境门槛", en: "Cross-border friction" }, a: { zh: "高（税务 + 语言 + 汇率）", en: "High (tax + language + FX)" }, b: { zh: "低（crypto 用户已具备）", en: "Low (crypto users already set up)" } },
              ].map((row, i) => (
 <tr key={i} className="border-b border-line">
 <td className="py-2.5 pr-4 font-medium text-muted"><T zh={row.k.zh} en={row.k.en} /></td>
 <td className="py-2.5 pr-4 text-muted"><T zh={row.a.zh} en={row.a.en} /></td>
 <td className="py-2.5 font-medium text-ink"><T zh={row.b.zh} en={row.b.en} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 两条路径 */}
 <h2 className="mb-4 text-xl font-semibold text-ink"><T zh="两条主流路径" en="Two mainstream paths" /></h2>
 <div className="mb-10 grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* Binance */}
 <section className="rounded-2xl border border-accent/30 bg-surface p-6">
 <div className="mb-3 flex items-center gap-2">
  <h3 className="text-lg font-semibold text-ink">Binance</h3>
 <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent"><T zh="2026.06 新上线" en="New · 2026.06" /></span>
          </div>
 <p className="mb-4 text-sm leading-relaxed text-muted">
            <T zh="7,000+ 美股 + ETF,USDT/USDC/BNB 直接买," en="7,000+ US stocks + ETFs, buy directly with USDT/USDC/BNB, " />
            <strong><T zh="碎股 $5 起" en="fractional shares from $5" /></strong>
            <T zh=",零佣金($0.35/单最低费),24/5 交易。代币化层 " en=", zero commission ($0.35 min per order), 24/5 trading. The tokenization layer " />
            <strong>bStocks</strong>
            <T zh="(BNB Chain)几周内上线,可自己发起代币化。" en=" (BNB Chain) goes live within weeks, with self-serve tokenization." />
          </p>
 <ol className="space-y-2 text-sm text-muted">
            {[
 { zh: "登录 Binance App → 找「Stocks / 股票」入口", en: "Open the Binance App → find the Stocks entry" },
 { zh: "用账户里的 USDT / USDC 直接下单", en: "Order directly with the USDT / USDC in your account" },
 { zh: "搜美股代码(如 NVDA / TSLA),$5 起买碎股", en: "Search a US ticker (e.g. NVDA / TSLA), buy fractions from $5" },
 { zh: "（可选）等 bStocks 上线后,把持仓代币化到链上", en: "(Optional) once bStocks launches, tokenize holdings on-chain" },
            ].map((s, i) => (
 <li key={i} className="flex gap-2">
 <span className="shrink-0 font-mono text-xs text-accent">{i + 1}.</span>
                <span><T zh={s.zh} en={s.en} /></span>
              </li>
            ))}
          </ol>
 <p className="mt-4 text-xs text-faint">
            <T zh="结构:Binance(界面)+ Nest Trading(broker)+ Alpaca(托管/分红)。真股托管,非自托管。" en="Structure: Binance (interface) + Nest Trading (broker) + Alpaca (custody/dividends). Real-share custody, not self-custody." />
          </p>
          <a
 href="https://www.bsmkweb.cc/register?ref=152171685"
 target="_blank" rel="noopener noreferrer"
 className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#F0B90B] px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90"
          >
 <T zh="注册 Binance" en="Sign up for Binance" /> <span className="opacity-70">→</span>
          </a>
 <p className="mt-1.5 text-center text-[10px] text-faint"><T zh="邀请链接 · 含返佣 · 仅非中国大陆地区" en="Referral link · includes rebate · outside mainland China only" /></p>
        </section>

        {/* Bitget */}
 <section className="rounded-2xl border border-line bg-surface p-6">
 <div className="mb-3 flex items-center gap-2">
  <h3 className="text-lg font-semibold text-ink">Bitget</h3>
 <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-accent"><T zh="已上线 · 自托管" en="Live · self-custody" /></span>
          </div>
 <p className="mb-4 text-sm leading-relaxed text-muted">
            <T zh="走 " en="Uses the " />
            <strong>xStocks</strong>
            <T zh=" 框架(Kraken/Backed 发行),TSLAx / NVDAx / AAPLx / " en=" framework (issued by Kraken/Backed): TSLAx / NVDAx / AAPLx / " />
            <strong>CRCLx</strong>
            <T zh=" / SPYx 等,USDT/USDC/SOL 买," en=" / SPYx and more, buy with USDT/USDC/SOL, " />
            <strong><T zh="$10 起" en="from $10" /></strong>
            <T zh=",24/7," en=", 24/7, " />
            <strong><T zh="保留私钥自托管" en="self-custody with your own keys" /></strong>
            <T zh="。1:1 真股托管背书。" en=". Backed 1:1 by real-share custody." />
          </p>
 <ol className="space-y-2 text-sm text-muted">
            {[
 { zh: "打开 Bitget Wallet（钱包,保留私钥）", en: "Open Bitget Wallet (you keep the private key)" },
 { zh: "充 USDT / USDC / SOL（从交易所或外部钱包转入）", en: "Deposit USDT / USDC / SOL (from an exchange or external wallet)" },
 { zh: "进 xStock 板块,选股票(苹果/特斯拉/谷歌…)", en: "Open the xStock section, pick a stock (Apple/Tesla/Google…)" },
 { zh: "$10 起买碎股,链上秒结算,7×24 可交易", en: "Buy fractions from $10, on-chain settlement in seconds, 24/7" },
            ].map((s, i) => (
 <li key={i} className="flex gap-2">
 <span className="shrink-0 font-mono text-xs text-accent">{i + 1}.</span>
                <span><T zh={s.zh} en={s.en} /></span>
              </li>
            ))}
          </ol>
 <p className="mt-4 text-xs text-faint">
            <T zh="覆盖 Solana / Base / BNB Chain。自托管 = 你掌握私钥,但也自负保管责任。" en="Covers Solana / Base / BNB Chain. Self-custody = you hold the keys, and you bear the safekeeping risk." />
          </p>
          <a
 href="https://partner.hdmune.cn/bg/5A85GS"
 target="_blank" rel="noopener noreferrer"
 className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#00E0CA] px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90"
          >
 <T zh="注册 Bitget" en="Sign up for Bitget" /> <span className="opacity-70">→</span>
          </a>
 <p className="mt-1.5 text-center text-[10px] text-faint"><T zh="邀请链接 · 含返佣 · 仅非中国大陆地区" en="Referral link · includes rebate · outside mainland China only" /></p>
        </section>
      </div>

      {/* RWA 闭环 */}
 <section className="mb-10 rounded-2xl border border-accent/30 bg-surface p-6">
 <h2 className="mb-2 text-base font-semibold text-accent"><T zh="这其实就是「链上美元买链上股票」" en="This is on-chain dollars buying on-chain stocks" /></h2>
 <p className="text-sm leading-relaxed text-muted">
          <T zh="你用 " en="You use " />
          <strong>USDC</strong>
          <T zh="(链上美元)买 " en=" (on-chain dollars) to buy " />
          <strong>CRCLx</strong>
          <T zh="(Circle 的代币化股票)——稳定币 + RWA 代币化在这里合流。这是 tokenized stocks 赛道在落地:rwa.xyz 数据,代币化股票日交易量已到 " en=" (Circle's tokenized stock) — stablecoins and RWA tokenization converge here. The tokenized-stocks sector is landing: per rwa.xyz, daily tokenized-stock volume has reached " />
          <strong><T zh="$16.8 亿" en="$1.68B" /></strong>
          <T zh="(月 +39%),持有人 29 万+(月 +31%)。赛道在快速长,但仍早期。" en=" (+39% MoM), with 290K+ holders (+31% MoM). The space is growing fast, but still early." />
        </p>
      </section>

      {/* 风险 */}
 <section className="mb-10 rounded-2xl border border-down/30 bg-down-soft/50 p-6">
 <h2 className="mb-3 text-base font-semibold text-down"><T zh="必读风险" en="Must-read risks" /></h2>
 <ul className="space-y-2 text-sm text-down">
          {[
 { zh: "仅限非美用户 —— 这些服务一般不对美国居民开放,看你所在地的可用性", en: "Non-US users only — these services generally aren't open to US residents; check availability in your region" },
 { zh: "不是直接股权 —— 代币化股票是「挂钩股价的金融工具」,不等于真持有股份,投票权/某些权利可能没有", en: "Not direct equity — a tokenized stock is a price-tracking instrument, not actual share ownership; voting and certain rights may not apply" },
 { zh: "监管不确定 —— SEC 上周刚延迟了代币化资产的 innovation exemption,法律框架还在变", en: "Regulatory uncertainty — the SEC just delayed the innovation exemption for tokenized assets last week; the legal framework is still shifting" },
 { zh: "对手方风险 —— Binance 走 Nest+Alpaca 分层结构,任一环节出问题可能影响你的持仓", en: "Counterparty risk — Binance runs a layered Nest+Alpaca structure; a failure at any link can affect your holdings" },
 { zh: "流动性有限 —— 代币化股票二级市场深度不如真交易所,极端行情可能滑点大", en: "Limited liquidity — secondary-market depth lags real exchanges; slippage can be large in extreme conditions" },
 { zh: "自托管风险（Bitget）—— 私钥一旦丢失即无法找回", en: "Self-custody risk (Bitget) — lose the private key and it's gone for good" },
          ].map((r, i) => (
 <li key={i} className="flex items-start gap-2">
 <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-down" />
              <span><T zh={r.zh} en={r.en} /></span>
            </li>
          ))}
        </ul>
      </section>

 <p className="text-center text-xs leading-relaxed text-faint">
        <T
          zh="本页为信息整理,非投资建议,不构成对任何平台的背书。代币化股票涉及监管、对手方、流动性多重风险,交易前请自行研究并确认所在地合规性。数据截至 2026.06,以平台最新公告为准。"
          en="This page is informational only, not investment advice, and not an endorsement of any platform. Tokenized stocks carry regulatory, counterparty and liquidity risks — do your own research and confirm compliance in your region before trading. Data as of 2026.06; defer to each platform's latest announcements."
        />
        <br />
 <Link href="/whales" className="text-accent hover:underline"><T zh="看名人在买什么 →" en="See what the famous are buying →" /></Link>
      </p>
    </main>
  );
}
