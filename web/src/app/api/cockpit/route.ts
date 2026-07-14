// 宏观驾驶舱 · 数据端(私密:Bearer STATS_TOKEN)。十个"能指引宏观思维"的指标,按传导地图四层:
//   ① 经济数据(核心通胀/初请) ② 利率·流动性 总闸门(真实收益率/Fed路径/净流动性)
//   ③ 传导·警报(美元/信用利差) ④ 实体周期温度计(半导体/存储/中国 —— 无免费序列,用行情代理并标注)
// 硬数据走 FRED 免key CSV(fredgraph.csv,单序列/次);代理走 Yahoo。全免key、IP 无关。
// 独立于首页 MacroBar 的 /api/macro(那是公开高频 ticker,勿混)。
import { statsAuthed as authed, cacheGet, cacheSet } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" };
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

type Pt = { d: string; v: number };

async function fred(id: string, cosd: string): Promise<Pt[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${cosd}`;
  const txt = await fetch(url, { headers: UA, cache: "no-store" }).then((r) => r.text());
  const out: Pt[] = [];
  for (const line of txt.trim().split("\n").slice(1)) {
    const c = line.split(",");
    const d = c[0], v = c[1];
    if (!d || v == null || v === "." || v.trim() === "") continue;
    const n = parseFloat(v);
    if (Number.isFinite(n)) out.push({ d, v: n });
  }
  return out; // FRED 按日期升序
}

async function yah(sym: string, range = "6mo"): Promise<Pt[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d`;
  const j = (await fetch(url, { headers: UA, cache: "no-store" }).then((r) => r.json())) as {
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
  };
  const res = j?.chart?.result?.[0];
  const ts = res?.timestamp || [], cl = res?.indicators?.quote?.[0]?.close || [];
  const out: Pt[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = cl[i];
    if (c == null) continue;
    out.push({ d: new Date(ts[i] * 1000).toISOString().slice(0, 10), v: c });
  }
  return out;
}

const ds = (a: number[], n = 48) => (a.length <= n ? a : a.filter((_, i) => i % Math.ceil(a.length / n) === 0));
const back = (s: Pt[], k: number) => (s.length ? s[Math.max(0, s.length - 1 - k)].v : 0);
const last = (s: Pt[]) => (s.length ? s[s.length - 1].v : NaN);
const nearest = (s: Pt[], d: string) => { let r: number | null = null; for (const p of s) { if (p.d <= d) r = p.v; else break; } return r; };
const r2 = (n: number) => Math.round(n * 100) / 100;

type Ind = {
  num: number; tier: 1 | 2 | 3 | 4; label: string; sub: string;
  value: string; chg: string; dir: "up" | "dn" | "flat";
  status: "g" | "a" | "r"; spark: number[]; lead: boolean; proxy: boolean; note: string; lag: string;
};
const dir = (n: number): "up" | "dn" | "flat" => (n > 1e-9 ? "up" : n < -1e-9 ? "dn" : "flat");
const pct = (a: number, b: number) => (b ? (a / b - 1) * 100 : 0);
const sgn = (n: number, d = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}`;

async function build() {
  const [dfii10, dgs2, hyoas, icsa, pce, t5yie, walcl, rrp, tga, dxy, cnh, sox, mu, csi] = await Promise.all([
    fred("DFII10", daysAgo(260)), fred("DGS2", daysAgo(260)), fred("BAMLH0A0HYM2", daysAgo(260)),
    fred("ICSA", daysAgo(300)), fred("PCEPILFE", daysAgo(800)), fred("T5YIE", daysAgo(260)),
    fred("WALCL", daysAgo(320)), fred("RRPONTSYD", daysAgo(320)), fred("WTREGEN", daysAgo(320)),
    yah("DX-Y.NYB"), yah("CNH=X"), yah("%5ESOX"), yah("MU"), yah("000300.SS"),
  ]);

  const out: Ind[] = [];

  // ① 经济数据
  const yoy: number[] = [];
  for (let i = 12; i < pce.length; i++) yoy.push((pce[i].v / pce[i - 12].v - 1) * 100);
  const coreY = yoy.length ? yoy[yoy.length - 1] : NaN;
  const corePrev = yoy.length > 1 ? yoy[yoy.length - 2] : coreY;
  out.push({
    num: 4, tier: 1, label: "核心通胀 + 预期", sub: `Core PCE 同比 · 5y预期 ${last(t5yie).toFixed(2)}%`,
    value: `${coreY.toFixed(2)}%`, chg: `${sgn(coreY - corePrev)}pp`, dir: dir(coreY - corePrev),
    status: coreY > 3 ? "r" : coreY < 2.5 ? "g" : "a", spark: ds(yoy).map(r2), lead: false, proxy: false,
    note: "看方向不看绝对值 · 3% 是坎", lag: "月度",
  });
  const claim = last(icsa), claimPrev = back(icsa, 4);
  out.push({
    num: 5, tier: 1, label: "初请失业金", sub: "weekly claims · 最高频衰退探针",
    value: `${Math.round(claim / 1000)}k`, chg: `${sgn((claim - claimPrev) / 1000, 0)}k`, dir: dir(claim - claimPrev),
    status: claim < 250000 ? "g" : claim > 290000 ? "r" : "a", spark: ds(icsa.map((p) => p.v / 1000)).map((n) => Math.round(n)),
    lead: true, proxy: false, note: "破 300k 注意 · 上行=劳动力裂缝", lag: "周度",
  });

  // ② 利率·流动性 总闸门
  const ry = last(dfii10), ryT = ry - back(dfii10, 20);
  out.push({
    num: 1, tier: 2, label: "10Y 真实收益率", sub: "TIPS · 一切资产的估值重力",
    value: `${ry.toFixed(2)}%`, chg: `${sgn(ryT)}pp 20d`, dir: dir(ryT),
    status: ry > 2.3 ? "r" : ry < 1.6 ? "g" : "a", spark: ds(dfii10.map((p) => p.v)).map(r2), lead: true, proxy: false,
    note: "越高=估值压力越大", lag: "日度",
  });
  const y2 = last(dgs2), y2T = y2 - back(dgs2, 20);
  out.push({
    num: 2, tier: 2, label: "美联储政策路径", sub: "2Y 美债 · 市场预期的 Fed",
    value: `${y2.toFixed(2)}%`, chg: `${sgn(y2T)}pp 20d`, dir: dir(y2T),
    status: y2T < -0.15 ? "g" : y2T > 0.15 ? "r" : "a", spark: ds(dgs2.map((p) => p.v)).map(r2), lead: true, proxy: false,
    note: "2Y 下行=市场在 price 降息", lag: "日度",
  });
  const netS: Pt[] = [];
  for (const w of walcl) {
    const r = nearest(rrp, w.d), t = nearest(tga, w.d);
    if (r != null && t != null) netS.push({ d: w.d, v: w.v / 1000 - r - t }); // 十亿美元
  }
  const nl = last(netS), nlT = nl - back(netS, 8);
  out.push({
    num: 3, tier: 2, label: "全球净流动性", sub: "Fed 表 − RRP − TGA · 风险资产的潮水",
    value: `$${(nl / 1000).toFixed(2)}T`, chg: `${sgn(nlT / 1000)}T 8w`, dir: dir(nlT),
    status: nlT > 30 ? "g" : nlT < -30 ? "r" : "a", spark: ds(netS.map((p) => p.v / 1000)).map(r2), lead: true, proxy: false,
    note: "涨潮托风险资产,退潮别加杠杆", lag: "周度",
  });

  // ③ 传导·警报
  const dx = last(dxy), dxT = pct(dx, back(dxy, 20));
  out.push({
    num: 7, tier: 3, label: "美元 DXY", sub: `离岸人民币 USDCNH ${last(cnh).toFixed(2)}`,
    value: dx.toFixed(2), chg: `${sgn(dxT)}% 20d`, dir: dir(dxT),
    status: dxT > 2 ? "r" : dxT < -2 ? "g" : "a", spark: ds(dxy.map((p) => p.v)).map(r2), lead: false, proxy: false,
    note: "强美元=对新兴/中国/大宗全面收紧", lag: "实时",
  });
  const hy = last(hyoas), hyT = hy - back(hyoas, 20);
  out.push({
    num: 6, tier: 3, label: "信用利差 HY OAS", sub: "高收益债利差 · 系统警报器",
    value: `${hy.toFixed(2)}%`, chg: `${sgn(hyT)}pp 20d`, dir: dir(hyT),
    status: hy < 3.5 ? "g" : hy > 5 ? "r" : "a", spark: ds(hyoas.map((p) => p.v)).map(r2), lead: true, proxy: false,
    note: "领先股市 · 5% 是应激线", lag: "日度",
  });

  // ④ 实体周期温度计(代理)
  const sx = last(sox), sxT = pct(sx, back(sox, 20));
  out.push({
    num: 8, tier: 4, label: "科技 / AI 周期", sub: "费城半导体 ^SOX(capex 代理)",
    value: Math.round(sx).toLocaleString("en-US"), chg: `${sgn(sxT)}% 20d`, dir: dir(sxT),
    status: sxT > 3 ? "g" : sxT < -6 ? "r" : "a", spark: ds(sox.map((p) => p.v)).map((n) => Math.round(n)), lead: false, proxy: true,
    note: "真 capex 读四大云厂财报季", lag: "实时·代理",
  });
  const muv = last(mu), muT = pct(muv, back(mu, 20));
  out.push({
    num: 10, tier: 4, label: "电子 / 存储周期", sub: "美光 MU(存储价代理)",
    value: `$${muv.toFixed(0)}`, chg: `${sgn(muT)}% 20d`, dir: dir(muT),
    status: muT > 5 ? "g" : muT < -8 ? "r" : "a", spark: ds(mu.map((p) => p.v)).map(r2), lead: true, proxy: true,
    note: "真 DRAM/NAND/HBM 合约价走 TrendForce", lag: "实时·代理",
  });
  const cs = last(csi), csT = pct(cs, back(csi, 20));
  out.push({
    num: 9, tier: 4, label: "中国周期", sub: "沪深 300(风险偏好代理)",
    value: Math.round(cs).toLocaleString("en-US"), chg: `${sgn(csT)}% 20d`, dir: dir(csT),
    status: csT > 3 ? "g" : csT < -4 ? "r" : "a", spark: ds(csi.map((p) => p.v)).map(r2), lead: false, proxy: true,
    note: "真信用脉冲/地产走 iFinD(社融·M1·二手房)", lag: "实时·代理",
  });

  const reds = out.filter((i) => i.status === "r");
  const ambers = out.filter((i) => i.status === "a");
  return {
    asOf: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    indicators: out,
    summary: { r: reds.length, a: ambers.length, g: out.length - reds.length - ambers.length, reds: reds.map((i) => i.label) },
  };
}

export async function GET(req: Request) {
  if (!authed(req)) return new Response("unauthorized", { status: 401 });
  const CK = "cockpit:v1";
  const hit = cacheGet<Awaited<ReturnType<typeof build>>>(CK);
  if (hit) return Response.json({ ...hit, cached: true });
  try {
    const data = await build();
    cacheSet(CK, data, 20 * 60_000); // 宏观慢变量,缓存 20 分钟
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e).slice(0, 160) }, { status: 502 });
  }
}
