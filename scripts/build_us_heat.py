"""从 us-stocks.json(6000+ 美股实时行情)算短期热度 → us-heat.json。

短期热度 = 今日涨跌幅(方向+幅度,主)× 0.72 + 换手率分位(资金关注度)× 0.28
  - pctScore: 50 + pct%×3.3,clamp 2-99(+15%→满,-15%→冰点)—— 标准日内市场热力图口径
  - churn = 成交额 / 市值(今日换手占市值比),全市场分位 → 0-100
热度色阶:0=深价值(冷) → 100=过热警告。涨得猛+放量 = 热(红/品红),杀跌 = 冷(紫)。

替代旧的 7 天前、只有 119 只的 yfinance 快照。覆盖全部美股,数据随 us-stocks 一起新鲜。

用法: python scripts/build_us_heat.py
"""
from __future__ import annotations
import bisect, json
from pathlib import Path

ROOT = Path(__file__).parent.parent
US = ROOT / "web" / "public" / "data" / "us-stocks.json"
OUT = ROOT / "web" / "public" / "data" / "us-heat.json"


def pct_score(pct) -> float:
    return max(2.0, min(99.0, 50 + (pct or 0) * 3.3))


def main():
    d = json.load(open(US, encoding="utf-8"))
    stocks = d.get("stocks", d)

    # 换手率 = 成交额 / 市值
    churns = []
    for s in stocks:
        vol = s.get("vol") or 0
        price = s.get("price") or 0
        mcapB = s.get("mcapB") or 0
        c = (vol * price) / (mcapB * 1e9) if mcapB > 0 else 0
        s["_churn"] = c
        churns.append(c)
    srt = sorted(churns)
    n = max(1, len(srt) - 1)

    def churn_score(c):
        return bisect.bisect_left(srt, c) / n * 100

    heat = {}
    for s in stocks:
        ps = pct_score(s.get("pct"))
        cs = churn_score(s["_churn"])
        heat[s["sym"]] = round(0.72 * ps + 0.28 * cs)

    OUT.write_text(json.dumps({"generated_at": d.get("generated_at"), "stocks": heat}, ensure_ascii=False), encoding="utf-8")
    # 抽样
    hot = sorted(stocks, key=lambda s: -heat[s["sym"]])[:5]
    cold = sorted(stocks, key=lambda s: heat[s["sym"]])[:3]
    print(f"✓ us-heat.json: {len(heat)} 只 · 行情 {d.get('generated_at')}")
    print("  最热:", [(s["sym"], heat[s["sym"]], str(s.get("pct")) + "%") for s in hot])
    print("  最冷:", [(s["sym"], heat[s["sym"]], str(s.get("pct")) + "%") for s in cold])


if __name__ == "__main__":
    main()
