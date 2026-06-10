"""30 日趋势线(热力图详情 sparkline)← 自攒 price_history(库)。

取代 5/27 的旧 yfinance 批量管线:US 全部从自己的 price_history 派生(零外部依赖、
谁也限不了流);A 股没有自有日线(prices 表空),沿用旧 trends.json 条目,等有
A 股日线源再切。heat 时序从未存过,保持 null(sparkline 只画价格线)。

输出 web/public/data/trends.json: {ticker: [{date, close, heat}...]}(≤30 个交易日)

用法: uv run python scripts/build_trends.py
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
OUT = PUB / "trends.json"
DAYS = 30
MIN_PTS = 5  # sparkline 渲染门槛(trend.length >= 5)


def universe() -> set[str]:
    """热力图会渲染的全部 ticker:旧 trends ∪ snapshot.items ∪ supplement。"""
    syms: set[str] = set()
    if OUT.exists():
        try:
            syms |= set(json.loads(OUT.read_text(encoding="utf-8")).keys())
        except Exception:
            pass
    snap = PUB / "pulse-snapshot.json"
    if snap.exists():
        try:
            syms |= set((json.loads(snap.read_text(encoding="utf-8")).get("items") or {}).keys())
        except Exception:
            pass
    supp = PUB / "pulse-supplement.json"
    if supp.exists():
        try:
            syms |= {x.get("ticker") for x in json.loads(supp.read_text(encoding="utf-8")) if x.get("ticker")}
        except Exception:
            pass
    return syms


def main():
    sys.path.insert(0, str(ROOT))
    from db import connect
    c = connect()

    old: dict = {}
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            pass

    out: dict = {}
    rebuilt = kept = 0
    for t in sorted(universe()):
        rows = c.execute(
            "SELECT date, close FROM price_history WHERE sym=? ORDER BY date DESC LIMIT ?",
            (t, DAYS)).fetchall()
        if len(rows) >= MIN_PTS:
            out[t] = [{"date": r["date"], "close": r["close"], "heat": None} for r in reversed(rows)]
            rebuilt += 1
        elif t in old and len(old[t]) >= MIN_PTS:
            out[t] = old[t]  # A股/无自有历史:沿用旧条目(比删功能好)
            kept += 1

    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"✅ trends.json: {len(out)} 只(自有历史重建 {rebuilt} · 沿用旧条目 {kept}) → {OUT}")


if __name__ == "__main__":
    main()
