import Link from "next/link";

export const metadata = {
 title: "如何买美股 · 最低门槛路径 | 我不是股神",
 description: "crypto 用户不用开传统券商,用稳定币(USDC/USDT)在 Binance / Bitget 直接买代币化美股。$5 起,24 小时,秒到账。",
};

export default function HowToBuyPage() {
  return (
 <main className="mx-auto max-w-6xl px-6 py-10">
      {/* Hero */}
 <header className="mb-10">
 <p className="mb-2 text-xs font-medium uppercase tracking-wider text-accent">Guide · 2026.06 更新</p>
 <h1 className="text-3xl font-semibold tracking-tight text-ink">如何买美股</h1>
 <p className="mt-3 text-lg leading-relaxed text-muted">
          如果你已经有 crypto,<strong>最低门槛的路径不是开传统券商</strong> —— 而是用稳定币(USDC/USDT)
          在交易所直接买<strong>代币化美股</strong>。不用 W-8BEN、不用电汇美元、不用等几天审核。
        </p>
      </header>

      {/* 门槛对比 */}
 <section className="mb-10 rounded-2xl border border-line bg-surface p-6">
 <h2 className="mb-4 text-base font-semibold text-ink">为什么不推荐传统券商</h2>
 <div className="overflow-x-auto">
 <table className="w-full min-w-[560px] text-sm">
            <thead>
 <tr className="border-b border-line text-left text-xs text-muted">
 <th className="py-2 pr-4"></th>
 <th className="py-2 pr-4">传统券商<br /><span className="font-normal text-faint">盈透 / 嘉信 / 富途</span></th>
 <th className="py-2 text-accent">交易所代币化股票<br /><span className="font-normal text-accent">Binance / Bitget</span></th>
              </tr>
            </thead>
 <tbody className="text-muted">
              {[
 ["开户", "W-8BEN 税表 + 身份审核,几天", "已有交易所账号即可"],
 ["入金", "电汇美元,几天 + 手续费", "稳定币秒到"],
 ["最低", "电汇门槛高(常 $1000+)", "$5（Binance）/ $10（Bitget）"],
 ["交易时间", "美股盘中（你的半夜）", "24/5 或 24/7"],
 ["跨境门槛", "高（税务 + 语言 + 汇率）", "低（crypto 用户已具备）"],
              ].map(([k, a, b], i) => (
 <tr key={i} className="border-b border-line">
 <td className="py-2.5 pr-4 font-medium text-muted">{k}</td>
 <td className="py-2.5 pr-4 text-muted">{a}</td>
 <td className="py-2.5 font-medium text-ink">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 两条路径 */}
 <h2 className="mb-4 text-xl font-semibold text-ink">两条主流路径</h2>
 <div className="mb-10 grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* Binance */}
 <section className="rounded-2xl border border-accent/30 bg-surface p-6">
 <div className="mb-3 flex items-center gap-2">
  <h3 className="text-lg font-semibold text-ink">Binance</h3>
 <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">2026.06 新上线</span>
          </div>
 <p className="mb-4 text-sm leading-relaxed text-muted">
            7,000+ 美股 + ETF,USDT/USDC/BNB 直接买,<strong>碎股 $5 起</strong>,零佣金($0.35/单最低费),24/5 交易。
            代币化层 <strong>bStocks</strong>(BNB Chain)几周内上线,可自己发起代币化。
          </p>
 <ol className="space-y-2 text-sm text-muted">
            {[
 "登录 Binance App → 找「Stocks / 股票」入口",
 "用账户里的 USDT / USDC 直接下单",
 "搜美股代码(如 NVDA / TSLA),$5 起买碎股",
 "（可选）等 bStocks 上线后,把持仓代币化到链上",
            ].map((s, i) => (
 <li key={i} className="flex gap-2">
 <span className="shrink-0 font-mono text-xs text-accent">{i + 1}.</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
 <p className="mt-4 text-xs text-faint">
            结构:Binance(界面)+ Nest Trading(broker)+ Alpaca(托管/分红)。真股托管,非自托管。
          </p>
          <a
 href="https://www.bsmkweb.cc/register?ref=152171685"
 target="_blank" rel="noopener noreferrer"
 className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#F0B90B] px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90"
          >
 注册 Binance <span className="opacity-70">→</span>
          </a>
 <p className="mt-1.5 text-center text-[10px] text-faint">邀请链接 · 含返佣 · 仅非中国大陆地区</p>
        </section>

        {/* Bitget */}
 <section className="rounded-2xl border border-line bg-surface p-6">
 <div className="mb-3 flex items-center gap-2">
  <h3 className="text-lg font-semibold text-ink">Bitget</h3>
 <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-accent">已上线 · 自托管</span>
          </div>
 <p className="mb-4 text-sm leading-relaxed text-muted">
            走 <strong>xStocks</strong> 框架(Kraken/Backed 发行),TSLAx / NVDAx / AAPLx / <strong>CRCLx</strong> / SPYx 等,
            USDT/USDC/SOL 买,<strong>$10 起</strong>,24/7,<strong>保留私钥自托管</strong>。1:1 真股托管背书。
          </p>
 <ol className="space-y-2 text-sm text-muted">
            {[
 "打开 Bitget Wallet（钱包,保留私钥）",
 "充 USDT / USDC / SOL（从交易所或外部钱包转入）",
 "进 xStock 板块,选股票(苹果/特斯拉/谷歌…)",
 "$10 起买碎股,链上秒结算,7×24 可交易",
            ].map((s, i) => (
 <li key={i} className="flex gap-2">
 <span className="shrink-0 font-mono text-xs text-accent">{i + 1}.</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
 <p className="mt-4 text-xs text-faint">
            覆盖 Solana / Base / BNB Chain。自托管 = 你掌握私钥,但也自负保管责任。
          </p>
          <a
 href="https://partner.hdmune.cn/bg/5A85GS"
 target="_blank" rel="noopener noreferrer"
 className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#00E0CA] px-4 py-2.5 text-sm font-semibold text-black transition hover:opacity-90"
          >
 注册 Bitget <span className="opacity-70">→</span>
          </a>
 <p className="mt-1.5 text-center text-[10px] text-faint">邀请链接 · 含返佣 · 仅非中国大陆地区</p>
        </section>
      </div>

      {/* RWA 闭环 */}
 <section className="mb-10 rounded-2xl border border-accent/30 bg-surface p-6">
 <h2 className="mb-2 text-base font-semibold text-accent"> 这其实就是「链上美元买链上股票」</h2>
 <p className="text-sm leading-relaxed text-muted">
          你用 <strong>USDC</strong>(链上美元)买 <strong>CRCLx</strong>(Circle 的代币化股票)——
          稳定币 + RWA 代币化在这里合流。这是 tokenized stocks 赛道在落地:
          rwa.xyz 数据,代币化股票日交易量已到 <strong>$16.8 亿</strong>(月 +39%),持有人 29 万+(月 +31%)。
          赛道在快速长,但仍早期。
        </p>
      </section>

      {/* 风险 */}
 <section className="mb-10 rounded-2xl border border-down/30 bg-down-soft/50 p-6">
 <h2 className="mb-3 text-base font-semibold text-down"> 必读风险（别跳过）</h2>
 <ul className="space-y-2 text-sm text-down">
          {[
 "仅限非美用户 —— 这些服务一般不对美国居民开放,看你所在地的可用性",
 "不是直接股权 —— 代币化股票是「挂钩股价的金融工具」,不等于真持有股份,投票权/某些权利可能没有",
 "监管不确定 —— SEC 上周刚延迟了代币化资产的 innovation exemption,法律框架还在变",
 "对手方风险 —— Binance 走 Nest+Alpaca 分层结构,任一环节出问题可能影响你的持仓",
 "流动性有限 —— 代币化股票二级市场深度不如真交易所,极端行情可能滑点大",
 "自托管风险（Bitget）—— 私钥丢了没人能帮你找回",
          ].map((r, i) => (
 <li key={i} className="flex items-start gap-2">
 <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-down" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </section>

 <p className="text-center text-xs leading-relaxed text-faint">
        本页为信息整理,非投资建议,不构成对任何平台的背书。代币化股票涉及监管、对手方、流动性多重风险,
        交易前请自行研究并确认所在地合规性。数据截至 2026.06,以平台最新公告为准。
        <br />
 <Link href="/whales" className="text-accent hover:underline">看名人在买什么 →</Link>
      </p>
    </main>
  );
}
