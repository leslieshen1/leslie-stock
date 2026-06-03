"""热力图真分源:把 US 五方(us-panel-summary)+ A股 Serenity(aleabit_manifest)
合成一个 byKey-就绪的 pulse-scores.json,给热力图镜头上色用,取代 mock 评分。

- US: 直接用 us-panel-summary 的 5 方分(sc 按 order)。
- A股: manifest 的 score 是 Serenity 瓶颈分 → 放到 sc 的 serenity 位,其余方 null。
  (A股暂无 巴菲特/段永平/德鲁肯米勒/情绪 的判读,这些镜头下自然灰显。)

输出 web/public/data/pulse-scores.json = {order, stocks:{tickerOrCode:{sc,div}}}。
page.tsx 会按热力图节点裁剪后再传给前端(payload 不膨胀)。

用法: python scripts/build_pulse_scores.py
"""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
USM = PUB / "us-panel-summary.json"
MAN = PUB / "aleabit_manifest.json"
OUT = PUB / "pulse-scores.json"


def main():
    usm = json.load(open(USM, encoding="utf-8"))
    order = usm["order"]
    si = order.index("serenity")
    # 分析数据的生成时间(热力图徽章用 = 真正驱动上色的数据何时判读)
    try:
        analyzed_at = json.load(open(USM.parent / "us-analyses.json", encoding="utf-8")).get("generated_at")
    except Exception:
        analyzed_at = None

    stocks: dict = dict(usm["stocks"])  # US 五方
    us_n = len(stocks)

    man = json.load(open(MAN, encoding="utf-8"))
    rows = man if isinstance(man, list) else man.get("items", [])
    a_n = 0
    for e in rows:
        code = e.get("code")
        score = e.get("score")
        if not code or score is None or code in stocks:
            continue
        sc = [None] * len(order)
        sc[si] = score
        stocks[code] = {"sc": sc, "div": 0}
        a_n += 1

    OUT.write_text(json.dumps({"order": order, "generated_at": analyzed_at, "stocks": stocks}, ensure_ascii=False), encoding="utf-8")
    print(f"✓ pulse-scores.json: US 五方 {us_n} + A股 Serenity {a_n} = {len(stocks)} · 判读于 {analyzed_at}")


if __name__ == "__main__":
    main()
