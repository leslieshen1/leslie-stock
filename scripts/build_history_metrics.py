"""从自攒的 price_history 算 RSI/动量 → us-history.json + leslie.db.us_history。

不打任何外部历史接口 —— closes 全是我们每次 refresh 自己攒进 price_history 的。
攒够 ≥20 个交易日就能算;≥61 天 60日动量才准。

输出 us-history.json: {generated_at, count, stocks:{SYM:{rsi,ret20,ret60}}}
用法: python scripts/build_history_metrics.py
"""
from __future__ import annotations
import json
import sys
from datetime import datetime, timezone
from itertools import groupby
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT = ROOT / "web" / "public" / "data" / "us-history.json"
sys.path.insert(0, str(ROOT))
from db import connect, init_schema


def rsi14(closes: list[float]) -> float | None:
    if len(closes) < 15:
        return None
    gains = losses = 0.0
    for i in range(len(closes) - 14, len(closes)):
        d = closes[i] - closes[i - 1]
        gains += max(d, 0.0); losses += max(-d, 0.0)
    ag, al = gains / 14, losses / 14
    if al == 0:
        return 100.0 if ag > 0 else 50.0
    return round(100 - 100 / (1 + ag / al), 1)


def main():
    init_schema()
    c = connect()
    rows = c.execute("SELECT sym,date,close FROM price_history WHERE close IS NOT NULL "
                     "ORDER BY sym, date").fetchall()
    out = {}
    for sym, grp in groupby(rows, key=lambda r: r[0]):
        closes = [r[2] for r in grp]  # 已按 date 升序
        if len(closes) < 20:
            continue
        px = closes[-1]
        ret20 = round((px / closes[-21] - 1) * 100, 2) if len(closes) >= 21 else None
        ret60 = round((px / closes[-61] - 1) * 100, 2) if len(closes) >= 61 \
            else round((px / closes[0] - 1) * 100, 2)
        rec = {"rsi": rsi14(closes), "ret20": ret20, "ret60": ret60}
        out[sym] = {k: v for k, v in rec.items() if v is not None}

    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    OUT.write_text(json.dumps({"generated_at": gen, "count": len(out), "stocks": out},
                              ensure_ascii=False), encoding="utf-8")
    c.executemany("INSERT INTO us_history(sym,data,updated_at) VALUES(?,?,?) "
                  "ON CONFLICT(sym) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
                  [(s, json.dumps(r, ensure_ascii=False), gen) for s, r in out.items()])
    c.execute("INSERT INTO meta(key,value) VALUES('us_history_generated_at',?) "
              "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (gen,))
    c.commit()
    ndays = c.execute("SELECT COUNT(DISTINCT date) FROM price_history").fetchone()[0]
    print(f"✓ us-history.json: {len(out)} 只(RSI/动量,自攒 {ndays} 个交易日算出)")


if __name__ == "__main__":
    main()
