"""自动刷新已覆盖股票的五方判读。

每周扫描两类过期信号:
1. 最近 LOOKBACK 个交易日出现大幅异动;
2. 现价相对该股上次判读锚点出现显著偏离。

刷新成功后同步 analyses、panel-summary、judgment-p0、pulse-scores 和美股
blurbs，确保详情页、扫描页、热力图和观察列表使用同一版判读。

主要环境变量:
  AUTOJUDGE_THRESH_US/A       周异动阈值，默认 8/10
  AUTOJUDGE_DRIFT_US/A        判读后偏离阈值，默认 15/20
  AUTOJUDGE_CAP_US/A          单次刷新上限，默认 15/10
  AUTOJUDGE_WORKERS           并发数，默认 4
  AUTOJUDGE_DRY=1             只列候选，不调用 LLM、不写文件
"""
from __future__ import annotations

import datetime
import json
import math
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUB = ROOT / "web" / "public" / "data"
sys.path.insert(0, str(ROOT / "scripts"))

THRESH_US = float(os.environ.get("AUTOJUDGE_THRESH_US", "8"))
THRESH_A = float(os.environ.get("AUTOJUDGE_THRESH_A", "10"))
DRIFT_US = float(os.environ.get("AUTOJUDGE_DRIFT_US", "15"))
DRIFT_A = float(os.environ.get("AUTOJUDGE_DRIFT_A", "20"))
CAP_US = int(os.environ.get("AUTOJUDGE_CAP_US", "15"))
CAP_A = int(os.environ.get("AUTOJUDGE_CAP_A", "10"))
LOOKBACK = int(os.environ.get("AUTOJUDGE_LOOKBACK", "5"))
CEIL_US = float(os.environ.get("AUTOJUDGE_CEIL_US", "60"))
CEIL_A = float(os.environ.get("AUTOJUDGE_CEIL_A", "35"))
DRIFT_CEIL_US = float(os.environ.get("AUTOJUDGE_DRIFT_CEIL_US", "200"))
DRIFT_CEIL_A = float(os.environ.get("AUTOJUDGE_DRIFT_CEIL_A", "80"))
MIN_MCAP_US = float(os.environ.get("AUTOJUDGE_MIN_MCAP_US", "2"))
MIN_MCAP_A = float(os.environ.get("AUTOJUDGE_MIN_MCAP_A", "100"))
COOLDOWN_DAYS = int(os.environ.get("AUTOJUDGE_COOLDOWN_DAYS", "7"))
WORKERS = max(1, int(os.environ.get("AUTOJUDGE_WORKERS", "4")))
DRY = os.environ.get("AUTOJUDGE_DRY", "") == "1"
TODAY = datetime.date.today().isoformat()
NOW = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
MASTERS = ("buffett", "duan", "serenity", "druckenmiller", "sentiment")

VALID = {
    "buffett": {"伟大生意·合理价买入", "伟大生意·太贵观察", "平庸生意·无宽护城河", "长期不可预测·避开", "价值陷阱·避开"},
    "duan": {"顶级好生意·重仓", "好生意·等合理价", "商业模式一般·不值得", "文化不本分·避开"},
    "serenity": {"high conviction", "worth watching", "crowded but valid", "not a bottleneck"},
    "druckenmiller": {"顺风重仓", "趋势在·标准仓", "逆流·不碰", "趋势已转·砍或空"},
    "sentiment": {"情绪顺风·顺势", "冰点+资金进·反向埋伏", "过热拥挤·见顶警惕", "无情绪无资金·没戏"},
}

DNA = """你在为产品「我不是股神 · Not a Stock God」刷新五位投资大师对一只股票的判读。全部用中文。目标是解释公司与当前阶段，不荐股、不写目标价，不因为短期涨跌机械改判。必须结合最新价格变化重新检查旧结论；如果商业事实没有变化，也可以保留原判，但理由必须更新。绝不注水，绝不五人同调。

五位大师(每位:0-100 分 + 精确 verdict + judgment 一句话 + reasoning 两三句):
- buffett 巴菲特:买公司不买股票,要宽护城河 + 安全边际 + 能力圈内。verdict ∈ {"伟大生意·合理价买入","伟大生意·太贵观察","平庸生意·无宽护城河","长期不可预测·避开","价值陷阱·避开"}
- duan 段永平:看商业模式 + 本分文化,看懂了贵一点也敢重仓,不碰看不懂的和题材投机。verdict ∈ {"顶级好生意·重仓","好生意·等合理价","商业模式一般·不值得","文化不本分·避开"}
- serenity 卡脖子狙击手:只看产业链里不可替代的瓶颈环节,明牌拥挤的票即使逻辑对也降低确信度。verdict ∈ {"high conviction","worth watching","crowded but valid","not a bottleneck"}
- druckenmiller 德鲁肯米勒:自上而下看宏观趋势 + 动量,趋势转了就退出。verdict ∈ {"顺风重仓","趋势在·标准仓","逆流·不碰","趋势已转·砍或空"}
- sentiment 情绪面:看资金、拥挤度和情绪周期。verdict ∈ {"情绪顺风·顺势","冰点+资金进·反向埋伏","过热拥挤·见顶警惕","无情绪无资金·没戏"}

分数必须与 verdict 一致(伟大生意·合理价买入→75+;价值陷阱·避开→<35;not a bottleneck→<45;顶级好生意·重仓→78+;过热拥挤·见顶警惕→<50)。价格变化只是重审触发器，不是公司质量证据。五人之间要有真实分歧。"""


def load(path: Path, default=None):
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def write(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def history_values(closes_for_sym) -> list[float]:
    if not isinstance(closes_for_sym, dict):
        return []
    return [
        float(v)
        for _, v in sorted(closes_for_sym.items())
        if isinstance(v, (int, float)) and v > 0
    ]


def period_move(closes_for_sym, sessions: int) -> float | None:
    values = history_values(closes_for_sym)
    if len(values) < 2:
        return None
    ref = values[-(sessions + 1)] if len(values) > sessions else values[0]
    return (values[-1] / ref - 1) * 100 if ref else None


def latest_price(closes_for_sym) -> float | None:
    values = history_values(closes_for_sym)
    return values[-1] if values else None


def price_move(current: float | None, anchor: float | None) -> float | None:
    if current is None or not isinstance(anchor, (int, float)) or anchor <= 0:
        return None
    return (current / anchor - 1) * 100


def recently_refreshed(rec: dict) -> bool:
    raw = rec.get("_refreshed_at") or rec.get("judged_at")
    if not raw:
        return False
    try:
        day = datetime.date.fromisoformat(str(raw)[:10])
        return (datetime.date.today() - day).days < COOLDOWN_DAYS
    except ValueError:
        return False


def recent_news(code: str, limit: int = 5) -> list[str]:
    arr = load(PUB / "us-news" / f"{code.upper()}.json", [])
    if not arr:
        aggregate = load(PUB / "us-news.json", {}) or {}
        arr = (aggregate.get("stocks") or {}).get(code.upper(), [])
    if isinstance(arr, dict):
        arr = arr.get("items", [])
    if not isinstance(arr, list):
        return []
    out = []
    for item in arr:
        if isinstance(item, dict) and item.get("title"):
            title = re.sub(r"\s*-\s*[^-]+$", "", item["title"]).strip()
            out.append(title)
    return out[:limit]


def parse_json(text: str | None):
    if not text:
        return None
    text = re.sub(r"^```(?:json)?", "", text.strip()).strip()
    text = re.sub(r"```$", "", text).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        return None
    try:
        return json.loads(text[start:end + 1])
    except Exception:
        return None


def valid_panel(panel) -> bool:
    if not isinstance(panel, dict):
        return False
    for master in MASTERS:
        stance = panel.get(master)
        if not isinstance(stance, dict) or stance.get("verdict") not in VALID[master]:
            return False
        score = stance.get("score")
        if not isinstance(score, (int, float)) or not 0 <= score <= 100:
            return False
    return True


def pick(analyses, history, p0_doc, weekly_thresh, weekly_ceil, drift_thresh,
         drift_ceil, min_mcap, cap, market):
    """按周异动或判读后偏离挑候选，并适度提高大市值公司的优先级。"""
    anchors = (p0_doc or {}).get("p0", {})
    candidates = []
    for raw_code, rec in analyses.get("stocks", {}).items():
        code = str(raw_code).upper()
        name = rec.get("name", "")
        if market == "a" and re.match(r"\*?ST", name):
            continue
        mcap = rec.get("mcapB") if market == "us" else (rec.get("cap") or rec.get("mcapYi"))
        if not isinstance(mcap, (int, float)) or mcap < min_mcap:
            continue

        series = history.get(raw_code) or history.get(code)
        current = latest_price(series)
        weekly = period_move(series, LOOKBACK)
        anchor = anchors.get(raw_code, anchors.get(code))
        drift = price_move(current, anchor)

        weekly_signal = weekly is not None and weekly_thresh <= abs(weekly) <= weekly_ceil
        drift_signal = drift is not None and drift_thresh <= abs(drift) <= drift_ceil
        if not weekly_signal and not drift_signal:
            continue
        if recently_refreshed(rec) and not weekly_signal:
            continue

        weekly_strength = abs(weekly) / weekly_thresh if weekly_signal else 0
        drift_strength = abs(drift) / drift_thresh if drift_signal else 0
        size_weight = 1 + min(0.45, math.log10(max(mcap / min_mcap, 1)) * 0.12)
        priority = max(weekly_strength, drift_strength) * size_weight
        reasons = []
        if weekly_signal:
            reasons.append("周异动")
        if drift_signal:
            reasons.append("判读已漂移")
        candidates.append({
            "code": code,
            "weekly": weekly,
            "drift": drift,
            "current": current,
            "anchor": anchor,
            "priority": priority,
            "reason": "+".join(reasons),
        })
    candidates.sort(key=lambda item: (-item["priority"], -abs(item["drift"] or 0), item["code"]))
    return candidates[:cap]


def fmt_pct(value: float | None) -> str:
    return "暂无" if value is None else f"{value:+.1f}%"


def build_prompt(candidate, rec, news, market, anchor_date):
    code = candidate["code"]
    context = {
        "代码": code,
        "名称": rec.get("name", code),
        "市场": market.upper(),
        "板块": rec.get("sector", ""),
        "当前参考价": candidate["current"],
        "上次判读锚点价": candidate["anchor"],
        "锚点起始日期": anchor_date or "各股最近一次刷新日",
        "判读以来涨跌": fmt_pct(candidate["drift"]),
        f"近{LOOKBACK}个交易日涨跌": fmt_pct(candidate["weekly"]),
        "触发刷新原因": candidate["reason"],
        "市值": rec.get("mcapB") if market == "us" else (rec.get("cap") or rec.get("mcapYi")),
        "产业链": rec.get("chain", {}),
        "公司简介": rec.get("desc", ""),
        "近期新闻标题": news or "(暂无可用新闻源，不得自行编造新闻)",
        "上次完整判读": rec.get("panel") or {},
        "上次分歧": rec.get("divergence", ""),
    }
    return (
        f"{DNA}\n\n请对下面这只股票做一次“旧分析复核”。先判断变化来自公司基本面、产业趋势、"
        f"估值/价格位置还是纯情绪，再更新五方判读。不要写目标价，不要给买卖指令，不要编造未提供的事件。\n"
        f"{json.dumps(context, ensure_ascii=False, indent=1)}\n\n"
        "只返回一个 JSON 对象，不要解释或 markdown。格式:\n"
        '{"panel":{"buffett":{"verdict":"…","score":0,"judgment":"…","reasoning":"…"},'
        '"duan":{…},"serenity":{…},"druckenmiller":{…},"sentiment":{…}},'
        '"divergence":"一句话点出五人分歧"}\n'
        "verdict 必须使用上方精确枚举，score 为 0-100 数字。"
    )


def refresh(candidates, analyses, market, anchor_date):
    if DRY:
        lines = []
        for item in candidates:
            rec = analyses["stocks"].get(item["code"], {})
            lines.append(
                f"  [DRY] {market} {item['code']} {rec.get('name', '')} · "
                f"周 {fmt_pct(item['weekly'])} · 判读后 {fmt_pct(item['drift'])} · {item['reason']}"
            )
        return [], lines

    from ndt_llm import llm

    def run_one(item):
        code = item["code"]
        rec = analyses["stocks"].get(code)
        if not rec:
            return item, None, f"  ✗ {code} 找不到存量判读"
        news = recent_news(code) if market == "us" else []
        try:
            result = parse_json(llm(build_prompt(item, rec, news, market, anchor_date), max_tokens=2200))
        except Exception as exc:
            return item, None, f"  ✗ {code} LLM 失败: {str(exc)[:180]}"
        panel = (result or {}).get("panel")
        if not valid_panel(panel):
            return item, None, f"  ✗ {code} 解析失败、枚举错误或五方不全"
        return item, result, ""

    changed, logs = [], []
    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(run_one, item): item for item in candidates}
        for future in as_completed(futures):
            try:
                item, result, error = future.result()
            except Exception as exc:
                item = futures[future]
                logs.append(f"  ✗ {item['code']} 刷新线程失败: {str(exc)[:180]}")
                continue
            code = item["code"]
            if error:
                logs.append(error)
                continue
            rec = analyses["stocks"][code]
            rec["panel"] = result["panel"]
            if result.get("divergence"):
                rec["divergence"] = result["divergence"]
            rec["judged_at"] = TODAY
            rec["_refreshed_at"] = TODAY
            rec["_refreshed_reason"] = item["reason"]
            rec["_refreshed_move"] = round(item["weekly"], 1) if item["weekly"] is not None else None
            rec["_refreshed_since_judgment"] = round(item["drift"], 1) if item["drift"] is not None else None
            changed.append(item)
            logs.append(
                f"  ✓ {market} {code} {rec.get('name', '')} · "
                f"周 {fmt_pct(item['weekly'])} · 判读后 {fmt_pct(item['drift'])}"
            )
    changed.sort(key=lambda item: item["code"])
    return changed, logs


def make_summary(analyses) -> dict:
    stocks = {}
    for code, rec in analyses.get("stocks", {}).items():
        panel = rec.get("panel") or {}
        scores = [
            panel.get(master, {}).get("score") if isinstance(panel.get(master), dict) else None
            for master in MASTERS
        ]
        present = [score for score in scores if isinstance(score, (int, float))]
        stocks[code] = {
            "sc": scores,
            "div": round(max(present) - min(present)) if len(present) >= 2 else 0,
        }
    return {"order": list(MASTERS), "generated_at": NOW, "stocks": stocks}


def sync_outputs(us_analyses, a_analyses, us_changed, a_changed, us_summary, a_summary):
    """刷新所有前端消费层，并把成功重判股票的 p0 重置到当前价。"""
    if us_changed:
        us_analyses["generated_at"] = NOW
        write(PUB / "us-analyses.json", us_analyses)
        write(PUB / "us-panel-summary.json", us_summary)
        blurbs = {
            code: str(rec.get("divergence", "")).strip()[:120]
            for code, rec in us_analyses.get("stocks", {}).items()
            if str(rec.get("divergence", "")).strip()
        }
        write(PUB / "us-blurbs.json", blurbs)
    if a_changed:
        a_analyses["generated_at"] = NOW
        write(PUB / "a-analyses.json", a_analyses)
        write(PUB / "a-panel-summary.json", a_summary)

    for market, changed in (("us", us_changed), ("a", a_changed)):
        path = PUB / f"judgment-p0-{market}.json"
        doc = load(path, {"anchor": TODAY, "p0": {}}) or {"anchor": TODAY, "p0": {}}
        anchors = doc.setdefault("p0", {})
        refreshed = doc.setdefault("refreshed_at", {})
        for item in changed:
            if item["current"] is not None:
                anchors[item["code"]] = round(item["current"], 4)
                refreshed[item["code"]] = TODAY
        doc["updated_at"] = NOW
        write(path, doc)

    pulse = load(PUB / "pulse-scores.json", {"order": list(MASTERS), "stocks": {}}) or {}
    pulse_stocks = pulse.setdefault("stocks", {})
    for item in us_changed:
        pulse_stocks[item["code"]] = us_summary["stocks"][item["code"]]
    for item in a_changed:
        pulse_stocks[item["code"]] = a_summary["stocks"][item["code"]]
    pulse["order"] = list(MASTERS)
    pulse["generated_at"] = NOW
    write(PUB / "pulse-scores.json", pulse)


def candidate_summary(items):
    weekly = sum(1 for item in items if "周异动" in item["reason"])
    drift = sum(1 for item in items if "判读已漂移" in item["reason"])
    return f"{len(items)}(周异动 {weekly} / 判读漂移 {drift})"


def main():
    us_history = (load(PUB / "price-history-30d.json", {}) or {}).get("closes", {})
    a_history = (load(PUB / "a-price-history-30d.json", {}) or {}).get("closes", {})
    us_analyses = load(PUB / "us-analyses.json", {"stocks": {}})
    a_analyses = load(PUB / "a-analyses.json", {"order": [], "stocks": {}})
    us_p0 = load(PUB / "judgment-p0-us.json", {"p0": {}})
    a_p0 = load(PUB / "judgment-p0-a.json", {"p0": {}})

    us_candidates = pick(
        us_analyses, us_history, us_p0, THRESH_US, CEIL_US, DRIFT_US,
        DRIFT_CEIL_US, MIN_MCAP_US, CAP_US, "us",
    )
    a_candidates = pick(
        a_analyses, a_history, a_p0, THRESH_A, CEIL_A, DRIFT_A,
        DRIFT_CEIL_A, MIN_MCAP_A, CAP_A, "a",
    )

    print(
        f"[auto-judge {TODAY}] 美股候选 {candidate_summary(us_candidates)} · "
        f"A股候选 {candidate_summary(a_candidates)} · 并发 {WORKERS} · DRY={DRY}"
    )
    print(
        f"  规则:US 周±{THRESH_US}~{CEIL_US}%/判读±{DRIFT_US}~{DRIFT_CEIL_US}%/≥${MIN_MCAP_US}B/上限{CAP_US}; "
        f"A 周±{THRESH_A}~{CEIL_A}%/判读±{DRIFT_A}~{DRIFT_CEIL_A}%/≥{MIN_MCAP_A}亿/上限{CAP_A}"
    )

    us_changed, us_logs = refresh(us_candidates, us_analyses, "us", (us_p0 or {}).get("anchor"))
    a_changed, a_logs = refresh(a_candidates, a_analyses, "a", (a_p0 or {}).get("anchor"))
    for line in us_logs + a_logs:
        print(line)

    if not DRY and (us_changed or a_changed):
        us_summary = make_summary(us_analyses)
        a_summary = make_summary(a_analyses)
        sync_outputs(us_analyses, a_analyses, us_changed, a_changed, us_summary, a_summary)

    print(f"[auto-judge {TODAY}] 完成:美股刷新 {len(us_changed)} · A股刷新 {len(a_changed)}")


if __name__ == "__main__":
    main()
