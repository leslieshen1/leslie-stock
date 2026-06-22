"""自动刷新「已覆盖」股票的五方判读 —— 每周一次,纯云端 CI(无 leslie.db 依赖)。

口径(用户 2026-06-22 拍板):一周一次 · 美股 + A股 · 只刷新已覆盖的票 · 有上限控成本。

做什么:扫 us-analyses.json / a-analyses.json 里【已有五方】且本周【大幅异动】的票,
逐只调 Claude Opus 4.8(scripts/ndt_llm.llm)结合本周涨跌幅 + 近期新闻重判五方 + divergence,
原地并回 analyses.json(只覆盖 panel + divergence,保留 name/sector/desc/mcap/chain)。

为什么用「异动」当闸而不是「有新闻」:us-news 近乎每只都有(Google News 全覆盖 4500+),
单纯"有新闻"会全选中;异动本身基本都是新闻/事件驱动的,所以闸用 |本周涨跌| ≥ 阈值,
再把该股近期新闻标题喂给模型当判读依据。纯"新闻显著性"触发需另加分类器(后续可扩)。

数据源:price-history-30d.json(美股近30交易日收盘,算近5日=本周)、a-price-history-30d.json
(A股历史在积累,先用现有窗口、随时间自愈)、us-news/{SYM}.json(近期标题)。

可调环境变量:AUTOJUDGE_THRESH_US(默认8)/ _THRESH_A(默认10)/ _CAP_US(15)/ _CAP_A(10)
/ _LOOKBACK(5个交易日)/ _DRY(=1 只检测不调 LLM)。
"""
import json
import os
import re
import sys
import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUB = ROOT / "web" / "public" / "data"
sys.path.insert(0, str(ROOT / "scripts"))

THRESH_US = float(os.environ.get("AUTOJUDGE_THRESH_US", "8"))
THRESH_A = float(os.environ.get("AUTOJUDGE_THRESH_A", "10"))
CAP_US = int(os.environ.get("AUTOJUDGE_CAP_US", "15"))
CAP_A = int(os.environ.get("AUTOJUDGE_CAP_A", "10"))
LOOKBACK = int(os.environ.get("AUTOJUDGE_LOOKBACK", "5"))  # 近 N 个交易日 ≈ 本周
# 涨幅上限:真·有意义的周异动一般 ≤ 此值,超过基本是拆股/脏数据毛刺(实测 KLAC -89%、INHD +3661% 都是脏数据)
CEIL_US = float(os.environ.get("AUTOJUDGE_CEIL_US", "60"))
CEIL_A = float(os.environ.get("AUTOJUDGE_CEIL_A", "35"))
# 市值下限:滤掉微盘壳(只判读值得发的真公司)。US=$B,A=亿RMB(读 a-analyses 的 cap 字段)
MIN_MCAP_US = float(os.environ.get("AUTOJUDGE_MIN_MCAP_US", "2"))
MIN_MCAP_A = float(os.environ.get("AUTOJUDGE_MIN_MCAP_A", "100"))
DRY = os.environ.get("AUTOJUDGE_DRY", "") == "1"
TODAY = datetime.date.today().isoformat()
MASTERS = ("buffett", "duan", "serenity", "druckenmiller", "sentiment")

# ── 五方 DNA(沿用 panel_coverage.workflow.js 的规范:方法论 + 精确 verdict 枚举 + 评分一致性)──
DNA = """你在为产品「我不是股神 · Not a Stock God」刷新五位投资大师对一只股票的判读。全部用中文(大师都说中文)。要诚实、有区分度、结合最新的本周异动和新闻,该改判就改判,绝不注水、绝不五人同调。

五位大师(每位:0-100 分 + 从下面选一个精确 verdict + judgment 一句话 + reasoning 两三句):
- buffett 巴菲特:买公司不买股票,要宽护城河 + ≥30% 安全边际 + 能力圈内。贵的好公司也只观察。verdict ∈ {"伟大生意·合理价买入","伟大生意·太贵观察","平庸生意·无宽护城河","长期不可预测·避开","价值陷阱·避开"}
- duan 段永平:看商业模式 + 本分文化,看懂了贵一点也敢重仓,Stop Doing(不碰看不懂的/不投机/不题材)。verdict ∈ {"顶级好生意·重仓","好生意·等合理价","商业模式一般·不值得","文化不本分·避开"}
- serenity 卡脖子狙击手:只重仓产业链里不可替代的瓶颈环节,带硬止损,明牌拥挤的票即使逻辑对也只旁证。verdict ∈ {"high conviction","worth watching","crowded but valid","not a bottleneck"}
- druckenmiller 德鲁肯米勒:自上而下看宏观趋势 + 动量,不看估值只骑最强的马,趋势转了就砍或做空。verdict ∈ {"顺风重仓","趋势在·标准仓","逆流·不碰","趋势已转·砍或空"}
- sentiment 情绪面:看资金/拥挤度/情绪周期,冰点 + 资金流入就反向埋伏,过热拥挤就见顶警惕。verdict ∈ {"情绪顺风·顺势","冰点+资金进·反向埋伏","过热拥挤·见顶警惕","无情绪无资金·没戏"}

分数必须与 verdict 一致(伟大生意·合理价买入→75+;价值陷阱·避开→<35;not a bottleneck→<45;顶级好生意·重仓→78+;过热拥挤·见顶警惕→<50)。五人之间要有真实分歧。"""


def load(p, default=None):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return default


def week_move(closes_for_sym):
    """closes_for_sym = {date: close};取最后值 vs 最多 LOOKBACK 个交易日前的值。历史不足则用最早一个。"""
    if not isinstance(closes_for_sym, dict):
        return None
    vals = [v for _, v in sorted(closes_for_sym.items()) if isinstance(v, (int, float)) and v > 0]
    if len(vals) < 2:
        return None
    last = vals[-1]
    ref = vals[-(LOOKBACK + 1)] if len(vals) > LOOKBACK else vals[0]
    if not ref:
        return None
    return (last / ref - 1) * 100


def recent_news(code, limit=5):
    arr = load(PUB / "us-news" / f"{code.upper()}.json", [])
    if isinstance(arr, dict):
        arr = arr.get("items", [])
    if not isinstance(arr, list):
        return []
    out = []
    for x in arr:
        if isinstance(x, dict) and x.get("title"):
            t = re.sub(r"\s*-\s*[^-]+$", "", x["title"]).strip()  # 去掉 " - 来源" 尾巴
            out.append(t)
    return out[:limit]


def parse_json(text):
    if not text:
        return None
    text = text.strip()
    text = re.sub(r"^```(?:json)?", "", text).strip()
    text = re.sub(r"```$", "", text).strip()
    i, j = text.find("{"), text.rfind("}")
    if i < 0 or j < 0:
        return None
    try:
        return json.loads(text[i:j + 1])
    except Exception:
        return None


def pick(an, hist, thresh, ceil, min_mcap, cap, market):
    """挑【已覆盖】里本周异动的票:thresh ≤ |涨跌| ≤ ceil(上限滤拆股/脏数据)且 市值 ≥ 下限(滤微盘壳)。"""
    cands = []
    for code, rec in an.get("stocks", {}).items():
        name = rec.get("name", "")
        if market == "a" and re.match(r"\*?ST", name):  # A 股排除 ST/*ST(退市风险/常被操纵,不适合判读)
            continue
        mv = week_move(hist.get(code) or hist.get(str(code).upper()))
        if mv is None or abs(mv) < thresh or abs(mv) > ceil:
            continue
        mcap = rec.get("mcapB") if market == "us" else (rec.get("cap") or rec.get("mcapYi"))
        if mcap is None or mcap < min_mcap:
            continue
        cands.append((code, mv))
    cands.sort(key=lambda x: -abs(x[1]))
    return cands[:cap]


def build_prompt(code, rec, mv, news, market):
    ctx = {
        "代码": code,
        "名称": rec.get("name", code),
        "板块": rec.get("sector", ""),
        "本周涨跌幅": f"{mv:+.1f}%",
        "产业链": rec.get("chain", {}),
        "公司简介": rec.get("desc", ""),
        "近期新闻标题": news or "(暂无新闻源)",
        "上次五方判词(参考·可改判)": {k: (v or {}).get("verdict") for k, v in (rec.get("panel") or {}).items()},
    }
    return (
        f"{DNA}\n\n现在只判读这一只({market.upper()}),它【本周大幅异动 {mv:+.1f}%】。"
        f"请结合下面最新信息(尤其是本周异动和新闻)给出**更新后的**五方判读:\n"
        f"{json.dumps(ctx, ensure_ascii=False, indent=1)}\n\n"
        "只返回一个 JSON 对象(不要数组、不要解释、不要 markdown 代码块),格式:\n"
        '{"panel":{"buffett":{"verdict":"…","score":0,"judgment":"…","reasoning":"…"},'
        '"duan":{…},"serenity":{…},"druckenmiller":{…},"sentiment":{…}},"divergence":"一句话点出五人分歧"}\n'
        "verdict 必须用上面列的精确枚举字符串,score 0-100 整数,五人要有真实分歧。中文。"
    )


def refresh(picks, an, hist, market):
    from ndt_llm import llm  # 延迟导入:DRY 模式不需要 NDT key
    changed, log = 0, []
    for code, mv in picks:
        rec = an["stocks"].get(code) or an["stocks"].get(str(code).upper())
        if not rec:
            continue
        news = recent_news(code) if market == "us" else []
        if DRY:
            log.append(f"  [DRY] {market} {code} {rec.get('name','')} {mv:+.1f}% · 新闻 {len(news)} 条")
            continue
        try:
            out = parse_json(llm(build_prompt(code, rec, mv, news, market), max_tokens=2200))
        except Exception as e:
            log.append(f"  ✗ {code} LLM 失败: {e}")
            continue
        panel = (out or {}).get("panel")
        if not panel or not all(m in panel and isinstance(panel[m], dict) for m in MASTERS):
            log.append(f"  ✗ {code} 解析失败/五方不全")
            continue
        rec["panel"] = panel
        if out.get("divergence"):
            rec["divergence"] = out["divergence"]
        rec["_refreshed_at"] = TODAY
        rec["_refreshed_move"] = round(mv, 1)
        changed += 1
        log.append(f"  ✓ {market} {code} {rec.get('name','')} {mv:+.1f}% → 五方已刷新")
    return changed, log


def main():
    us_hist = (load(PUB / "price-history-30d.json", {}) or {}).get("closes", {})
    a_hist = (load(PUB / "a-price-history-30d.json", {}) or {}).get("closes", {})
    us_an = load(PUB / "us-analyses.json", {"stocks": {}})
    a_an = load(PUB / "a-analyses.json", {"order": [], "stocks": {}})

    us_picks = pick(us_an, us_hist, THRESH_US, CEIL_US, MIN_MCAP_US, CAP_US, "us")
    a_picks = pick(a_an, a_hist, THRESH_A, CEIL_A, MIN_MCAP_A, CAP_A, "a")

    print(f"[auto-judge {TODAY}] 美股候选 {len(us_picks)}(±{THRESH_US}~{CEIL_US}% · ≥${MIN_MCAP_US}B · 上限{CAP_US}) · "
          f"A股候选 {len(a_picks)}(±{THRESH_A}~{CEIL_A}% · ≥{MIN_MCAP_A}亿 · 上限{CAP_A}) · DRY={DRY}")

    us_changed, us_log = refresh(us_picks, us_an, us_hist, "us")
    a_changed, a_log = refresh(a_picks, a_an, a_hist, "a")
    for line in us_log + a_log:
        print(line)

    if not DRY:
        if us_changed:
            (PUB / "us-analyses.json").write_text(json.dumps(us_an, ensure_ascii=False), encoding="utf-8")
        if a_changed:
            (PUB / "a-analyses.json").write_text(json.dumps(a_an, ensure_ascii=False), encoding="utf-8")

    print(f"[auto-judge {TODAY}] 完成:美股刷新 {us_changed} · A股刷新 {a_changed}")


if __name__ == "__main__":
    main()
