"""云端重建过热/泡沫度 → us-heat.json,脱离本地 leslie.db。

热度快照(首页粒子场颜色)原由本地 com.leslie.stock.refresh(读 leslie.db)生成;本地任务停了
就一直旧。本脚本只用云端已有数据在 CI 里重算:
  - price-history-30d.json —— cloud_price_refresh.py 每天刷的 4653 只 × 30 天收盘({closes:{sym:{date:close}}})
  - us-fundamentals.json   —— 52 周高低 + 估值(ps/evE)基准 + 上次 px(慢变量,作参照)
  - us-stocks.json         —— universe

口径与 scripts/build_us_heat.py 完全一致(pos52 .35 / val .30 / rsi .20 / mom .15,按实有信号归一化):
  - px   = 历史最新收盘(新鲜)
  - pos52= px 在 [wkLo,wkHi] 的位置;px 顶破 52 周高/低就 bump(高低本身是慢变量,用提交基准)
  - val  = 提交的 ps/evE 按 px/px旧 缩放后取全市场分位(捕捉价格带来的估值漂移;ps 精确、evE 近似)
  - rsi  = 14 日 RSI(同 build_history_metrics.rsi14)
  - mom  = clamp(50 + 满窗收益×0.8)(同 build_history_metrics 的 ret60 满窗回退)

抓不到 / 历史异常空 → 保留旧 us-heat.json 不覆盖(防一次空抓清掉好数据,同 fetchers/market_calendar)。
纯 stdlib,无第三方依赖(与 cloud_price_refresh.py 一致,CI 不需 uv sync)。

用法: python scripts/cloud_heat_refresh.py [--dry]
"""
from __future__ import annotations
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

PUB = Path(__file__).parent.parent / "web" / "public" / "data"
US = PUB / "us-stocks.json"
FUND = PUB / "us-fundamentals.json"
HIST30 = PUB / "price-history-30d.json"
OUT = PUB / "us-heat.json"
W = {"pos52": 0.35, "val": 0.30, "rsi": 0.20, "mom": 0.15}


def clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def pctile(d: dict) -> dict:
    """{sym: value} → {sym: 0-100 分位}(值越大分位越高)。"""
    items = sorted(d.items(), key=lambda kv: kv[1])
    n = max(1, len(items) - 1)
    return {sym: round(100 * i / n) for i, (sym, _) in enumerate(items)}


def rsi14(closes: list) -> float | None:
    if len(closes) < 15:
        return None
    gains = losses = 0.0
    for i in range(len(closes) - 14, len(closes)):
        d = closes[i] - closes[i - 1]
        gains += max(d, 0.0)
        losses += max(-d, 0.0)
    ag, al = gains / 14, losses / 14
    if al == 0:
        return 100.0 if ag > 0 else 50.0
    return round(100 - 100 / (1 + ag / al), 1)


def main() -> None:
    dry = "--dry" in sys.argv
    stocks = json.load(open(US, encoding="utf-8")).get("stocks", [])
    fund = json.load(open(FUND, encoding="utf-8")).get("stocks", {})
    closes_by = json.load(open(HIST30, encoding="utf-8")).get("closes", {})  # {sym:{date:close}}
    if len(closes_by) < 500:
        print(f"⚠ price-history 仅 {len(closes_by)} 只,疑似异常 → 保留旧 us-heat.json 不覆盖")
        return

    # 每只:升序收盘序列 + 最新 px
    px_new, seqs = {}, {}
    for sym, dc in closes_by.items():
        if not dc:
            continue
        seq = [dc[d] for d in sorted(dc) if dc[d] is not None]
        if seq:
            seqs[sym] = seq
            px_new[sym] = seq[-1]

    # 估值分位:ps/evE 按 px 漂移缩放(px 涨→更贵→更热),再取全市场分位
    ps, eve = {}, {}
    for sym, f in fund.items():
        po = f.get("px")
        r = (px_new[sym] / po) if (sym in px_new and po and po > 0) else 1.0
        if (f.get("ps") or 0) > 0:
            ps[sym] = f["ps"] * r
        if (f.get("evE") or 0) > 0:
            eve[sym] = f["evE"] * r
    ps_p, eve_p = pctile(ps), pctile(eve)
    val_p = {}
    for s in set(ps_p) | set(eve_p):
        vs = [p[s] for p in (ps_p, eve_p) if s in p]
        val_p[s] = sum(vs) / len(vs)

    heat, n_fresh = {}, 0
    for s in stocks:
        sym = s.get("sym")
        if not sym:
            continue
        f = fund.get(sym, {})
        px = px_new.get(sym) or f.get("px")
        seq = seqs.get(sym)
        pos = val = rsi = mom = None
        wk_hi, wk_lo = f.get("wkHi"), f.get("wkLo")
        if px and wk_hi and wk_lo:
            hi, lo = max(wk_hi, px), min(wk_lo, px)  # 顶破 52 周高/低就 bump
            if hi > lo:
                pos = round(clamp((px - lo) / (hi - lo) * 100))
        if sym in val_p:
            val = round(val_p[sym])
        if seq:
            rv = rsi14(seq)
            if rv is not None:
                rsi = round(clamp(rv))
            if len(seq) >= 2 and seq[0] > 0:
                mom = round(clamp(50 + (px / seq[0] - 1) * 100 * 0.8))
        if sym in px_new:
            n_fresh += 1
        comps = [(pos, W["pos52"]), (val, W["val"]), (rsi, W["rsi"]), (mom, W["mom"])]
        comps = [(sc, w) for sc, w in comps if sc is not None]
        hv = round(sum(sc * w for sc, w in comps) / sum(w for _, w in comps)) if comps else 50
        heat[sym] = {"h": hv, "pos": pos, "val": val, "rsi": rsi, "mom": mom}

    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    print(f"✓ us-heat.json(云端重建): {len(heat)} 只 · 新鲜价 {n_fresh} · 估值覆盖 {len(val_p)}")
    hot = sorted(heat, key=lambda k: -heat[k]["h"])[:6]
    print("  最热(贵/近高点):", [(k, heat[k]["h"]) for k in hot])
    if dry:
        print("  [dry] 不写文件")
        return
    # 值无变化(周末/节假日 price-history 没刷)就不写,避免只换时间戳的无谓提交
    try:
        if json.load(open(OUT, encoding="utf-8")).get("stocks", {}) == heat:
            print("  热度值无变化,跳过写入")
            return
    except Exception:
        pass
    OUT.write_text(json.dumps({"generated_at": gen, "stocks": heat}, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
