// Phase 1 快照生成器 —— 在 GitHub Actions 上跑(已验证 GitHub IP 能直拉腾讯/Nasdaq)。
// 直接拉 Nasdaq screener + 腾讯 US/A,产出 us-snapshot.json / a-snapshot.json。
// 解析逻辑严格对齐线上路由(market/route.ts、a-market/route.ts)的字段下标,避免漂移。
// 不依赖任何 secret;输出写到 OUT_DIR(由 workflow force-push 到 data-live 分支)。
import { promises as fs } from "fs";
import path from "path";

const OUT_DIR = process.env.OUT_DIR || "/tmp/snap";
const gbk = new TextDecoder("gbk"); // GitHub runner Node 带完整 ICU,gbk 可用(探针已验)

function num(s) {
  const v = parseFloat(String(s ?? "").replace(/[$,%\s]/g, ""));
  return Number.isFinite(v) ? v : null;
}

async function fetchText(url, headers, ms = 12000, decode = "utf8") {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    const buf = await r.arrayBuffer();
    return decode === "gbk" ? gbk.decode(buf) : new TextDecoder("utf-8").decode(buf);
  } finally {
    clearTimeout(t);
  }
}

// ---------- 美股:Nasdaq screener(宇宙+市值+量) ----------
const URL_NASDAQ = "https://api.nasdaq.com/api/screener/stocks?tableonly=false&limit=10000&download=true";
const NAS_HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  accept: "application/json, text/plain, */*",
  origin: "https://www.nasdaq.com",
  referer: "https://www.nasdaq.com/",
};

async function buildUs() {
  const txt = await fetchText(URL_NASDAQ, NAS_HEADERS, 15000);
  const d = JSON.parse(txt)?.data;
  const rows = d?.rows || d?.table?.rows || [];
  const quotes = {};
  for (const row of rows) {
    const sym = String(row.symbol || "").trim().toUpperCase();
    if (!sym || sym.includes("^") || sym.includes("/")) continue;
    const mc = num(row.marketCap);
    quotes[sym] = {
      price: num(row.lastsale),
      pct: num(row.pctchange),
      mcapB: mc != null ? Math.round(mc / 1e7) / 100 : null,
      vol: num(row.volume),
    };
  }
  if (!Object.keys(quotes).length) throw new Error("nasdaq empty");

  // 腾讯 US 批量覆盖 price/pct + 盘后 postPct(对昨收);字段同 market/route.ts:[3]现价 [4]昨收 [9]盘后 [32]涨跌%
  const syms = Object.keys(quotes).filter((s) => /^[A-Z]{1,5}$/.test(s));
  const BATCH = 240, WAVE = 10;
  const batches = [];
  for (let i = 0; i < syms.length; i += BATCH) batches.push(syms.slice(i, i + BATCH));
  const apply = (text) => {
    for (const line of text.split(";")) {
      const m = line.match(/v_us([A-Za-z]+)="([^"]*)"/);
      if (!m || !m[2]) continue;
      const cur = quotes[m[1].toUpperCase()];
      if (!cur) continue;
      const f = m[2].split("~");
      const price = num(f[3]);
      if (price == null || !(price > 0)) continue;
      cur.price = price;
      const pct = num(f[32]); if (pct != null) cur.pct = pct;
      const post = num(f[9]), prevC = num(f[4]);
      if (post != null && post > 0 && prevC != null && prevC > 0) cur.postPct = Math.round((post / prevC - 1) * 1000) / 10;
    }
  };
  for (let i = 0; i < batches.length; i += WAVE) {
    const texts = await Promise.all(
      batches.slice(i, i + WAVE).map((b) =>
        fetchText(`https://qt.gtimg.cn/q=${b.map((s) => "us" + s).join(",")}`, {}, 10000, "gbk").catch(() => null),
      ),
    );
    for (const t of texts) if (t) apply(t);
  }
  return quotes;
}

// ---------- A 股:腾讯全盘(对齐 a-market/route.ts) ----------
function tencentSym(code) {
  if (/^6/.test(code)) return "sh" + code;
  if (/^[03]/.test(code)) return "sz" + code;
  if (/^(?:[48]|92)/.test(code)) return "bj" + code;
  return null;
}

async function buildA() {
  const p = path.join(process.cwd(), "web", "public", "data", "aleabit_manifest.json");
  const man = JSON.parse(await fs.readFile(p, "utf-8"));
  const codes = man.map((x) => x.code).filter(Boolean);
  const syms = codes.map(tencentSym).filter(Boolean);
  const BATCH = 80, WAVE = 12;
  const batches = [];
  for (let i = 0; i < syms.length; i += BATCH) batches.push(syms.slice(i, i + BATCH));
  const quotes = {};
  for (let i = 0; i < batches.length; i += WAVE) {
    const texts = await Promise.all(
      batches.slice(i, i + WAVE).map((b) =>
        fetchText(`https://qt.gtimg.cn/q=${b.join(",")}`, { referer: "https://gu.qq.com/", "user-agent": "Mozilla/5.0" }, 8000, "gbk").catch(() => null),
      ),
    );
    for (const t of texts) {
      if (!t) continue;
      for (const line of t.split(";")) {
        const m = line.match(/v_(?:sh|sz|bj)(\d{6})="(.*)"/);
        if (!m) continue;
        const f = m[2].split("~"); // [3]现价 [6]量 [32]涨跌% [45]总市值(亿)
        quotes[m[1]] = { price: num(f[3]), pct: num(f[32]), vol: num(f[6]), mcapYi: num(f[45]) };
      }
    }
  }
  return quotes;
}

// 判读后表现:读冻结基线(五方分+锚点收盘价 p0)+ 这次拉到的现价,分五档算"判读后涨幅 vs 大盘超额"。
// 单市场:baseline.stocks{code:{a:均分, p0:锚点价}} × quotes{code:{price}} → {anchor,n,market,buckets}。
async function perfFor(baselineFile, quotes) {
  const base = JSON.parse(await fs.readFile(path.join(process.cwd(), "web", "public", "data", baselineFile), "utf-8"));
  const rows = [];
  for (const [code, b] of Object.entries(base.stocks)) {
    const cur = quotes[code]?.price;
    if (cur == null || !(cur > 0) || !b.p0 || b.p0 <= 0) continue;
    const ret = (cur / b.p0 - 1) * 100;
    if (Math.abs(ret) > 500) continue; // 拆股等脏值剔除
    rows.push({ score: b.a, ret });
  }
  if (rows.length < 50) return null;
  const market = rows.reduce((s, r) => s + r.ret, 0) / rows.length;
  rows.sort((x, y) => y.score - x.score);
  const q = Math.floor(rows.length / 5);
  const segs = [["Top 20% 高分", rows.slice(0, q)], ["次 20%", rows.slice(q, 2 * q)], ["中间", rows.slice(2 * q, 3 * q)], ["次低", rows.slice(3 * q, 4 * q)], ["Bottom 20% 低分", rows.slice(4 * q)]];
  const r2 = (x) => Math.round(x * 100) / 100;
  const buckets = segs.map(([label, seg]) => {
    const r = seg.reduce((s, x) => s + x.ret, 0) / seg.length;
    return { label, avgScore: Math.round((seg.reduce((s, x) => s + x.score, 0) / seg.length) * 10) / 10, ret: r2(r), excess: r2(r - market), n: seg.length };
  });
  return { anchor: base.anchor, n: rows.length, market: r2(market), buckets };
}

// 美股(judgment-baseline.json,锚 06-17)+ A 股(judgment-baseline-a.json,锚 06-19)两套,各自基线各自大盘。
// 免费在 GitHub 算 → 写 data-live → 产品页前端直读(零 Vercel 成本、每 5 分钟更)。
async function buildPerf(us, a, ts) {
  const safe = (p) => p.catch((e) => { console.error("perf:", e.message); return null; });
  const [usPerf, aPerf] = await Promise.all([
    us ? safe(perfFor("judgment-baseline.json", us)) : Promise.resolve(null),
    a ? safe(perfFor("judgment-baseline-a.json", a)) : Promise.resolve(null),
  ]);
  if (!usPerf && !aPerf) return null;
  return { asOf: ts, us: usPerf, a: aPerf };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const ts = Date.now();
  const [us, a] = await Promise.all([
    buildUs().catch((e) => { console.error("US fail:", e.message); return null; }),
    buildA().catch((e) => { console.error("A fail:", e.message); return null; }),
  ]);
  if (us) {
    await fs.writeFile(path.join(OUT_DIR, "us-snapshot.json"), JSON.stringify({ quotes: us, ts, count: Object.keys(us).length }));
    console.log("US snapshot:", Object.keys(us).length, "syms; AAPL =", JSON.stringify(us.AAPL), "SPCX =", JSON.stringify(us.SPCX));
  }
  if (a) {
    await fs.writeFile(path.join(OUT_DIR, "a-snapshot.json"), JSON.stringify({ quotes: a, ts, count: Object.keys(a).length }));
    console.log("A snapshot:", Object.keys(a).length, "syms; 600519 =", JSON.stringify(a["600519"]));
  }
  // 判读后表现(美股 + A 股各自基线);需同时拿到两市现价,放在两市快照之后算。
  const perf = await buildPerf(us, a, ts);
  if (perf) {
    await fs.writeFile(path.join(OUT_DIR, "judgment-perf.json"), JSON.stringify(perf));
    for (const [mk, p] of Object.entries({ US: perf.us, A: perf.a })) {
      if (p) console.log(`perf ${mk}: ${p.n} 只 (锚 ${p.anchor});`, p.buckets.map((b) => `${b.label} 超额${b.excess}%`).join(" | "));
    }
  }
  if (!us && !a) process.exit(1);
}

main();
