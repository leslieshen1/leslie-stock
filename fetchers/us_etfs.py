"""拉全量美股 ETF(Nasdaq ETF screener,无需 key)→ us-etfs.json。

和 us_stocks.py 分开:ETF 没有市值/行业/成交量,字段不同(有「近1年回报」)。
前端 scan 列表把两者合并,用 type 区分(股票/ETF)。

ETF screener 返回结构:data.data.rows[{symbol,companyName,lastSalePrice,
percentageChange,oneYearPercentage,...}]。按近1年回报降序(没有市值/成交量
这类流动性指标,1年回报是唯一有意义的默认排序,让强势 ETF 浮上来)。

输出 web/public/data/us-etfs.json:
  {generated_at, count, etfs: [{sym,name,price,pct,ret1y}...]}

用法: uv run python -m fetchers.us_etfs
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
OUT = ROOT / "web" / "public" / "data" / "us-etfs.json"
CACHE = ROOT / "data" / "_cache" / "us_etf_raw.json"

HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    "origin": "https://www.nasdaq.com",
    "referer": "https://www.nasdaq.com/",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
}
URL = "https://api.nasdaq.com/api/screener/etf?tableonly=true&limit=10000&download=true"


def _f(s) -> float | None:
    if s is None:
        return None
    s = str(s).strip().replace("$", "").replace(",", "").replace("%", "")
    if s in ("", "--", "N/A", "NA"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _clean_name(name: str) -> str:
    n = (name or "").strip()
    for suf in (" Unit", " Units"):
        if n.endswith(suf):
            n = n[: -len(suf)].strip()
    return n


def fetch_rows() -> list[dict]:
    last = None
    for _ in range(6):
        try:
            r = requests.get(URL, headers=HEADERS, timeout=40)
            r.raise_for_status()
            dd = (r.json().get("data") or {}).get("data") or {}
            rows = dd.get("rows") or (dd.get("table") or {}).get("rows") or []
            if rows:
                CACHE.parent.mkdir(parents=True, exist_ok=True)
                CACHE.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
                return rows
        except Exception as e:
            last = e
        time.sleep(4)
    if CACHE.exists():
        print(f"⚠ ETF 拉取失败({str(last)[:40]}),用缓存兜底")
        return json.loads(CACHE.read_text(encoding="utf-8"))
    raise RuntimeError(f"Nasdaq ETF screener 拉取失败且无缓存: {last}")


def main():
    print("📊 拉全量美股 ETF(Nasdaq ETF screener)...")
    rows = fetch_rows()
    print(f"   原始 {len(rows)} 条")

    etfs = []
    for r in rows:
        sym = (r.get("symbol") or "").strip().upper()
        if not sym or "^" in sym or "/" in sym:
            continue
        etfs.append({
            "sym": sym,
            "name": _clean_name(r.get("companyName", "")),
            "price": _f(r.get("lastSalePrice")),
            "pct": round(_f(r.get("percentageChange")) or 0, 2) if r.get("percentageChange") else None,
            "ret1y": round(_f(r.get("oneYearPercentage")) or 0, 2) if r.get("oneYearPercentage") else None,
        })

    # 近1年回报降序(强势 ETF 浮上来;无回报沉底)
    etfs.sort(key=lambda x: x["ret1y"] if x["ret1y"] is not None else -1e9, reverse=True)

    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generated_at": gen, "count": len(etfs), "etfs": etfs,
    }, ensure_ascii=False), encoding="utf-8")
    print(f"\n✅ {len(etfs)} ETF → {OUT}")
    print("   近1年回报 TOP5:")
    for e in etfs[:5]:
        print(f"     {e['sym']:6} {(e['name'] or '')[:30]:32} 1Y {e['ret1y']}%  今 {e['pct']}%")


if __name__ == "__main__":
    main()
