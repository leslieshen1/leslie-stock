"""拉全量美股 ETF(Nasdaq ETF screener,无需 key)→ us-etfs.json。

和 us_stocks.py 分开:ETF 没有市值/行业/成交量,字段不同(有「近1年回报」)。
前端 scan 列表把两者合并,用 type 区分(股票/ETF)。

ETF screener 返回结构:data.data.rows[{symbol,companyName,lastSalePrice,
percentageChange,oneYearPercentage,...}]。按近1年回报降序(没有市值/成交量
这类流动性指标,1年回报是唯一有意义的默认排序,让强势 ETF 浮上来)。

⚠ screener 的 lastSalePrice/percentageChange 走 Nasdaq 的 EOD 批处理,比股票
screener 滞后约一个交易日(收盘后 11h+ 仍是前日数据)。所以 price/pct 不用它,
改用 Yahoo 批量日线(同 macro.py:最近两根收盘算涨跌幅,收盘后几分钟即更新);
Yahoo 没覆盖到的票退回 screener 值(旧一天,聊胜于无)。

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


def overlay_yahoo_closes(etfs: list[dict]) -> int:
    """price/pct 换成 Yahoo 日线的最近收盘(screener 的 EOD 滞后一天)。

    分块批量拉,单块失败只丢那一块;整体失败保留 screener 值。返回覆盖条数。
    """
    import logging

    import yfinance as yf

    logging.getLogger("yfinance").setLevel(logging.CRITICAL)
    n, chunk = 0, 800
    by_sym = {e["sym"]: e for e in etfs}
    syms = list(by_sym)
    for i in range(0, len(syms), chunk):
        batch = syms[i:i + chunk]
        try:
            df = yf.download(batch, period="7d", interval="1d", group_by="ticker",
                             auto_adjust=False, progress=False, threads=True)
        except Exception as e:
            print(f"   ⚠ Yahoo 批次 {i//chunk + 1} 失败: {str(e)[:60]}")
            continue
        for sym in batch:
            try:
                closes = (df[sym] if len(batch) > 1 else df)["Close"].dropna()
                if len(closes) < 2:
                    continue
                last, prev = float(closes.iloc[-1]), float(closes.iloc[-2])
                if not last or not prev:
                    continue
                by_sym[sym]["price"] = round(last, 2)
                by_sym[sym]["pct"] = round((last - prev) / prev * 100, 2)
                n += 1
            except Exception:
                continue
        time.sleep(1)
    return n


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

    # price/pct 刷成最近收盘(Yahoo;screener 滞后一天,见模块注释)
    try:
        fresh = overlay_yahoo_closes(etfs)
        print(f"   ↳ Yahoo 最近收盘覆盖 {fresh}/{len(etfs)},其余保留 screener 值")
    except Exception as e:
        print(f"   ⚠ Yahoo 覆盖整体跳过(保留 screener 值,滞后一天): {str(e)[:60]}")

    # 近1年回报降序(强势 ETF 浮上来;无回报沉底)
    etfs.sort(key=lambda x: x["ret1y"] if x["ret1y"] is not None else -1e9, reverse=True)

    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generated_at": gen, "count": len(etfs), "etfs": etfs,
    }, ensure_ascii=False), encoding="utf-8")

    # 写入 SoT 库(leslie.db)—— build_json 的 sync_inputs_into_db 也能从本 JSON 重建
    try:
        import sys as _sys
        _sys.path.insert(0, str(ROOT))
        from db import connect, init_schema
        init_schema()
        c = connect()
        c.executemany(
            """INSERT INTO us_etfs(sym,name,price,pct,ret1y) VALUES(?,?,?,?,?)
               ON CONFLICT(sym) DO UPDATE SET name=excluded.name,price=excluded.price,
               pct=excluded.pct,ret1y=excluded.ret1y""",
            [(e["sym"], e["name"], e["price"], e["pct"], e["ret1y"]) for e in etfs])
        c.execute("INSERT INTO meta(key,value) VALUES('us_etfs_generated_at',?) "
                  "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (gen,))
        c.commit()
        print(f"   ↳ 入库 leslie.db.us_etfs: {len(etfs)}")
    except Exception as e:
        print(f"   ↳ 入库跳过: {e}")

    print(f"\n✅ {len(etfs)} ETF → {OUT}")
    print("   近1年回报 TOP5:")
    for e in etfs[:5]:
        print(f"     {e['sym']:6} {(e['name'] or '')[:30]:32} 1Y {e['ret1y']}%  今 {e['pct']}%")


if __name__ == "__main__":
    main()
