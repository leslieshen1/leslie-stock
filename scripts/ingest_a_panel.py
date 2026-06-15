"""把 A 股四方判读(/tmp/a_batch_*.json)+ 现有 Serenity(manifest)合并成五方,
输出 a-analyses.json(详情页用)+ a-panel-summary.json(热力图/分数用,镜像 us-panel-summary)。
用法: uv run python scripts/ingest_a_panel.py
"""
from __future__ import annotations
import glob, json
from pathlib import Path

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
MAN = PUB / "aleabit_manifest.json"
ORDER = ["buffett", "duan", "serenity", "druckenmiller", "sentiment"]
SHORT = {"buffett": "b", "duan": "d", "serenity": "s", "druckenmiller": "dr", "sentiment": "se"}

VALID = {
    "buffett": {"伟大生意·合理价买入", "伟大生意·太贵观察", "平庸生意·无宽护城河", "长期不可预测·避开", "价值陷阱·避开"},
    "duan": {"顶级好生意·重仓", "好生意·等合理价", "商业模式一般·不值得", "文化不本分·避开"},
    "druckenmiller": {"顺风重仓", "趋势在·标准仓", "逆流·不碰", "趋势已转·砍或空"},
    "sentiment": {"情绪顺风·顺势", "冰点+资金进·反向埋伏", "过热拥挤·见顶警惕", "无情绪无资金·没戏"},
}


def serenity_master(score, verdict_label: str, thesis: str) -> dict:
    """现有 A 股 Serenity(瓶颈分)→ 统一面板格式(verdict 按分映射 US 词表)。"""
    s = score if isinstance(score, (int, float)) else None
    if s is None:
        verdict = "not a bottleneck"
    elif s >= 75:
        verdict = "high conviction"
    elif s >= 55:
        verdict = "worth watching"
    elif s >= 40:
        verdict = "crowded but valid"
    else:
        verdict = "not a bottleneck"
    return {"verdict": verdict, "score": s if s is not None else 0,
            "judgment": (verdict_label or "")[:120], "reasoning": (thesis or "")[:300]}


SER_VALID = {"high conviction", "worth watching", "crowded but valid", "not a bottleneck"}


def main():
    man = {x["code"]: x for x in json.loads(MAN.read_text(encoding="utf-8"))}
    rows = {}
    for f in sorted(glob.glob("/tmp/a_batch_*.json")):
        try:
            for r in json.load(open(f, encoding="utf-8")):
                p = r.get("panel", {})
                if not r.get("code") or any(m not in p or p[m].get("verdict") not in VALID[m] for m in VALID):
                    continue
                rows[r["code"]] = r              # 后批覆盖(去重)
        except Exception:
            continue
    print(f"四方有效判读: {len(rows)} 只")

    # Serenity 用她的思维重判(aser_*.json);没有的退回 manifest 映射
    aser = {}
    for f in sorted(glob.glob("/tmp/aser_*.json")):
        try:
            for r in json.load(open(f, encoding="utf-8")):
                s = r.get("serenity") or {}
                if r.get("code") and s.get("verdict") in SER_VALID:
                    aser[r["code"]] = s
        except Exception:
            continue
    print(f"Serenity 重判: {len(aser)} 只")

    analyses, summary = {}, {}
    for code, r in rows.items():
        m = man.get(code, {})
        ser = aser.get(code) or serenity_master(m.get("score"), m.get("verdict_label", ""), m.get("thesis", ""))
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
        analyses[code] = {"name": m.get("name", code), "cap": m.get("market_cap_yi"),
                          "sector": m.get("sector", ""), "layer": m.get("layer"),
                          "concepts": (m.get("concepts") or [])[:8],
                          "panel": panel, "divergence": r.get("divergence", "")}
        summary[code] = {"sc": scores, "div": div}

    (PUB / "a-analyses.json").write_text(
        json.dumps({"order": ORDER, "stocks": analyses}, ensure_ascii=False), encoding="utf-8")
    (PUB / "a-panel-summary.json").write_text(
        json.dumps({"order": ORDER, "stocks": summary}, ensure_ascii=False), encoding="utf-8")
    # 逐 code 拆分(详情页按需读一只)—— 字段对齐 us-panels/,让 A 股详情页与美股完全同构
    import re
    NOISE = {"上证50", "沪深300", "中证500", "中证100", "创业板", "科创板", "科创50", "权重股",
             "大盘股", "中盘股", "小盘股", "百元股", "周期股", "蓝筹股", "MSCI概念", "富时罗素"}
    def clean_role(thesis: str) -> str:
        # 去掉提到瓶颈/aleabit 框架的噪声句(对非瓶颈股,thesis 常以"与瓶颈狙击框架无关"结尾)
        segs = [s for s in re.split(r"[,，。；]", thesis or "")
                if s.strip() and not re.search(r"瓶颈|aleabit|狙击|框架|领域", s)]
        return "，".join(segs).strip()
    apdir = PUB / "a-panels"
    apdir.mkdir(exist_ok=True)
    for code, a in analyses.items():
        # A 股 concepts 是题材标签不是 GICS 行业(比亚迪标"无线充电"会误导),不当行业用;
        # 业务身份交给画像一句话(role)。chain.industry 留空。
        chain = {"industry": "", "layer": "",
                 "role": clean_role((a["panel"].get("serenity", {}) or {}).get("reasoning", "")),
                 "upstream": [], "downstream": []}
        apdir.joinpath(f"{code}.json").write_text(json.dumps(
            {"name": a["name"], "mcapB": None, "mcapYi": a["cap"], "sector": "",
             "panel": a["panel"], "chain": chain, "divergence": a["divergence"]},
            ensure_ascii=False), encoding="utf-8")
    print(f"✅ a-analyses.json + a-panel-summary.json + a-panels/{len(analyses)} — {len(analyses)} 只 A 股五方")
    # 抽样
    for code in list(analyses)[:5]:
        a = analyses[code]
        sc = summary[code]["sc"]
        print(f"   {code} {a['name'][:6]:6s} 五方={sc} 分歧={summary[code]['div']}")


if __name__ == "__main__":
    main()
