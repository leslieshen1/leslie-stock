"""回种全市场日线(Nasdaq 历史接口,免费,和 screener 同源)→ leslie.db.price_history。

只在"自攒历史"还不够时跑(初次回种 3 个月,或给新上市票补种)。
日常 RSI/动量由 scripts/build_history_metrics.py 从 price_history 自己算 —— 不再每天打外部接口。
已有 ≥50 行的 sym 默认跳过(--reseed 强制重抓)。

用法:
  uv run python -m fetchers.history                 # panels ∪ 市值 top 1500,跳过已种
  uv run python -m fetchers.history --all            # 全市场回种
  uv run python -m fetchers.history --syms NVDA,AAPL --reseed
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
PANELS = PUB / "us-panels"
US_STOCKS = PUB / "us-stocks.json"
H = {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    "accept": "application/json, text/plain, */*",
    "origin": "https://www.nasdaq.com", "referer": "https://www.nasdaq.com/",
}


def _f(v):
    try:
        return float(str(v).replace("$", "").replace(",", ""))
    except (TypeError, ValueError):
        return None


def fetch_rows(sym: str, days: int) -> list[tuple] | None:
    """Nasdaq 历史 → [(date_iso, close, vol)]。"""
    d2 = datetime.now().strftime("%Y-%m-%d")
    d1 = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    url = (f"https://api.nasdaq.com/api/quote/{sym}/historical"
           f"?assetclass=stocks&fromdate={d1}&todate={d2}&limit=9999")
    for attempt in range(4):
        try:
            r = requests.get(url, headers=H, timeout=25)
            if r.status_code in (429, 403):
                time.sleep(2.0 * (attempt + 1)); continue
            r.raise_for_status()
            rows = (((r.json() or {}).get("data") or {}).get("tradesTable") or {}).get("rows") or []
            out = []
            for row in rows:
                ds = str(row.get("date", ""))  # MM/DD/YYYY
                try:
                    mm, dd, yy = ds.split("/")
                    date_iso = f"{yy}-{mm.zfill(2)}-{dd.zfill(2)}"
                except ValueError:
                    continue
                close = _f(row.get("close"))
                if close is not None:
                    out.append((sym, date_iso, close, _f(row.get("volume"))))
            return out or None
        except Exception:
            time.sleep(1.2 * (attempt + 1))
    return None


def universe(args) -> list[str]:
    if args.syms:
        return [s.strip().upper() for s in args.syms.split(",") if s.strip()]
    syms, seen = [], set()
    if PANELS.exists():
        for p in sorted(PANELS.glob("*.json")):
            s = p.stem.upper()
            if s not in seen:
                seen.add(s); syms.append(s)
    if US_STOCKS.exists():
        st = [s for s in json.loads(US_STOCKS.read_text(encoding="utf-8")).get("stocks", []) if s.get("mcapB")]
        st.sort(key=lambda x: x["mcapB"] or 0, reverse=True)
        for s in (st if args.all else st[: args.top]):
            sym = (s.get("sym") or "").upper()
            if sym and sym not in seen:
                seen.add(sym); syms.append(sym)
    return syms[: args.limit] if args.limit else syms


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=1500)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--syms", type=str, default="")
    ap.add_argument("--days", type=int, default=130)
    ap.add_argument("--reseed", action="store_true", help="已种的也重抓")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    sys.path.insert(0, str(ROOT))
    from db import connect, init_schema
    init_schema()
    c = connect()
    seeded = set()
    if not args.reseed:
        seeded = {r[0] for r in c.execute(
            "SELECT sym FROM price_history GROUP BY sym HAVING COUNT(*) >= 50")}

    # 失败缓存:抓不到的(退市/A股代码混入 panels/怪符号)7 天内不再重试。
    # 没有它,~400 只死代码每次 refresh 反复 4 连重试,白耗 10+ 分钟。
    fail_path = ROOT / "data" / "_cache" / "history_failed.json"
    try:
        failed_at = json.loads(fail_path.read_text(encoding="utf-8"))
    except Exception:
        failed_at = {}
    cutoff = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    fresh_failed = {s for s, d in failed_at.items() if d >= cutoff}

    syms = [s for s in universe(args) if s not in seeded and (args.reseed or s not in fresh_failed)]
    print(f"🌱 回种日线(Nasdaq {args.days}d)→ price_history... {len(syms)} 只待种"
          f"(已跳过 {len(seeded)} 只已种 + {len(fresh_failed)} 只近7天失败)· {args.workers} 线程")
    t0 = time.time(); done = ins = 0
    today = datetime.now().strftime("%Y-%m-%d")
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(fetch_rows, s, args.days): s for s in syms}
        for fut in as_completed(futs):
            rows = fut.result(); done += 1
            if rows is None:
                failed_at[futs[fut]] = today
            elif futs[fut] in failed_at:
                del failed_at[futs[fut]]
            if rows:
                c.executemany(
                    "INSERT INTO price_history(sym,date,close,volume) VALUES(?,?,?,?) "
                    "ON CONFLICT(sym,date) DO UPDATE SET close=excluded.close,volume=excluded.volume", rows)
                ins += len(rows)
            if done % 200 == 0:
                c.commit()
                print(f"   {done}/{len(syms)} ({ins} 行, {time.time()-t0:.0f}s)")
    c.commit()
    try:
        fail_path.parent.mkdir(parents=True, exist_ok=True)
        fail_path.write_text(json.dumps(failed_at, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass
    total = c.execute("SELECT COUNT(*) FROM price_history").fetchone()[0]
    nsym = c.execute("SELECT COUNT(DISTINCT sym) FROM price_history").fetchone()[0]
    print(f"✅ 回种完成:本次 +{ins} 行 · price_history 共 {total} 行 / {nsym} 只  ({time.time()-t0:.0f}s)")


if __name__ == "__main__":
    main()
