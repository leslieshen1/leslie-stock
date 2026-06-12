"""导出云端对决引擎的行情输入 → web/public/data/price-history-30d.json。

跑在本地每日 refresh(17:00 ET 闭市后)里,随 refresh 的 git 提交上库:
  { "dates": [近30个交易日...], "closes": { sym: {date: close, ...} } }
范围 = 已判读(us-analyses)∪ 当前对决持仓 —— 云引擎用它算动量(Druck 20日)、
持有天数(情绪面 ≤5 日)和"最新交易日"(= dates[-1],兼当数据新鲜度信号)。
"""
from __future__ import annotations
import json, sqlite3
from pathlib import Path

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
DB = ROOT / "data" / "leslie.db"
OUT = PUB / "price-history-30d.json"
STATE = ROOT / "data" / "arena-state.json"


def main():
    syms = set()
    try:
        syms |= set(json.loads((PUB / "us-analyses.json").read_text(encoding="utf-8"))["stocks"].keys())
    except Exception:
        pass
    try:
        st = json.loads(STATE.read_text(encoding="utf-8"))
        syms |= {p["sym"] for p in st.get("positions", [])}
    except Exception:
        pass
    if not syms:
        print("⚠ 无候选 sym,跳过")
        return

    cx = sqlite3.connect(DB, timeout=60)
    dates = [r[0] for r in cx.execute(
        "SELECT DISTINCT date FROM price_history ORDER BY date DESC LIMIT 30")][::-1]
    if not dates:
        print("⚠ price_history 为空,跳过")
        return
    lo = dates[0]
    closes: dict[str, dict[str, float]] = {}
    q = cx.execute(
        f"SELECT sym, date, close FROM price_history WHERE date>=? AND sym IN ({','.join('?'*len(syms))})",
        [lo, *syms])
    for sym, d, c in q:
        if c is not None:
            closes.setdefault(sym, {})[d] = round(c, 4)
    cx.close()
    OUT.write_text(json.dumps({"dates": dates, "closes": closes}, ensure_ascii=False), encoding="utf-8")
    kb = OUT.stat().st_size // 1024
    print(f"✓ price-history-30d.json: {len(closes)} 只 × {len(dates)} 日({dates[0]}..{dates[-1]}) · {kb} KB")


if __name__ == "__main__":
    main()
