"""把一个 workflow 的五方判读输出合并进 web/public/data/us-analyses.json。

用法: python scripts/ingest_us_panel.py <workflow_output.json>
  workflow_output.json 形如 {"result":[{sym,panel,chain,divergence}...]}(或直接是数组)。
幂等:同 sym 覆盖更新。附带 us-stocks.json 的 rank/mcap/name/sector。
"""
from __future__ import annotations
import json, sys, datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
US = ROOT / "web" / "public" / "data" / "us-stocks.json"
OUT = ROOT / "web" / "public" / "data" / "us-analyses.json"

VALID_VERDICTS = {
    "buffett": {"伟大生意·合理价买入", "伟大生意·太贵观察", "平庸生意·无宽护城河", "长期不可预测·避开", "价值陷阱·避开"},
    "duan": {"顶级好生意·重仓", "好生意·等合理价", "商业模式一般·不值得", "文化不本分·避开"},
    "serenity": {"high conviction", "worth watching", "crowded but valid", "not a bottleneck"},
    "druckenmiller": {"顺风重仓", "趋势在·标准仓", "逆流·不碰", "趋势已转·砍或空"},
    "sentiment": {"情绪顺风·顺势", "冰点+资金进·反向埋伏", "过热拥挤·见顶警惕", "无情绪无资金·没戏"},
}


def main():
    inp = json.load(open(sys.argv[1], encoding="utf-8"))
    rows = inp.get("result", inp) if isinstance(inp, dict) else inp

    stocks = json.load(open(US, encoding="utf-8"))["stocks"]
    meta = {s["sym"]: (i, s) for i, s in enumerate(stocks)}  # rank, full

    if OUT.exists():
        db = json.load(open(OUT, encoding="utf-8"))
    else:
        db = {"generated_at": None, "stocks": {}}

    added = bad = 0
    for r in rows:
        sym = r.get("sym")
        if not sym or "panel" not in r:
            bad += 1
            continue
        rank, s = meta.get(sym, (None, {}))
        # 轻量校验:五方 verdict 是否在允许集合(不在则标记,便于验证阶段抽查)
        warns = []
        for m, vs in VALID_VERDICTS.items():
            v = r["panel"].get(m, {}).get("verdict")
            if v and v not in vs:
                warns.append(f"{m}:{v}")
        db["stocks"][sym] = {
            "rank": rank,
            "name": s.get("name", ""),
            "mcapB": s.get("mcapB"),
            "sector": s.get("sector", ""),
            "panel": r["panel"],
            "chain": r.get("chain", {}),
            "divergence": r.get("divergence", ""),
            **({"_warns": warns} if warns else {}),
        }
        added += 1

    db["generated_at"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    json.dump(db, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"✓ 入库 {added} 只 (跳过 {bad}) · 累计 {len(db['stocks'])} 只 → us-analyses.json")


if __name__ == "__main__":
    main()
