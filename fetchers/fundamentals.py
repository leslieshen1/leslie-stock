"""美股基本面(Yahoo Finance / yfinance,免费无 key)→ us-fundamentals.json + leslie.db.us_fundamentals。

这是补我们最大的洞:PE / forwardPE / PS / EV-EBITDA / PEG / PB / 毛利 / 营业利润率 /
净利率 / ROE / ROA / 负债率 / 股息率 / 营收增速 / 盈利增速 / FCF / beta / 分析师目标价 / 52周高低。
有了它,股票类型卡"该用什么尺子量"就能给真值,不用等同花顺。

策略:
- 优先股池 = 所有 us-panels(可点进详情的)∪ 市值 top-N。够覆盖用户能看到的全部。
- 每只缓存 data/_cache/fundamentals/{sym}.json,reruns 增量(--max-age-days 内跳过)。
- 线程池并发 + 重试 + graceful skip。Yahoo 限流就退避。
- --all 把 6000+ 全量慢慢磨(多次 refresh 累积)。

用法:
  uv run python -m fetchers.fundamentals                 # panels ∪ 市值 top 1500
  uv run python -m fetchers.fundamentals --top 3000      # 扩到 top 3000
  uv run python -m fetchers.fundamentals --all           # 全量(慢)
  uv run python -m fetchers.fundamentals --syms NVDA,AAPL  # 指定(测试)
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
OUT = PUB / "us-fundamentals.json"
CACHE = ROOT / "data" / "_cache" / "fundamentals"
PANELS = PUB / "us-panels"
US_STOCKS = PUB / "us-stocks.json"


def _r(v, n=3):
    try:
        return round(float(v), n)
    except (TypeError, ValueError):
        return None


def extract(i: dict) -> dict:
    """yfinance .info → 紧凑基本面记录(短 key 控体积)。"""
    return {
        "pe": _r(i.get("trailingPE"), 2),
        "fpe": _r(i.get("forwardPE"), 2),
        "ps": _r(i.get("priceToSalesTrailing12Months"), 2),
        "evE": _r(i.get("enterpriseToEbitda"), 2),
        "evR": _r(i.get("enterpriseToRevenue"), 2),
        "peg": _r(i.get("trailingPegRatio") or i.get("pegRatio"), 2),
        "pb": _r(i.get("priceToBook"), 2),
        "gm": _r(i.get("grossMargins"), 4),
        "om": _r(i.get("operatingMargins"), 4),
        "pm": _r(i.get("profitMargins"), 4),
        "roe": _r(i.get("returnOnEquity"), 4),
        "roa": _r(i.get("returnOnAssets"), 4),
        "de": _r(i.get("debtToEquity"), 1),
        "divY": _r(i.get("dividendYield"), 3),
        "revG": _r(i.get("revenueGrowth"), 4),
        "earnG": _r(i.get("earningsGrowth"), 4),
        "fcf": i.get("freeCashflow"),
        "beta": _r(i.get("beta"), 2),
        "reco": i.get("recommendationKey"),
        "tgt": _r(i.get("targetMeanPrice"), 2),
        "px": _r(i.get("currentPrice"), 2),
        "wkHi": _r(i.get("fiftyTwoWeekHigh"), 2),
        "wkLo": _r(i.get("fiftyTwoWeekLow"), 2),
        "mcapB": _r((i.get("marketCap") or 0) / 1e9, 3) or None,
    }


def fetch_one(sym: str, max_age_days: int) -> dict | None:
    cf = CACHE / f"{sym}.json"
    if cf.exists():
        try:
            cached = json.loads(cf.read_text(encoding="utf-8"))
            ts = datetime.fromisoformat(cached.get("_ts"))
            if (datetime.now(timezone.utc) - ts).days < max_age_days:
                return cached  # 新鲜,跳过网络
        except Exception:
            pass
    last = None
    for attempt in range(3):
        try:
            info = yf.Ticker(sym).info or {}
            if info.get("trailingPE") is None and info.get("marketCap") is None \
               and info.get("priceToSalesTrailing12Months") is None:
                # 多半是无效/退市/ETF 没基本面
                if attempt == 0:
                    time.sleep(0.4)
                    continue
            rec = extract(info)
            rec["_ts"] = datetime.now(timezone.utc).isoformat()
            cf.parent.mkdir(parents=True, exist_ok=True)
            cf.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
            return rec
        except Exception as e:
            last = e
            time.sleep(1.2 * (attempt + 1))  # 退避
    if last:
        print(f"   ⚠ {sym}: {str(last)[:50]}")
    return None


def universe(args) -> list[str]:
    if args.syms:
        return [s.strip().upper() for s in args.syms.split(",") if s.strip()]
    syms: list[str] = []
    seen = set()
    # 1) 所有 panels（可点进详情的票优先）
    if PANELS.exists():
        for p in sorted(PANELS.glob("*.json")):
            s = p.stem.upper()
            if s not in seen:
                seen.add(s)
                syms.append(s)
    # 2) 市值 top-N
    if US_STOCKS.exists():
        stocks = json.loads(US_STOCKS.read_text(encoding="utf-8")).get("stocks", [])
        stocks = [s for s in stocks if s.get("mcapB")]  # 有市值的
        stocks.sort(key=lambda x: x["mcapB"] or 0, reverse=True)
        pool = stocks if args.all else stocks[: args.top]
        for s in pool:
            sym = (s.get("sym") or "").upper()
            if sym and sym not in seen:
                seen.add(sym)
                syms.append(sym)
    if args.limit:
        syms = syms[: args.limit]
    return syms


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=1500, help="额外纳入市值 top-N")
    ap.add_argument("--all", action="store_true", help="全量(忽略 top)")
    ap.add_argument("--limit", type=int, default=0, help="硬上限(0=不限)")
    ap.add_argument("--syms", type=str, default="", help="指定 sym(逗号分隔,测试用)")
    ap.add_argument("--max-age-days", type=int, default=3, help="缓存新鲜期内跳过")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    syms = universe(args)
    print(f"📊 拉美股基本面(Yahoo)... 共 {len(syms)} 只 · {args.workers} 线程")
    t0 = time.time()
    out: dict[str, dict] = {}
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(fetch_one, s, args.max_age_days): s for s in syms}
        for fut in as_completed(futs):
            sym = futs[fut]
            rec = fut.result()
            done += 1
            if rec:
                out[sym] = {k: v for k, v in rec.items() if k != "_ts" and v is not None}
            if done % 200 == 0:
                print(f"   {done}/{len(syms)} ({len(out)} 有数据, {time.time()-t0:.0f}s)")

    # 合并已有(增量:本次没跑的 sym 保留旧值)
    prev = {}
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text(encoding="utf-8")).get("stocks", {})
        except Exception:
            pass
    merged = {**prev, **out}
    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    OUT.write_text(json.dumps({"generated_at": gen, "count": len(merged), "stocks": merged},
                              ensure_ascii=False), encoding="utf-8")

    # 入库(SoT)
    try:
        sys.path.insert(0, str(ROOT))
        from db import connect, init_schema
        init_schema()
        c = connect()
        c.executemany(
            "INSERT INTO us_fundamentals(sym,data,updated_at) VALUES(?,?,?) "
            "ON CONFLICT(sym) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
            [(sym, json.dumps(rec, ensure_ascii=False), gen) for sym, rec in out.items()])
        c.execute("INSERT INTO meta(key,value) VALUES('us_fundamentals_generated_at',?) "
                  "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (gen,))
        c.commit()
        print(f"   ↳ 入库 leslie.db.us_fundamentals: 本次 {len(out)}")
    except Exception as e:
        print(f"   ↳ 入库跳过: {e}")

    print(f"✅ 基本面 {len(out)}/{len(syms)} 本次有数据 · 累计 {len(merged)} → {OUT}  ({time.time()-t0:.0f}s)")
    for sym in list(out)[:5]:
        r = out[sym]
        print(f"   {sym:6} PE {r.get('pe')}  PS {r.get('ps')}  EV/EBITDA {r.get('evE')}  毛利 {r.get('gm')}")


if __name__ == "__main__":
    main()
