"""历史派生量(RSI + 动量,Yahoo 3 个月日线,免费无 key)→ us-history.json + leslie.db.us_history。

给"过热/泡沫度"热度用:RSI 超买、20/60 日动量强 = 过热。
每只缓存,reruns 增量;线程池 + 退避(Yahoo 限流时优雅跳过)。

用法:
  uv run python -m fetchers.history                 # panels ∪ 市值 top 1500
  uv run python -m fetchers.history --top 3000
  uv run python -m fetchers.history --syms NVDA,AAPL
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
OUT = PUB / "us-history.json"
CACHE = ROOT / "data" / "_cache" / "history"
PANELS = PUB / "us-panels"
US_STOCKS = PUB / "us-stocks.json"
# Nasdaq 历史接口(和 screener 同源,比 Yahoo 公开端点宽容得多)
H = {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    "accept": "application/json, text/plain, */*",
    "origin": "https://www.nasdaq.com",
    "referer": "https://www.nasdaq.com/",
}


def rsi14(closes: list[float]) -> float | None:
    if len(closes) < 15:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    n = 14
    ag = sum(gains[-n:]) / n
    al = sum(losses[-n:]) / n
    if al == 0:
        return 100.0 if ag > 0 else 50.0
    rs = ag / al
    return round(100 - 100 / (1 + rs), 1)


def fetch_one(sym: str, max_age_days: int) -> dict | None:
    cf = CACHE / f"{sym}.json"
    if cf.exists():
        try:
            cached = json.loads(cf.read_text(encoding="utf-8"))
            ts = datetime.fromisoformat(cached.get("_ts"))
            if (datetime.now(timezone.utc) - ts).days < max_age_days:
                return cached
        except Exception:
            pass
    d2 = datetime.now().strftime("%Y-%m-%d")
    d1 = (datetime.now() - timedelta(days=130)).strftime("%Y-%m-%d")
    url = (f"https://api.nasdaq.com/api/quote/{sym}/historical"
           f"?assetclass=stocks&fromdate={d1}&todate={d2}&limit=9999")
    for attempt in range(4):
        try:
            r = requests.get(url, headers=H, timeout=25)
            if r.status_code in (429, 403):
                time.sleep(2.0 * (attempt + 1))
                continue
            r.raise_for_status()
            rows = (((r.json() or {}).get("data") or {}).get("tradesTable") or {}).get("rows") or []
            closes = []
            for row in reversed(rows):  # Nasdaq 返回最新在前 → 反转成 旧→新
                v = str(row.get("close", "")).replace("$", "").replace(",", "")
                try:
                    closes.append(float(v))
                except ValueError:
                    pass
            if len(closes) < 20:
                return None
            px = closes[-1]
            ret20 = round((px / closes[-21] - 1) * 100, 2) if len(closes) >= 21 else None
            ret60 = round((px / closes[-61] - 1) * 100, 2) if len(closes) >= 61 else round((px / closes[0] - 1) * 100, 2)
            rec = {"rsi": rsi14(closes), "ret20": ret20, "ret60": ret60,
                   "_ts": datetime.now(timezone.utc).isoformat()}
            cf.parent.mkdir(parents=True, exist_ok=True)
            cf.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
            return rec
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
        stocks = [s for s in json.loads(US_STOCKS.read_text(encoding="utf-8")).get("stocks", []) if s.get("mcapB")]
        stocks.sort(key=lambda x: x["mcapB"] or 0, reverse=True)
        for s in (stocks if args.all else stocks[: args.top]):
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
    ap.add_argument("--max-age-days", type=int, default=2)
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    syms = universe(args)
    print(f"📈 拉历史(RSI/动量,Nasdaq 3mo)... {len(syms)} 只 · {args.workers} 线程")
    t0 = time.time()
    out: dict[str, dict] = {}
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(fetch_one, s, args.max_age_days): s for s in syms}
        for fut in as_completed(futs):
            sym = futs[fut]; rec = fut.result(); done += 1
            if rec:
                out[sym] = {k: v for k, v in rec.items() if k != "_ts" and v is not None}
            if done % 300 == 0:
                print(f"   {done}/{len(syms)} ({len(out)} 有数据, {time.time()-t0:.0f}s)")

    prev = {}
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text(encoding="utf-8")).get("stocks", {})
        except Exception:
            pass
    merged = {**prev, **out}
    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    OUT.write_text(json.dumps({"generated_at": gen, "count": len(merged), "stocks": merged}, ensure_ascii=False), encoding="utf-8")

    try:
        sys.path.insert(0, str(ROOT))
        from db import connect, init_schema
        init_schema(); c = connect()
        c.executemany("INSERT INTO us_history(sym,data,updated_at) VALUES(?,?,?) "
                      "ON CONFLICT(sym) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
                      [(s, json.dumps(r, ensure_ascii=False), gen) for s, r in out.items()])
        c.execute("INSERT INTO meta(key,value) VALUES('us_history_generated_at',?) "
                  "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (gen,))
        c.commit()
        print(f"   ↳ 入库 us_history: 本次 {len(out)}")
    except Exception as e:
        print(f"   ↳ 入库跳过: {e}")
    print(f"✅ 历史 {len(out)}/{len(syms)} 本次 · 累计 {len(merged)} → {OUT}  ({time.time()-t0:.0f}s)")
    for s in list(out)[:4]:
        print(f"   {s}: RSI {out[s].get('rsi')} · 20d {out[s].get('ret20')}% · 60d {out[s].get('ret60')}%")


if __name__ == "__main__":
    main()
