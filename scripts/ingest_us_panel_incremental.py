"""增量合并美股四方重判(/tmp/us_batch_*.json)进现有全量判读 —— 只更新 batch 内的票,
其余 4600+ 只原样保留,绝不覆盖全量。Serenity 保留现有(本轮未重判)。同步更新:
  us-analyses.json(详情/聚合) · us-panel-summary.json(热力图分数) · us-panels/{sym}.json(逐只详情)
  judgment-p0-us.json(重判票锚价=现价,新鲜度归零) · leslie.db us_panel_history(演化快照,本地不提交)
用于「价格异动重判」子集回写。用法: uv run python scripts/ingest_us_panel_incremental.py
"""
from __future__ import annotations
import glob, json, re, sqlite3, datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
DB = ROOT / "data" / "leslie.db"
ORDER = ["buffett", "duan", "serenity", "druckenmiller", "sentiment"]
SHORT = {"buffett": "b", "duan": "d", "serenity": "s", "druckenmiller": "dr", "sentiment": "se"}
ET = datetime.timezone(datetime.timedelta(hours=-4))
VALID = {
    "buffett": {"伟大生意·合理价买入", "伟大生意·太贵观察", "平庸生意·无宽护城河", "长期不可预测·避开", "价值陷阱·避开"},
    "duan": {"顶级好生意·重仓", "好生意·等合理价", "商业模式一般·不值得", "文化不本分·避开"},
    "druckenmiller": {"顺风重仓", "趋势在·标准仓", "逆流·不碰", "趋势已转·砍或空"},
    "sentiment": {"情绪顺风·顺势", "冰点+资金进·反向埋伏", "过热拥挤·见顶警惕", "无情绪无资金·没戏"},
}


def main():
    an_doc = json.loads((PUB / "us-analyses.json").read_text(encoding="utf-8"))
    sm_doc = json.loads((PUB / "us-panel-summary.json").read_text(encoding="utf-8"))
    analyses = an_doc["stocks"]; summary = sm_doc["stocks"]
    before = len(analyses)

    rows = {}
    for f in sorted(glob.glob("/tmp/us_batch_*.json")):
        try:
            for r in json.load(open(f, encoding="utf-8")):
                p = r.get("panel", {})
                if not r.get("sym") or any(m not in p or p[m].get("verdict") not in VALID[m] for m in VALID):
                    continue
                rows[r["sym"]] = r
        except Exception:
            continue
    print(f"待合并四方重判: {len(rows)} 只")

    todo = {}
    tp = Path("/tmp/us_repanel_final.json")
    if tp.exists():
        todo = {r["sym"]: r for r in json.loads(tp.read_text(encoding="utf-8"))}

    judged_at = datetime.datetime.now(ET).strftime("%Y-%m-%d")
    cx = sqlite3.connect(DB)
    cx.execute("""CREATE TABLE IF NOT EXISTS us_panel_history(
        sym TEXT NOT NULL, judged_at TEXT NOT NULL, scores TEXT, verdicts TEXT,
        PRIMARY KEY(sym, judged_at))""")

    updated = 0
    apdir = PUB / "us-panels"
    for sym, r in rows.items():
        exist = analyses.get(sym, {})
        old_panel = exist.get("panel", {})
        ser = old_panel.get("serenity")  # 保留现有 Serenity(本轮未重判)
        if not ser:
            continue  # 没有旧 Serenity 的跳过,不硬造
        panel = {**r["panel"], "serenity": ser}
        scores = []
        for k in ORDER:
            v = panel.get(k, {})
            try:
                scores.append(round(float(v.get("score")), 1))
            except (TypeError, ValueError):
                scores.append(None)
        nums = [x for x in scores if x is not None]
        div = round(max(nums) - min(nums)) if len(nums) >= 2 else 0
        div_txt = r.get("divergence", exist.get("divergence", ""))
        ss = ser.get("score")
        if ss is not None and div_txt:
            div_txt = re.sub(r"(Serenity[^0-9]{0,8})\d{1,3}", lambda mt: mt.group(1) + str(round(ss)), div_txt, count=1)
        analyses[sym] = {**exist, "panel": panel, "divergence": div_txt, "judged_at": judged_at}
        summary[sym] = {"sc": scores, "div": div}
        # 逐只 us-panels:保留 rank/name/mcapB/sector/chain,只换 panel + divergence
        pf = apdir / f"{sym}.json"
        if pf.exists():
            full = json.loads(pf.read_text(encoding="utf-8"))
        else:
            full = {"rank": exist.get("rank"), "name": exist.get("name", sym),
                    "mcapB": exist.get("mcapB"), "sector": exist.get("sector", ""), "chain": {}}
        full["panel"] = panel; full["divergence"] = div_txt
        pf.write_text(json.dumps(full, ensure_ascii=False), encoding="utf-8")
        # 历史快照(演化曲线)
        sc_map = {SHORT[k]: scores[ORDER.index(k)] for k in ORDER}
        vd_map = {SHORT[k]: panel.get(k, {}).get("verdict", "") for k in ORDER}
        cx.execute("INSERT OR REPLACE INTO us_panel_history VALUES(?,?,?,?)",
                   (sym, judged_at, json.dumps(sc_map, ensure_ascii=False), json.dumps(vd_map, ensure_ascii=False)))
        updated += 1
    cx.commit(); cx.close()

    assert len(analyses) >= before, f"全量被截断! {before}→{len(analyses)}"  # 安全闸
    an_doc["stocks"] = analyses
    an_doc["generated_at"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    (PUB / "us-analyses.json").write_text(json.dumps(an_doc, ensure_ascii=False), encoding="utf-8")
    (PUB / "us-panel-summary.json").write_text(json.dumps(sm_doc, ensure_ascii=False), encoding="utf-8")

    # 重判票 p0 锚价刷成现价 → 新鲜度归零(重判=新起点)
    p0doc = json.loads((PUB / "judgment-p0-us.json").read_text(encoding="utf-8"))
    p0 = p0doc["p0"]; bumped = 0
    for sym in rows:
        cur = (todo.get(sym) or {}).get("cur")
        if cur:
            p0[sym] = round(float(cur), 2); bumped += 1
    (PUB / "judgment-p0-us.json").write_text(json.dumps(p0doc, ensure_ascii=False), encoding="utf-8")

    print(f"✅ 增量更新 {updated} 只 | 全量保留 {len(analyses)} 只(改前 {before}) | p0 锚价刷新 {bumped} 只")


if __name__ == "__main__":
    main()
