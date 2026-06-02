"""拉全量美股 + ETF(Nasdaq screener)→ us-stocks.json。

币安 2026-06-01 上线的 ~7000 美股,后端走 Alpaca,本质就是标准美股全集。
这里用免费 Nasdaq screener(无需 key)一次拉全 NASDAQ+NYSE+AMEX,
带价格/涨跌幅/成交量/市值/行业 —— 够喂 scan 美股视图 + 后续市场地图热力图。

输出 web/public/data/us-stocks.json:
  {generated_at, count, stocks: [{sym,name,price,pct,mcapB,sector,industry,vol,country}...]}

字段精简(7000 条要控体积)。市值单位 = 十亿美元(B)。

用法: uv run python -m fetchers.us_stocks
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
OUT = ROOT / "web" / "public" / "data" / "us-stocks.json"
CACHE = ROOT / "data" / "_cache" / "us_screener_raw.json"

HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    "origin": "https://www.nasdaq.com",
    "referer": "https://www.nasdaq.com/",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
}
URL = "https://api.nasdaq.com/api/screener/stocks?tableonly=false&limit=10000&download=true"


def _f(s) -> float | None:
    """'$135.98' / '1,234.5' / '0.332%' → float。"""
    if s is None:
        return None
    s = str(s).strip().replace("$", "").replace(",", "").replace("%", "")
    if s in ("", "--", "N/A", "NA"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _int(s) -> int | None:
    v = _f(s)
    return int(v) if v is not None else None


_SUFFIXES = (
    " Common Stock", " Common Shares", " Ordinary Shares", " American Depositary Shares",
    " Class A Common Stock", " Class B Common Stock", " Class C Capital Stock",
)


def _clean_name(name: str) -> str:
    n = (name or "").strip()
    for suf in _SUFFIXES:
        if n.endswith(suf):
            return n[: -len(suf)].strip()
    return n


def fetch_rows() -> list[dict]:
    last = None
    for attempt in range(6):
        try:
            r = requests.get(URL, headers=HEADERS, timeout=40)
            r.raise_for_status()
            j = r.json()
            data = j.get("data") or {}
            rows = data.get("rows")
            if not rows and isinstance(data.get("table"), dict):
                rows = data["table"].get("rows")
            if rows:
                CACHE.parent.mkdir(parents=True, exist_ok=True)
                CACHE.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
                return rows
        except Exception as e:
            last = e
        time.sleep(4)
    # 网络失败 → 用缓存兜底
    if CACHE.exists():
        print(f"⚠ Nasdaq 拉取失败({str(last)[:40]}),用缓存兜底")
        return json.loads(CACHE.read_text(encoding="utf-8"))
    raise RuntimeError(f"Nasdaq screener 拉取失败且无缓存: {last}")


def main():
    print("📈 拉全量美股(Nasdaq screener)...")
    rows = fetch_rows()
    print(f"   原始 {len(rows)} 条")

    stocks = []
    for r in rows:
        sym = (r.get("symbol") or "").strip().upper()
        if not sym or "^" in sym or "/" in sym:  # 跳过指数/异常符号
            continue
        mcap = _f(r.get("marketCap"))
        stocks.append({
            "sym": sym,
            "name": _clean_name(r.get("name", "")),
            "price": _f(r.get("lastsale")),
            "pct": _f(r.get("pctchange")),
            "mcapB": round(mcap / 1e9, 3) if mcap else None,
            "sector": (r.get("sector") or "").strip(),
            "industry": (r.get("industry") or "").strip(),
            "vol": _int(r.get("volume")),
            "country": (r.get("country") or "").strip(),
        })

    # 按市值降序(无市值沉底)
    stocks.sort(key=lambda x: x["mcapB"] or 0, reverse=True)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "count": len(stocks),
        "stocks": stocks,
    }, ensure_ascii=False), encoding="utf-8")

    sectors = {}
    for s in stocks:
        sectors[s["sector"] or "—"] = sectors.get(s["sector"] or "—", 0) + 1
    print(f"\n✅ {len(stocks)} 美股 → {OUT}")
    print(f"   行业前6: {sorted(sectors.items(), key=lambda x: -x[1])[:6]}")
    print("   市值 TOP5:")
    for s in stocks[:5]:
        print(f"     {s['sym']:6} {s['name'][:26]:28} ${s['mcapB']:.0f}B  {s['pct']:+.1f}%")


if __name__ == "__main__":
    main()
