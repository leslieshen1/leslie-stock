"""宏观/大盘快照(Yahoo Finance,免费无 key)→ macro.json + leslie.db.macro。

对标 ru7 终端顶部那条:利率(10Y/13W/30Y)、三大指数、VIX、美元、油金、BTC/ETH。
一次 yf.download 批量拉,取最近两根收盘算涨跌幅。

输出 web/public/data/macro.json:
  {generated_at, series:[{sym,name,kind,price,pct}...]}

用法: uv run python -m fetchers.macro
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf

ROOT = Path(__file__).parent.parent
OUT = ROOT / "web" / "public" / "data" / "macro.json"

# (yahoo symbol, 显示名, 类别)
SERIES = [
    ("^TNX", "美债 10Y", "rate"),
    ("^IRX", "美债 13W", "rate"),
    ("^FVX", "美债 5Y", "rate"),
    ("^TYX", "美债 30Y", "rate"),
    ("^GSPC", "标普 500", "index"),
    ("^IXIC", "纳斯达克", "index"),
    ("^DJI", "道琼斯", "index"),
    ("^RUT", "罗素 2000", "index"),
    ("^VIX", "VIX 恐慌", "vol"),
    ("DX-Y.NYB", "美元指数", "fx"),
    ("GC=F", "黄金", "commodity"),
    ("CL=F", "原油 WTI", "commodity"),
    ("BTC-USD", "比特币", "crypto"),
    ("ETH-USD", "以太坊", "crypto"),
]


def fetch() -> list[dict]:
    syms = [s[0] for s in SERIES]
    name = {s[0]: s[1] for s in SERIES}
    kind = {s[0]: s[2] for s in SERIES}
    # 一次批量拉 5 天日线,取最后两根收盘
    df = yf.download(syms, period="7d", interval="1d", group_by="ticker",
                     auto_adjust=False, progress=False, threads=True)
    out = []
    for sym in syms:
        try:
            closes = df[sym]["Close"].dropna()
            if len(closes) == 0:
                continue
            last = float(closes.iloc[-1])
            prev = float(closes.iloc[-2]) if len(closes) >= 2 else last
            pct = round((last - prev) / prev * 100, 2) if prev else None
            out.append({"sym": sym, "name": name[sym], "kind": kind[sym],
                        "price": round(last, 2), "pct": pct})
        except Exception as e:
            print(f"   ⚠ {sym}: {str(e)[:50]}")
    return out


def main():
    print("🌍 拉宏观/大盘(Yahoo Finance)...")
    series = fetch()
    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"generated_at": gen, "series": series}, ensure_ascii=False),
                   encoding="utf-8")

    # 入库(SoT)
    try:
        sys.path.insert(0, str(ROOT))
        from db import connect, init_schema
        init_schema()
        c = connect()
        c.executemany(
            "INSERT INTO macro(sym,name,price,pct,kind,updated_at) VALUES(?,?,?,?,?,?) "
            "ON CONFLICT(sym) DO UPDATE SET name=excluded.name,price=excluded.price,"
            "pct=excluded.pct,kind=excluded.kind,updated_at=excluded.updated_at",
            [(s["sym"], s["name"], s["price"], s["pct"], s["kind"], gen) for s in series])
        c.execute("INSERT INTO meta(key,value) VALUES('macro_generated_at',?) "
                  "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (gen,))
        c.commit()
        print(f"   ↳ 入库 leslie.db.macro: {len(series)}")
    except Exception as e:
        print(f"   ↳ 入库跳过: {e}")

    print(f"✅ {len(series)} 项宏观 → {OUT}")
    for s in series:
        pct = f"{s['pct']:+.2f}%" if s["pct"] is not None else "  —  "
        print(f"   {s['sym']:10} {s['name']:8} {s['price']:>12,.2f}  {pct}")


if __name__ == "__main__":
    main()
