"""印股票 / 稀释红旗 — 扫美股高危区的 SEC 货架注册 + ATM 增发。

背景:微盘 / 仙股 / 外国注册的美股,常有 shelf registration(S-3/F-3 货架)
+ ATM(at-the-market)增发,发行方可随时在市场增发砸盘。$WOK 就是典型:
市值≈0 却有 $200M ATM 弹药。这类是"供给无限的合约",比 meme 还毒。

数据全免费(SEC EDGAR,无 key,需 User-Agent):
  ticker→CIK:  www.sec.gov/files/company_tickers.json
  公司文件:     data.sec.gov/submissions/CIK{cik}.json
  招股书原文:   www.sec.gov/Archives/edgar/data/{cik}/{acc}/{doc}

只扫高危区(市值<$500M 或 价格<$5,~2400 只),大盘股不做(不搞稀释 ATM)。

红旗分级:
  active  正在增发:有货架 + 近 365 天有 424B5/424B3 提款
  armed   有货架弹药:有 S-3/F-3 货架,但近期没提款
(没有货架的不打旗)

输出 web/public/data/dilution-flags.json:
  {sym: {tier, shelf, atm_1y, foreign, capacity_usd, ratio, last_takedown}}

用法: uv run python -m fetchers.dilution_flags
"""
from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
US = ROOT / "web" / "public" / "data" / "us-stocks.json"
OUT = ROOT / "web" / "public" / "data" / "dilution-flags.json"
CACHE = ROOT / "data" / "_cache" / "edgar"
CACHE.mkdir(parents=True, exist_ok=True)

UA = {"User-Agent": "leslie-stock research leslieshen6@gmail.com"}
SHELF = {"S-3", "S-3/A", "F-3", "F-3/A"}
TAKEDOWN = {"424B5", "424B3"}           # ATM / 货架提款
FOLLOWON = {"424B4"}                     # 一次性增发(也稀释)
FOREIGN_F = {"20-F", "20-F/A", "F-1", "F-1/A", "F-3", "6-K"}


def get_json(url: str, cache_f: Path | None = None, retries: int = 3):
    if cache_f and cache_f.exists():
        try:
            return json.loads(cache_f.read_text(encoding="utf-8"))
        except Exception:
            pass
    for _ in range(retries):
        try:
            r = requests.get(url, headers=UA, timeout=25)
            if r.status_code == 200:
                j = r.json()
                if cache_f:
                    cache_f.write_text(json.dumps(j), encoding="utf-8")
                return j
        except Exception:
            pass
        time.sleep(1)
    return None


def atm_capacity(text: str) -> float | None:
    """从 ATM 招股书精确抓发行额度。

    锚定 'up to $X' / 'aggregate offering price of up to $X' 这类措辞(ATM 标准
    句式),而非全文最大数(会抓到市场规模之类的噪声)。限合理区间 $1M–$5B。
    """
    plain = re.sub(r"<[^>]+>", " ", text)
    amts = []
    for num, unit in re.findall(
        r"(?:up to|aggregate (?:offering|sales) price of(?: up to)?)\s*\$\s?([\d,]+(?:\.\d+)?)\s*(million|billion)?",
        plain, re.I,
    ):
        try:
            v = float(num.replace(",", ""))
        except ValueError:
            continue
        if unit.lower() == "million":
            v *= 1e6
        elif unit.lower() == "billion":
            v *= 1e9
        if 1e6 <= v <= 5e9:           # 合理区间,过滤误抓
            amts.append(v)
    return max(amts) if amts else None


def main():
    stocks = json.load(open(US, encoding="utf-8"))["stocks"]
    by_sym = {s["sym"]: s for s in stocks}

    # 高危候选:市值 < $500M 或 价格 < $5
    cand = [s["sym"] for s in stocks
            if (s["mcapB"] is not None and s["mcapB"] < 0.5)
            or (s["price"] is not None and s["price"] < 5)]
    print(f"高危候选: {len(cand)} 只")

    tk = get_json("https://www.sec.gov/files/company_tickers.json",
                  CACHE / "_ticker_map.json")
    ciks = {v["ticker"].upper(): str(v["cik_str"]).zfill(10) for v in tk.values()}

    cutoff = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")
    flags: dict[str, dict] = {}
    t0 = time.time()

    def scan_one(sym):
        cik = ciks.get(sym)
        if not cik:
            return None
        sub = get_json(f"https://data.sec.gov/submissions/CIK{cik}.json", CACHE / f"{cik}.json")
        if not sub:
            return None
        rec = sub.get("filings", {}).get("recent", {})
        forms = rec.get("form", [])
        dates = rec.get("filingDate", [])
        if not forms:
            return None

        has_shelf = any(f in SHELF for f in forms)
        foreign = any(f in FOREIGN_F for f in forms)
        atm_1y = sum(1 for f, d in zip(forms, dates) if f in TAKEDOWN and d >= cutoff)
        followon_1y = sum(1 for f, d in zip(forms, dates) if f in FOLLOWON and d >= cutoff)
        last_td = td_idx = None
        for i, (f, d) in enumerate(zip(forms, dates)):
            if f in TAKEDOWN:
                last_td, td_idx = d, i
                break  # recent 倒序,第一个最新

        # 只标 active:近 1 年真有 424B5/424B3 提款 = 正在 ATM/增发(用户要的就是这个)。
        # "有货架但没近期提款"太普遍(小盘标配),不算红旗。
        if atm_1y >= 1:
            tier = "active"
        else:
            return None

        # 额度(仅 active,抓最新 424B5 原文取最大美元)
        capacity = ratio = None
        if tier == "active" and td_idx is not None:
            try:
                acc = rec["accessionNumber"][td_idx].replace("-", "")
                doc = rec["primaryDocument"][td_idx]
                url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc}/{doc}"
                dc = CACHE / f"{cik}_{acc}.txt"
                if dc.exists():
                    txt = dc.read_text(encoding="utf-8", errors="ignore")
                else:
                    txt = requests.get(url, headers=UA, timeout=25).text
                    dc.write_text(txt[:600_000], encoding="utf-8")
                capacity = atm_capacity(txt)
                mc = by_sym[sym]["mcapB"]
                if capacity and mc and mc > 0:
                    ratio = round(capacity / (mc * 1e9), 1)
            except Exception:
                pass

        return sym, {
            "tier": tier, "shelf": has_shelf, "atm_1y": atm_1y,
            "followon_1y": followon_1y, "foreign": foreign,
            "capacity_usd": capacity, "ratio": ratio, "last_takedown": last_td,
        }

    # 并发(SEC 限 10 req/s,8 worker 安全)；已缓存的 CIK 瞬间跳过
    done = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        for res in ex.map(scan_one, cand):
            done += 1
            if res:
                flags[res[0]] = res[1]
            if done % 300 == 0:
                print(f"  [{done}/{len(cand)}] {len(flags)} 打旗 ({time.time()-t0:.0f}s)", flush=True)

    active = sum(1 for v in flags.values() if v["tier"] == "active")
    OUT.write_text(json.dumps({
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "scanned": done,
        "flags": flags,
    }, ensure_ascii=False), encoding="utf-8")
    print(f"\n✅ 扫 {done} 只 · {len(flags)} 打旗（active {active} / armed {len(flags)-active}）→ {OUT}")
    # 抽样:稀释倍数最高的
    top = sorted([(s, f) for s, f in flags.items() if f["ratio"]],
                 key=lambda x: -x[1]["ratio"])[:8]
    for s, f in top:
        print(f"   {s:6} {f['tier']:7} 货架${(f['capacity_usd'] or 0)/1e6:.0f}M · 市值的 {f['ratio']}x · 近1年{f['atm_1y']}份424B5")


if __name__ == "__main__":
    main()
