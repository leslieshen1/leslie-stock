"""把一个 workflow 的五方判读输出合并进 web/public/data/us-analyses.json。

用法: python scripts/ingest_us_panel.py <workflow_output.json>
  workflow_output.json 形如 {"result":[{sym,panel,chain,divergence}...]}(或直接是数组)。
幂等:同 sym 覆盖更新。附带 us-stocks.json 的 rank/mcap/name/sector。

评分时间线(2026-06-12 起):每只入库时打 judged_at(ET 日期)戳,并往 leslie.db 的
us_panel_history 追加一条快照(五分+五判决)。重判同一只票 = 多条历史 → 未来可画
"巴菲特对它 62→75" 的演化曲线。(ingest_one_master 的单股神合并不写历史,只算补缺。)
"""
from __future__ import annotations
import json, sqlite3, sys, datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
US = ROOT / "web" / "public" / "data" / "us-stocks.json"
OUT = ROOT / "web" / "public" / "data" / "us-analyses.json"
DB = ROOT / "data" / "leslie.db"
ET = datetime.timezone(datetime.timedelta(hours=-4))
MASTER_SHORT = {"buffett": "b", "duan": "d", "serenity": "s", "druckenmiller": "dr", "sentiment": "se"}


def history_snapshot(cx: sqlite3.Connection, sym: str, panel: dict, judged_at: str) -> None:
    scores, verdicts = {}, {}
    for mk, short in MASTER_SHORT.items():
        v = panel.get(mk) or {}
        try:
            scores[short] = round(float(v.get("score")), 1)
        except (TypeError, ValueError):
            scores[short] = None
        verdicts[short] = v.get("verdict") or ""
    cx.execute("INSERT OR REPLACE INTO us_panel_history VALUES(?,?,?,?)",
               (sym, judged_at, json.dumps(scores, ensure_ascii=False), json.dumps(verdicts, ensure_ascii=False)))

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

    judged_at = datetime.datetime.now(ET).strftime("%Y-%m-%d")
    cx = sqlite3.connect(DB)
    cx.execute("""CREATE TABLE IF NOT EXISTS us_panel_history(
        sym TEXT NOT NULL, judged_at TEXT NOT NULL, scores TEXT, verdicts TEXT,
        PRIMARY KEY(sym, judged_at))""")

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
            "judged_at": judged_at,
            **({"_warns": warns} if warns else {}),
        }
        history_snapshot(cx, sym, r["panel"], judged_at)
        added += 1

    cx.commit()
    cx.close()
    db["generated_at"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    json.dump(db, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"✓ 入库 {added} 只 (跳过 {bad}) · 累计 {len(db['stocks'])} 只 → us-analyses.json · 历史快照 @{judged_at}")


if __name__ == "__main__":
    main()
