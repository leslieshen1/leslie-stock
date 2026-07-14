"""增量合并 A 股四方重判(/tmp/a_batch_*.json)进现有全量判读 —— 只更新 batch 内的票,
其余 3000+ 只原样保留。用于「价格异动重判」子集回写,绝不覆盖全量。
Serenity 保留现有(未重判);同步更新 judgment-p0-a.json 里这批的锚价=现价(新鲜度归零)。
用法: uv run python scripts/ingest_a_panel_incremental.py
"""
from __future__ import annotations
import glob, json, re
from pathlib import Path

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
ORDER = ["buffett", "duan", "serenity", "druckenmiller", "sentiment"]
VALID = {
    "buffett": {"伟大生意·合理价买入", "伟大生意·太贵观察", "平庸生意·无宽护城河", "长期不可预测·避开", "价值陷阱·避开"},
    "duan": {"顶级好生意·重仓", "好生意·等合理价", "商业模式一般·不值得", "文化不本分·避开"},
    "druckenmiller": {"顺风重仓", "趋势在·标准仓", "逆流·不碰", "趋势已转·砍或空"},
    "sentiment": {"情绪顺风·顺势", "冰点+资金进·反向埋伏", "过热拥挤·见顶警惕", "无情绪无资金·没戏"},
}


def main():
    # 现有全量(绝对不能丢)
    an_doc = json.loads((PUB / "a-analyses.json").read_text(encoding="utf-8"))
    sm_doc = json.loads((PUB / "a-panel-summary.json").read_text(encoding="utf-8"))
    analyses = an_doc["stocks"]; summary = sm_doc["stocks"]
    before = len(analyses)

    # 新四方判读(仅 batch 内)
    rows = {}
    for f in sorted(glob.glob("/tmp/a_batch_*.json")):
        try:
            for r in json.load(open(f, encoding="utf-8")):
                p = r.get("panel", {})
                if not r.get("code") or any(m not in p or p[m].get("verdict") not in VALID[m] for m in VALID):
                    continue
                rows[r["code"]] = r
        except Exception:
            continue
    print(f"待合并四方重判: {len(rows)} 只")

    # 重判涨跌(更新 p0 锚价用)
    todo = {}
    tp = Path("/tmp/a_repanel_todo.json")
    if tp.exists():
        todo = {r["code"]: r for r in json.loads(tp.read_text(encoding="utf-8"))}

    updated = 0
    apdir = PUB / "a-panels"
    for code, r in rows.items():
        exist = analyses.get(code, {})
        old_panel = exist.get("panel", {})
        ser = old_panel.get("serenity")  # 保留现有 Serenity(本轮未重判)
        if not ser:
            continue  # 没有旧 Serenity 的跳过,不硬造(增量只碰有存量的)
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
        # analyses/summary 就地更新这一只,其余保留
        analyses[code] = {**exist, "panel": panel, "divergence": div_txt}
        summary[code] = {"sc": scores, "div": div}
        # 逐只 a-panels:保留 chain/name/mcap 等,只换 panel + divergence
        pf = apdir / f"{code}.json"
        full = json.loads(pf.read_text(encoding="utf-8")) if pf.exists() else {"name": exist.get("name", code), "mcapYi": exist.get("cap")}
        full["panel"] = panel; full["divergence"] = div_txt
        pf.write_text(json.dumps(full, ensure_ascii=False), encoding="utf-8")
        updated += 1

    assert len(analyses) >= before, f"全量被截断! {before}→{len(analyses)}"  # 安全闸
    (PUB / "a-analyses.json").write_text(json.dumps({"order": ORDER, "stocks": analyses}, ensure_ascii=False), encoding="utf-8")
    (PUB / "a-panel-summary.json").write_text(json.dumps({"order": ORDER, "stocks": summary}, ensure_ascii=False), encoding="utf-8")

    # 更新 p0 锚价:这批刷成现价 → 新鲜度归零(重判=新起点)
    p0doc = json.loads((PUB / "judgment-p0-a.json").read_text(encoding="utf-8"))
    p0 = p0doc["p0"]; bumped = 0
    for code in rows:
        cur = (todo.get(code) or {}).get("cur")
        if cur:
            p0[code] = round(float(cur), 2); bumped += 1
    (PUB / "judgment-p0-a.json").write_text(json.dumps(p0doc, ensure_ascii=False), encoding="utf-8")

    print(f"✅ 增量更新 {updated} 只 | 全量保留 {len(analyses)} 只(改前 {before}) | p0 锚价刷新 {bumped} 只")


if __name__ == "__main__":
    main()
