"""把"单股神补跑"的输出 merge 进 us-analyses.json 的每只票 panel(append 一个 key,不动别人)。

用法: python scripts/ingest_one_master.py <workflow_output.json> <masterKey>
  输出形如 {"result":[{sym,verdict,score,judgment,reasoning}...]}(或直接数组)。
  对每条: stocks[sym].panel[masterKey] = {verdict,score,judgment,reasoning}。
  然后重写受影响的 us-panels/{sym}.json(详情页读这些)。
幂等:同 sym+master 覆盖更新。stock 不在库里则跳过(单股神补跑只针对已有 panel 的票)。
"""
from __future__ import annotations
import json, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
DB = ROOT / "web" / "public" / "data" / "us-analyses.json"
PANELS = ROOT / "web" / "public" / "data" / "us-panels"


def main():
    out_path, key = sys.argv[1], sys.argv[2]
    inp = json.load(open(out_path, encoding="utf-8"))
    rows = inp.get("result", inp) if isinstance(inp, dict) else inp

    db = json.load(open(DB, encoding="utf-8"))
    stocks = db["stocks"]

    merged = skipped = 0
    touched = []
    for r in rows:
        sym = r.get("sym")
        if not sym or "verdict" not in r:
            skipped += 1
            continue
        if sym not in stocks:
            skipped += 1            # 单股神补跑只针对已有 panel 的票
            continue
        stocks[sym].setdefault("panel", {})[key] = {
            "verdict": r["verdict"],
            "score": r.get("score"),
            "judgment": r.get("judgment", ""),
            "reasoning": r.get("reasoning", ""),
        }
        merged += 1
        touched.append(sym)

    json.dump(db, open(DB, "w", encoding="utf-8"), ensure_ascii=False)
    # 重写受影响的单股文件
    PANELS.mkdir(parents=True, exist_ok=True)
    for sym in touched:
        json.dump(stocks[sym], open(PANELS / f"{sym}.json", "w"), ensure_ascii=False)

    print(f"✓ merge 股神 [{key}]: {merged} 只 append (跳过 {skipped}) · 重写 {len(touched)} 个单股文件")


if __name__ == "__main__":
    main()
