"""过热/泡沫度热度 → us-heat.json。不是"今天涨跌",而是"贵不贵 + 离自己高点多远 + 超不超买 + 动量"。

综合 4 个信号(都 0-100,越高越过热/泡沫):
  - pos52  离 52 周高点(px 在 [低,高] 区间的位置)—— 越靠高点越热。来源 us-fundamentals(px/wkHi/wkLo)
  - val    估值贵(PS + EV/EBITDA 全市场分位)—— 越贵越热。来源 us-fundamentals
  - rsi    14 日 RSI —— 超买越热。来源 us-history(需历史价,缺则跳过)
  - mom    60 日动量(clamp 50+ret60×0.8)—— 涨势越猛越热。来源 us-history
权重 pos52 .35 / val .30 / rsi .20 / mom .15,按"实际有哪些信号"归一化。
都缺 → 中性 50。这样大盘跌一天不会让强势/贵的票变冰点(和"今天涨跌"脱钩)。

用法: python scripts/build_us_heat.py
"""
from __future__ import annotations
import json
from pathlib import Path

PUB = Path(__file__).parent.parent / "web" / "public" / "data"
US = PUB / "us-stocks.json"
FUND = PUB / "us-fundamentals.json"
HIST = PUB / "us-history.json"
OUT = PUB / "us-heat.json"

W = {"pos52": 0.35, "val": 0.30, "rsi": 0.20, "mom": 0.15}


def clamp(v, lo=0.0, hi=100.0):
    return max(lo, min(hi, v))


def pctile(d: dict) -> dict:
    """{sym: value} → {sym: 0-100 分位}(值越大分位越高)。"""
    items = sorted(d.items(), key=lambda kv: kv[1])
    n = max(1, len(items) - 1)
    return {sym: round(100 * i / n) for i, (sym, _) in enumerate(items)}


def main():
    d = json.load(open(US, encoding="utf-8"))
    stocks = d.get("stocks", d)
    fund = json.load(open(FUND, encoding="utf-8")).get("stocks", {}) if FUND.exists() else {}
    hist = json.load(open(HIST, encoding="utf-8")).get("stocks", {}) if HIST.exists() else {}

    # 估值分位:PS + EV/EBITDA(只取正值),贵 = 高分位 = 热
    ps = {s: f["ps"] for s, f in fund.items() if (f.get("ps") or 0) > 0}
    eve = {s: f["evE"] for s, f in fund.items() if (f.get("evE") or 0) > 0}
    ps_p, eve_p = pctile(ps), pctile(eve)
    val_p = {}
    for s in set(ps_p) | set(eve_p):
        vs = [p[s] for p in (ps_p, eve_p) if s in p]
        val_p[s] = sum(vs) / len(vs)

    heat, n_hist, n_val = {}, 0, 0
    for s in stocks:
        sym = s["sym"]
        f, h = fund.get(sym), hist.get(sym)
        pos = val = rsi = mom = None
        if f and f.get("px") and f.get("wkHi") and f.get("wkLo") and f["wkHi"] > f["wkLo"]:
            pos = round(clamp((f["px"] - f["wkLo"]) / (f["wkHi"] - f["wkLo"]) * 100))
        if sym in val_p:
            val = round(val_p[sym]); n_val += 1
        if h and h.get("rsi") is not None:
            rsi = round(clamp(h["rsi"])); n_hist += 1
        if h and h.get("ret60") is not None:
            mom = round(clamp(50 + h["ret60"] * 0.8))
        comps = [(pos, W["pos52"]), (val, W["val"]), (rsi, W["rsi"]), (mom, W["mom"])]
        comps = [(sc, w) for sc, w in comps if sc is not None]
        hv = round(sum(sc * w for sc, w in comps) / sum(w for _, w in comps)) if comps else 50
        # h=总分,pos/val/rsi/mom=分项(0-100 或 null),前端详情面板直接展示,分项与总分对齐
        heat[sym] = {"h": hv, "pos": pos, "val": val, "rsi": rsi, "mom": mom}

    OUT.write_text(json.dumps({"generated_at": d.get("generated_at"), "stocks": heat}, ensure_ascii=False), encoding="utf-8")
    hot = sorted(stocks, key=lambda s: -heat[s["sym"]]["h"])[:6]
    cold = sorted([s for s in stocks if heat[s["sym"]]["h"] != 50], key=lambda s: heat[s["sym"]]["h"])[:4]
    print(f"✓ us-heat.json(过热/泡沫度,含分项): {len(heat)} 只 · 估值覆盖 {n_val} · RSI 覆盖 {n_hist}")
    print("  最热(贵/近高点):", [(s["sym"], heat[s["sym"]]["h"]) for s in hot])
    print("  最冷(便宜/破位):", [(s["sym"], heat[s["sym"]]["h"]) for s in cold])


if __name__ == "__main__":
    main()
