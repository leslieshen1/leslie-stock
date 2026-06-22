import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { clientIp, rateLimit, tooMany } from "@/lib/api-guard";

type ManifestItem = {
  code: string;
  name: string;
  market: "a" | "hk" | "us" | "kr";
  market_cap_yi: number | null;
  sector: string;
  layer: number | null;
  score: number;
  verdict: string;
  verdict_label: string;
  signals_hit: number;
  thesis: string;
};

// 缓存 manifest（mtime 失效）
let CACHE: { items: ManifestItem[]; mtime: number } | null = null;

// 美股全市场（us-stocks.json）— 也进搜索
type UsRaw = { sym: string; name: string; mcapB: number | null; sector: string; industry: string };
let US_CACHE: { items: ManifestItem[]; mtime: number } | null = null;

function loadUsStocks(): ManifestItem[] {
  const candidates = [
    path.join(process.cwd(), "public", "data", "us-stocks.json"),
    path.resolve(process.cwd(), "..", "web", "public", "data", "us-stocks.json"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const stat = fs.statSync(p);
    if (US_CACHE && US_CACHE.mtime === stat.mtimeMs) return US_CACHE.items;
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf-8")) as { stocks?: UsRaw[] };
      const items: ManifestItem[] = (j.stocks || []).map((u) => ({
        code: u.sym,
        name: u.name,
        market: "us",
        market_cap_yi: u.mcapB != null ? u.mcapB * 10 : null,
        sector: u.sector || "",
        layer: null,
        score: 0,
        verdict: "",
        verdict_label: "",
        signals_hit: 0,
        thesis: u.industry || "",
      }));
      US_CACHE = { items, mtime: stat.mtimeMs };
      return items;
    } catch {
      // try next path
    }
  }
  return [];
}

// 美股 ETF(us-etfs.json)— 也进搜索(thesis 标 "ETF",和个股区分)
type EtfRaw = { sym: string; name: string; price: number | null; pct: number | null; ret1y: number | null };
let ETF_CACHE: { items: ManifestItem[]; mtime: number } | null = null;

function loadUsEtfs(): ManifestItem[] {
  const candidates = [
    path.join(process.cwd(), "public", "data", "us-etfs.json"),
    path.resolve(process.cwd(), "..", "web", "public", "data", "us-etfs.json"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const stat = fs.statSync(p);
    if (ETF_CACHE && ETF_CACHE.mtime === stat.mtimeMs) return ETF_CACHE.items;
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf-8")) as { etfs?: EtfRaw[] };
      const items: ManifestItem[] = (j.etfs || []).map((e) => ({
        code: e.sym,
        name: e.name,
        market: "us",
        market_cap_yi: null,
        sector: "ETF",
        layer: null,
        score: 0,
        verdict: "",
        verdict_label: "",
        signals_hit: 0,
        thesis: e.ret1y != null ? `ETF · 近1年 ${e.ret1y > 0 ? "+" : ""}${e.ret1y}%` : "ETF",
      }));
      ETF_CACHE = { items, mtime: stat.mtimeMs };
      return items;
    } catch {
      // try next path
    }
  }
  return [];
}

// 韩股(kr-analyses.json)— 也进搜索;market=kr 让 SearchBox 拼出 /stock/{code}?market=kr。
// market_cap_yi 留 null:韩股 mcapB 是美元口径,塞进"亿(RMB)"会显示错单位,故不参与搜索的市值展示/权重。
type KrRaw = { name?: string; mcapB?: number | null; sector?: string; desc?: string };
let KR_CACHE: { items: ManifestItem[]; mtime: number } | null = null;

// 英文别名:并入 thesis 搜索字段,让搜 "Samsung" / "Hynix" 也能命中(中文名已在 name 里)。
const KR_ALIAS: Record<string, string> = {
  "000660": "SK Hynix",
  "005930": "Samsung Electronics",
};

function loadKrStocks(): ManifestItem[] {
  const candidates = [
    path.join(process.cwd(), "public", "data", "kr-analyses.json"),
    path.resolve(process.cwd(), "..", "web", "public", "data", "kr-analyses.json"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const stat = fs.statSync(p);
    if (KR_CACHE && KR_CACHE.mtime === stat.mtimeMs) return KR_CACHE.items;
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf-8")) as { stocks?: Record<string, KrRaw> };
      const items: ManifestItem[] = Object.entries(j.stocks || {}).map(([code, s]) => ({
        code,
        name: s.name || code,
        market: "kr",
        market_cap_yi: null,
        sector: s.sector || "",
        layer: null,
        score: 0,
        verdict: "",
        verdict_label: "",
        signals_hit: 0,
        thesis: `${s.desc || ""}${KR_ALIAS[code] ? " · " + KR_ALIAS[code] : ""}`,
      }));
      KR_CACHE = { items, mtime: stat.mtimeMs };
      return items;
    } catch {
      // try next path
    }
  }
  return [];
}

function loadManifest(): ManifestItem[] {
  const candidates = [
    path.join(process.cwd(), "data", "aleabit_manifest.json"),
    path.join(process.cwd(), "public", "data", "aleabit_manifest.json"),
    path.resolve(process.cwd(), "..", "data", "aleabit_manifest.json"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const stat = fs.statSync(p);
    if (CACHE && CACHE.mtime === stat.mtimeMs) return CACHE.items;
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as ManifestItem[];
      CACHE = { items: raw, mtime: stat.mtimeMs };
      return raw;
    } catch {
      // try next path
    }
  }
  return [];
}

export async function GET(req: Request) {
  // 限流:每 IP 120 次/分钟(防止有人用搜索接口整库爬取)
  const rl = rateLimit(`search:${clientIp(req)}`, 120, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfter);

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const limit = Number(url.searchParams.get("limit") || "12");

  if (!q || q.length < 1) {
    return NextResponse.json({ results: [] });
  }

  const manifest = loadManifest();
  if (manifest.length === 0) {
    return NextResponse.json({
      results: [],
      warning: "manifest 不存在；运行 uv run python -m scripts.export_manifests",
    });
  }

  // 合并美股全市场（去重：manifest 已有的 US 票优先用 manifest 版本）
  const manifestUsCodes = new Set(
    manifest.filter((i) => i.market === "us").map((i) => i.code.toUpperCase())
  );
  const usExtra = loadUsStocks().filter((u) => !manifestUsCodes.has(u.code.toUpperCase()));
  // ETF 也可搜(个股代码优先:同代码冲突时 manifest/股票版本胜出)
  const seen = new Set([...manifestUsCodes, ...usExtra.map((u) => u.code.toUpperCase())]);
  const etfExtra = loadUsEtfs().filter((e) => !seen.has(e.code.toUpperCase()));
  // 韩股直接并入(代码即使与 A 股 6 位重合也无妨:market 不同、各自链接正确,顶多多一条结果)
  const krExtra = loadKrStocks();
  const items = [...manifest, ...usExtra, ...etfExtra, ...krExtra];

  // 评分优先级：
  // 1. code 完全匹配
  // 2. code 前缀匹配（大小写不敏感）
  // 3. 名称包含
  // 4. 板块包含
  // 5. thesis 包含
  type Result = ManifestItem & { _score: number };
  const matched: Result[] = [];

  for (const s of items) {
    const code = s.code.toLowerCase();
    const name = s.name.toLowerCase();
    const sector = (s.sector || "").toLowerCase();
    const thesis = (s.thesis || "").toLowerCase();

    let rank = 0;
    if (code === q) rank = 1000;
    else if (code.startsWith(q)) rank = 900;
    else if (code.includes(q)) rank = 700;
    else if (name === q) rank = 850;
    else if (name.includes(q)) rank = 600;
    else if (sector.includes(q)) rank = 400;
    else if (thesis.includes(q)) rank = 300;

    if (rank > 0) {
      matched.push({ ...s, _score: rank + s.score * 0.1 + (s.market_cap_yi || 0) * 0.001 });
    }
  }

  matched.sort((a, b) => b._score - a._score);
  const results = matched.slice(0, limit).map(({ _score, ...rest }) => rest);

  return NextResponse.json({ results });
}
