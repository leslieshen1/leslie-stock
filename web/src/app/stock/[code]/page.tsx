import type { Metadata } from "next";
import Link from "next/link";
import { promises as fs } from "fs";
import path from "path";
import { loadAnalysis } from "@/lib/data";
import { getStockHolders } from "@/lib/whales";
import { loadDilutionFlags } from "@/lib/dilution";
import { loadUsPanel } from "@/lib/us-panel";
import { loadStockTypes } from "@/lib/stock-type";
import { loadFundamentals } from "@/lib/fundamentals";
import { loadUsClass } from "@/lib/us-class";
import { fetchAFundamentals } from "@/lib/a-fundamentals";
import { loadNews } from "@/lib/news";
import { loadEarnings } from "@/lib/earnings";
import { loadOptions } from "@/lib/options";
import StockDetailClient from "./StockDetailClient";
import DilutionWarning from "./DilutionWarning";
import MasterPanel from "./MasterPanel";
import StockTypeCard from "./StockTypeCard";
import FundamentalsStrip from "./FundamentalsStrip";
import AStatsStrip from "./AStatsStrip";
import NewsStrip from "./NewsStrip";
import EarningsChip from "./EarningsChip";
import OptionsGammaLine from "./OptionsGammaLine";
import LivePrice from "./LivePrice";

// ETF 详情:etf-analyses.json(板块/业绩/费率/判决/介绍)。ETF 没有五方/产业链/持仓,
// 但有自己的一套:1年/3年/5年回报、最大回撤、波动、AUM、费率 + 段巴判决 + 一句话介绍。
type EtfRec = {
  sym: string; name: string; price: number | null; pct: number | null;
  ret1y: number | null; ret3y: number | null; ret5y: number | null; mdd: number | null;
  vol: number | null; years: number | null; aum: number | null; expense: number | null; yield: number | null;
  sector: string; kind: string; verdict: string; cls: "up" | "neutral" | "down"; why: string; blurb: string;
};
async function loadEtf(code: string): Promise<EtfRec | null> {
  try {
    const p = path.join(process.cwd(), "public", "data", "etf-analyses.json");
    const list = JSON.parse(await fs.readFile(p, "utf-8")).etfs as EtfRec[];
    return list.find((e) => e.sym === code.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}

function EtfDetail({ etf }: { etf: EtfRec }) {
  const tone: Record<string, string> = {
    up: "border-up/30 bg-up-soft text-up", neutral: "border-accent/25 bg-accent/10 text-accent", down: "border-down/30 bg-down-soft text-down",
  };
  const aumStr = etf.aum == null ? "—" : etf.aum >= 1e6 ? `$${(etf.aum / 1e6).toFixed(etf.aum >= 1e7 ? 0 : 1)}B` : `$${(etf.aum / 1e3).toFixed(0)}M`;
  const pctCell = (v: number | null) =>
    v == null ? <span className="text-faint">—</span> : <span className={v >= 0 ? "text-up" : "text-down"}>{v >= 0 ? "+" : ""}{Math.round(v)}%</span>;
  const Metric = ({ label, children, sub }: { label: string; children: React.ReactNode; sub?: string }) => (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-faint">{label}</p>
      <p className="mt-0.5 font-mono text-xl font-semibold text-ink tabular-nums">{children}</p>
      {sub && <p className="mt-0.5 text-[10px] text-faint">{sub}</p>}
    </div>
  );
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-5">
        <div className="mb-3 flex items-center gap-2 text-xs">
          <Link href="/" className="text-muted hover:text-ink">热力图</Link>
          <span className="text-faint">/</span>
          <Link href="/etf" className="text-muted hover:text-ink">ETF</Link>
          <span className="text-faint">/</span>
          <span className="text-muted">{etf.name || etf.sym}</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">{etf.name || etf.sym}</h1>
          <code className="font-mono text-base text-muted">{etf.sym}</code>
          <span className="inline-flex rounded-md border border-accent/30 bg-surface-2 px-2 py-0.5 text-xs font-medium text-accent">ETF</span>
          {etf.sector && <span className="inline-flex rounded-md border border-line bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">{etf.sector}</span>}
          <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${tone[etf.cls]}`}>{etf.verdict}</span>
        </div>
        <div className="mt-2">
          <LivePrice code={etf.sym} market="us" initialPrice={etf.price ?? null} />
        </div>
        {etf.blurb && <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{etf.blurb}</p>}
      </header>

      {/* 业绩:1年 / 3年 / 5年 / 最大回撤 / 波动 */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="近 1 年">{pctCell(etf.ret1y)}</Metric>
        <Metric label="近 3 年">{pctCell(etf.ret3y)}</Metric>
        <Metric label="近 5 年" sub={etf.years != null ? `约 ${etf.years} 年历史` : undefined}>{pctCell(etf.ret5y)}</Metric>
        <Metric label="最大回撤">
          <span className={etf.mdd == null ? "text-faint" : etf.mdd >= -20 ? "text-up" : etf.mdd >= -40 ? "text-accent" : "text-down"}>
            {etf.mdd == null ? "—" : `${Math.round(etf.mdd)}%`}
          </span>
        </Metric>
        <Metric label="年化波动">{etf.vol == null ? <span className="text-faint">—</span> : `${Math.round(etf.vol)}%`}</Metric>
      </div>

      {/* 规模 / 费率 / 股息 */}
      <div className="mb-4 grid grid-cols-3 gap-3 sm:max-w-lg">
        <Metric label="规模 AUM">{aumStr}</Metric>
        <Metric label="费率">{etf.expense == null ? "—" : `${etf.expense}%`}</Metric>
        <Metric label="股息率">{etf.yield == null ? "—" : `${etf.yield}%`}</Metric>
      </div>

      {/* 段永平 / 巴菲特 判决 */}
      {etf.why && (
        <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-accent">段永平 / 巴菲特镜头</p>
          <p className="text-sm leading-relaxed text-ink">{etf.why}</p>
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-faint">
        数据 = Nasdaq(AUM/费率)+ 5 年日线算回报与最大回撤。回报为区间累计、非年化;最大回撤=区间内峰值到谷底最大跌幅。判决是费率+类型的机械映射 · 非投资建议。
      </p>
      <div className="mt-3"><Link href="/etf" className="text-xs font-medium text-accent hover:underline">← 回 ETF 板块业绩</Link></div>
    </main>
  );
}

// B3:每只票自己的 title/description/OG/canonical(原来 14710 页共用 layout 通用 meta → 长尾 SEO 作废)
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ market?: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const sp = await searchParams;
  const m = (["a", "hk", "us"].includes((sp.market || "a").toLowerCase()) ? (sp.market || "a").toLowerCase() : "a") as "a" | "hk" | "us";

  if (m === "us") {
    const etf = await loadEtf(code);
    if (etf) {
      const name = etf.name || etf.sym;
      const title = `${name}(${etf.sym})· ETF 板块业绩 | 我不是股神`;
      const description = (etf.blurb || `${etf.sector ? etf.sector + " · " : ""}近 1 年 / 5 年回报、最大回撤、费率与规模。`).slice(0, 160);
      return { title, description, openGraph: { title, description }, alternates: { canonical: `/stock/${etf.sym}?market=us` } };
    }
  }

  const panel = loadUsPanel(code);
  const initial = panel ? null : loadAnalysis(code, m);
  const name = panel?.name || initial?.name || code;
  const sector = panel?.sector || panel?.chain?.industry || "";
  const mkt = m === "a" ? "A 股" : m === "hk" ? "港股" : "美股";
  const title = `${name}(${code})五方判读 · 我不是股神`;
  const lead = `${mkt}${sector ? " · " + sector : ""}`;
  const tail = panel?.divergence || "巴菲特 / 段永平 / 德鲁肯米勒 / Serenity / 情绪 五方独立评分(AI 模拟,非投资建议)";
  const description = `${lead} —— ${tail}`.slice(0, 160);
  const canonical = m === "a" ? `/stock/${code}` : `/stock/${code}?market=${m}`;
  return { title, description, openGraph: { title, description }, alternates: { canonical } };
}

export default async function StockDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ market?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
 const marketRaw = (sp.market || "a").toLowerCase();
 const market = (["a", "hk", "us"].includes(marketRaw) ? marketRaw : "a") as
 | "a"
 | "hk"
 | "us";
  // ETF → 专属精简页(在加载任何个股数据之前分流)
  if (market === "us") {
    const etf = await loadEtf(code);
    if (etf) return <EtfDetail etf={etf} />;
  }
  // 五方面板:有就显示(美股全量 + 已录入五方的 A 股,如 688017 绿的谐波)
  const usPanel = loadUsPanel(code);
  const stockTypes = loadStockTypes(code); // 类型轴:先定该用什么尺子量
  const fundamentals = loadFundamentals(code); // 真实基本面(Yahoo,美股)
  const aFund = market === "a" || market === "hk" ? await fetchAFundamentals(code, market) : null; // A 股/港股盘面(腾讯,实时;港股只有 PE+市值)
  const news = loadNews(code); // 个股新闻(Google News)
  const earnings = loadEarnings(code); // 下次财报(Finnhub,需 key)
  const options = loadOptions(code); // 期权 gamma(Polygon,需 key)
  // 有五方面板就走统一的精简版(A 股与美股同构,不再额外渲染 aleabit 瓶颈那套);无面板才看旧分析
  const initial = usPanel ? null : loadAnalysis(code, market);
  const holders = getStockHolders(code);
  const dilution = market === "us" ? loadDilutionFlags()[code.toUpperCase()] : undefined;
  const cls = market === "us" ? await loadUsClass(code) : null; // AI 板块分类(含第二子板块标签)

  // 市值显示:美股 $2.18T/$43B/$940M;A 股 X 亿(人民币)—— 只是计价市场不同
  const fmtCap = (b?: number | null) =>
    b == null ? null : b >= 1000 ? `$${(b / 1000).toFixed(2)}T` : b >= 1 ? `$${b.toFixed(1)}B` : `$${Math.round(b * 1000)}M`;
  // A 股/港股优先用实时总市值(腾讯,随价波动),退回静态面板值;避免和热力图/盘面对不上
  const mcapYiLive = (market === "a" || market === "hk") && aFund?.mcapYi != null ? aFund.mcapYi : usPanel?.mcapYi;
  const cnCur = market === "hk" ? "HK$" : "¥"; // 港股 HKD,A 股 RMB
  // 美股市值统一读 us-fundamentals(带 generated_at,日更,与「今日大事」同源),弃用无时间戳、可冻数周的 us-panels.mcapB
  // —— 之前 NVDA 这里显 $5.43T(us-panels)而别处 $5.14T,MSFT 差 15%,同一公司两页两个市值伤可信度
  const mcap = mcapYiLive != null
    ? `${cnCur}${mcapYiLive >= 10000 ? `${(mcapYiLive / 10000).toFixed(2)} 万亿` : `${Math.round(mcapYiLive)} 亿`}`
    : fmtCap(fundamentals?.mcapB ?? usPanel?.mcapB);

 const marketLabel = market === "a" ? "A 股" : market === "hk" ? "港股" : "美股";
  const marketTone =
 market === "a"
 ? "bg-down-soft text-down border-down/30"
 : market === "hk"
 ? "bg-surface-2 text-accent border-line"
 : "bg-surface-2 text-accent border-accent/30";

  return (
 <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      {/* 面包屑 + 股票名 */}
 <header className="mb-6">
 <div className="mb-3 flex items-center gap-2 text-xs">
 <Link href="/" className="text-muted hover:text-ink">热力图</Link>
 <span className="text-faint">/</span>
 <Link href="/scan" className="text-muted hover:text-ink">扫描</Link>
 <span className="text-faint">/</span>
 <Link href="/portfolio" className="text-muted hover:text-ink">观察</Link>
 <span className="text-faint">/</span>
 <span className="text-muted">{initial?.name || code}</span>
        </div>
 <div>
 <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-ink">
            {usPanel?.name || initial?.name || code}
          </h1>
 <div className="flex flex-wrap items-center gap-2 mt-1">
 <code className="font-mono text-base text-muted">{code}</code>
          <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${marketTone}`}>
            {marketLabel}
          </span>
          </div>
        </div>
        {/* 市值 · 行业 · 链定位 —— 之前页头只有代码+价格,连公司是干嘛的都不知道(2026-06-12 反馈) */}
        {(mcap || cls?.seg || usPanel?.sector || usPanel?.chain?.industry) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {mcap && <span>市值 <span className="font-mono font-semibold text-ink">{mcap}</span></span>}
            {/* 板块标签:大板块 + 子板块(独立 chip,恒显);第二子板块兼营如有再加一枚。无 AI 分类则退回面板 sector */}
            {cls?.seg ? (
              <>
                <span className="inline-flex rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">{cls.seg}</span>
                {cls.sub && <span className="inline-flex rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">{cls.sub}</span>}
              </>
            ) : (usPanel?.sector && <span>{usPanel.sector}</span>)}
            {/* 第二子板块(非主营、跨板块兼营的另一子板块)—— 只在详情页显示,不进热力图/产业图 */}
            {cls?.sub2 && (
              <span className="inline-flex items-center rounded-md border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent" title="第二子板块:非主营、但有显著业务的另一板块">
                兼 {cls.sub2}
              </span>
            )}
            {usPanel?.chain?.industry && <span className="text-accent">{usPanel.chain.industry}</span>}
          </div>
        )}
        <div className="mt-2">
          <LivePrice code={code} market={market} initialPrice={fundamentals?.px ?? null} />
        </div>
        {/* 公司介绍:中性一句话「这公司是干嘛的」。chain.role 已被 Serenity 的 thesis 污染(A股近100%),
            不再当介绍用——她的观点在下方五方面板的 serenity 格里;这里只读干净的 desc(Opus 4.8 生成)。 */}
        {usPanel?.desc && (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{usPanel.desc}</p>
        )}
        {/* 串联热力图:跳回首页并自动定位选中这只(revealAndSelect 跨产业/区域) */}
        {usPanel && (
          <Link href={`/?highlight=${encodeURIComponent(code)}`}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent transition hover:brightness-110">
            在热力图中定位 →
          </Link>
        )}
      </header>

      {dilution && <DilutionWarning flag={dilution} />}

      {earnings && (
        <div className="mb-4">
          <EarningsChip e={earnings} />
        </div>
      )}

      {stockTypes.length > 0 && (
        <div className="mb-4">
          <StockTypeCard types={stockTypes} />
        </div>
      )}

      {fundamentals && (
        <div className="mb-4">
          <FundamentalsStrip f={fundamentals} types={stockTypes} code={code} market={market} />
        </div>
      )}

      {aFund && (
        <div className="mb-4">
          <AStatsStrip f={aFund} />
        </div>
      )}

      {options && (
        <div className="mb-4">
          <OptionsGammaLine o={options} />
        </div>
      )}

      {usPanel && <MasterPanel data={usPanel} />}

      {news.length > 0 && (
        <div className="mt-4">
          <NewsStrip items={news} />
        </div>
      )}

      <StockDetailClient code={code} market={market} initial={initial} holders={holders} hasPanel={!!usPanel} />
    </main>
  );
}
