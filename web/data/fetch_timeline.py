"""热力图周度演化 — 拉 pulse 标的半年周线,每周算热度,输出时间序列。

借鉴 FOMO5000 的时间轴:拖动滑块看产业链热度怎么周度演化。

热度算法(每周独立):
  每只票 4 周动量 = close[w] / close[w-4] - 1
  该周所有标的的动量排百分位(0-100) = heat
  → 高动量(涨得猛)= 热(红);低 = 冷(蓝)。相对强度,随周变化。

输出 web/public/data/pulse-timeline.json:
  weeks:  [日期...]                       周度时间轴
  stocks: {ticker: {heat:[...], close:[...]}}  每只票每周热度+收盘(null=缺数据)

用法: python web/data/fetch_timeline.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from fetch_pulse import TICKER_MAP  # 复用 118 标的内部→yfinance 映射

import yfinance as yf

ROOT = Path(__file__).parent.parent.parent
OUT = ROOT / "web" / "public" / "data" / "pulse-timeline.json"
WEEKS_BACK = 27   # 半年
MOM_WINDOW = 4    # 4 周动量


def main():
    print(f"📈 拉 {len(TICKER_MAP)} 标的周线...")
    raw: dict[str, dict[str, float]] = {}  # ticker -> {week: close}
    t0 = time.time()
    ok = 0
    for i, (internal, yf_sym) in enumerate(TICKER_MAP.items()):
        try:
            d = yf.Ticker(yf_sym).history(period="6mo", interval="1wk")
            if len(d) >= 8:
                raw[internal] = {str(idx.date()): round(float(c), 3)
                                 for idx, c in d["Close"].items() if c == c}
                ok += 1
        except Exception:
            pass
        if (i + 1) % 30 == 0:
            print(f"  [{i+1}/{len(TICKER_MAP)}] {ok} 成功 ({time.time()-t0:.0f}s)")
        time.sleep(0.05)

    # 统一周时间轴(所有标的周日期的并集,取最近 WEEKS_BACK)
    all_weeks = sorted(set(w for c in raw.values() for w in c))[-WEEKS_BACK:]
    print(f"\n周时间轴: {len(all_weeks)} 周 ({all_weeks[0]} → {all_weeks[-1]})")

    # 每只票对齐到周网格(缺失=None,用前值填)
    aligned: dict[str, list[float | None]] = {}
    for tk, cm in raw.items():
        series: list[float | None] = []
        last = None
        for w in all_weeks:
            if w in cm:
                last = cm[w]
            series.append(last)
        aligned[tk] = series

    # 每周热度 = 4 周动量的横截面百分位
    n = len(all_weeks)
    heats: dict[str, list[int | None]] = {tk: [None] * n for tk in aligned}
    for wi in range(n):
        moms = {}
        for tk, series in aligned.items():
            cur = series[wi]
            base = series[wi - MOM_WINDOW] if wi >= MOM_WINDOW else series[0]
            if cur and base and base > 0:
                moms[tk] = cur / base - 1
        if not moms:
            continue
        # 百分位
        vals = sorted(moms.values())
        for tk, m in moms.items():
            pct = int(round(np.searchsorted(vals, m) / max(1, len(vals) - 1) * 100))
            heats[tk][wi] = max(0, min(100, pct))

    stocks = {
        tk: {"heat": heats[tk], "close": aligned[tk]}
        for tk in aligned
    }
    OUT.write_text(json.dumps(
        {"weeks": all_weeks, "stocks": stocks,
         "generated_at": all_weeks[-1], "momentum_window": MOM_WINDOW},
        ensure_ascii=False), encoding="utf-8")
    print(f"\n✅ {len(stocks)} 标的 × {n} 周 → {OUT}")
    # 抽样
    for tk in list(stocks)[:3]:
        h = [x for x in heats[tk] if x is not None]
        print(f"   {tk}: 热度 {h[0]}→{h[-1]} (区间 {min(h)}-{max(h)})")


if __name__ == "__main__":
    main()
