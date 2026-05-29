"""Market Archetype — A 股 / 美股是两种 game 的底层评分准则。

核心思想（不在前端显示，纯底层逻辑）:

  A 股 = meme game
    - 没有做空机制 → 主力只有一种活法：找题材、拉预期、抬升、派发
    - 有涨停板 → 信息消化只能接力，没办法连续定价
    - 名义正和（公司真经营），但体感零和（派发机制让散户接盘）
    - alpha 来自「题材生命周期」，不来自 ROE

  美股 = contract game
    - 有完整对手盘（short interest / borrow fee / 13F / options）
    - 多空双边博弈 → 价格趋向回归基本面
    - 正和博弈（earnings + 分红 + 长期复利，持有本身创造价值）
    - alpha 来自价值发现 / 挤空 / earnings beat / 长期复利

  港股 = semi-meme
    - 有做空但流动性差，南向资金 + 国际资金双重定价

这个准则渗透评分:
  - meme 票必须评估「题材生命周期阶段」+「派发风险（无对手盘）」+「主力动作」
  - contract 票必须评估「对手盘强度」+「正和锚（earnings/FCF/分红）」+「长期持有逻辑」
"""
from __future__ import annotations

# ============================================================
# Archetype 定义
# ============================================================

ARCHETYPES: dict[str, dict] = {
    "meme": {
        "label": "A 股 · 单边题材市",
        "one_liner": "无做空 → 主力单边 → 找题材、拉预期、抬升、派发；涨停板 → 信息不连续定价",
        "alpha_source": "题材生命周期（早期进、派发前出），不是 ROE / 长期价值",
        "time_frame": "周到季度；重磅题材 1-2 年",
        "what_to_watch": [
            "题材新鲜度 + 共识程度（是否还能讲清楚一个新故事）",
            "题材生命周期阶段（incubation → ignition → markup → distribution → decay）",
            "主力动作：北向资金净流入 / 龙虎榜席位 / 大宗交易",
            "换手率分位（派发特征：高位放量滞涨）",
            "连续定价缺失风险（一字板锁死，利空出不掉）",
        ],
        "structural_red_flags": [
            "无做空对手盘 — 顶部全靠主力派发，散户接力，没有空头托底，下跌也是单边",
            "涨停板 → 信息不连续定价，利空时一字跌停，流动性瞬间归零，出不掉",
            "估值无锚 — 没有空头制衡，PB/PE 可长期严重偏离基本面（既能炒上天也能跌穿）",
        ],
    },
    "contract": {
        "label": "美股 · 双边正和市",
        "one_liner": "有完整对手盘（short/borrow fee/13F/options）→ 多空博弈 → 趋向回归基本面；正和（earnings+分红）",
        "alpha_source": "价值发现 / 挤空 / earnings beat / 长期复利（持有本身创造价值）",
        "time_frame": "季度（earnings 驱动）到 5-10 年（复利持有）",
        "what_to_watch": [
            "对手盘强度：short interest % float / days to cover / borrow fee",
            "正和锚：earnings 一致预期 + beat 概率 / FCF / 分红回购",
            "机构持仓：13F 季度净增减 / insider buying",
            "估值 vs peers（multiples 相对定价）",
            "期权流：put/call ratio / IV skew",
        ],
        "structural_red_flags": [
            "对手盘会做空 — 估值偏离基本面会被空头打回，故事讲完前就开始回归",
            "高 short interest + 业绩不及预期 = 戴维斯双杀（无涨停板保护，连续下跌）",
        ],
    },
    "semi_meme": {
        "label": "港股 · 半 meme 市",
        "one_liner": "有做空但流动性差；南向资金 + 国际资金双重定价，估值长期折价",
        "alpha_source": "南向情绪 + 价值修复（AH 折价 / 国际资金回流）",
        "time_frame": "季度到年",
        "what_to_watch": [
            "南向资金（港股通）持股变动",
            "AH 溢价 / 折价",
            "有做空但 borrow 成本高、流动性差",
            "国际资金风险偏好（美元流动性）",
        ],
        "structural_red_flags": [
            "流动性差 — 小盘股深度不足，南向撤出时杀跌剧烈",
            "价值陷阱 — 长期低估值可能是结构性折价，不是修复机会",
        ],
    },
}

# A 股 meme game 的题材生命周期阶段
LIFECYCLE_STAGES: dict[str, dict] = {
    "incubation": {
        "label": "酝酿",
        "desc": "题材未被市场发现 / 共识未形成。基本面或政策信号已现，但股价未启动。",
        "stance": "最佳潜伏期 — 风险收益比最高，但需要等催化",
    },
    "ignition": {
        "label": "发车",
        "desc": "题材起爆，主力建仓，首轮涨停 / 放量。共识开始形成。",
        "stance": "上车窗口 — 趋势确立，但要确认不是一日游",
    },
    "markup": {
        "label": "拉升",
        "desc": "故事讲开，预期发酵，估值膨胀。卖方研报跟进，散户进场。",
        "stance": "持有期 — 享受 beta，但开始警惕拥挤度",
    },
    "distribution": {
        "label": "派发",
        "desc": "高位放量滞涨，主力出货，散户接力。龙虎榜频繁，换手率高位。",
        "stance": "撤退期 — 无对手盘，主力出完就崩，别当最后接棒人",
    },
    "decay": {
        "label": "退潮",
        "desc": "题材证伪 / 熄火，单边下跌（无空头托底，跌势同样不连续）。",
        "stance": "回避 — 除非有新催化重启，否则阴跌无底",
    },
}


# ============================================================
# Helpers
# ============================================================

def archetype_for_market(market: str) -> str:
    """市场代码 → archetype。"""
    return {"a": "meme", "hk": "semi_meme", "us": "contract"}.get(market.lower(), "meme")


def archetype_meta(archetype: str) -> dict:
    return ARCHETYPES.get(archetype, ARCHETYPES["meme"])


def structural_red_flags(archetype: str) -> list[str]:
    """这个 archetype 的票天生带的结构性风险（每只都该有，无关个股）。"""
    return list(archetype_meta(archetype)["structural_red_flags"])


def what_to_watch(archetype: str) -> list[str]:
    """这个 archetype 评分时必须覆盖的维度。"""
    return list(archetype_meta(archetype)["what_to_watch"])


def lifecycle_meta(stage: str) -> dict:
    return LIFECYCLE_STAGES.get(stage, {})


def lifecycle_stance(stage: str) -> str:
    """某个生命周期阶段的操作立场。"""
    return LIFECYCLE_STAGES.get(stage, {}).get("stance", "")


if __name__ == "__main__":
    # 自检
    print("Market Archetype 准则\n")
    for mkt in ["a", "hk", "us"]:
        arch = archetype_for_market(mkt)
        meta = archetype_meta(arch)
        print(f"{mkt.upper()} → {arch} ({meta['label']})")
        print(f"   {meta['one_liner']}")
        print(f"   alpha: {meta['alpha_source']}")
        print()
    print("A 股题材生命周期:")
    for stage, m in LIFECYCLE_STAGES.items():
        print(f"   {stage:<14} {m['label']}  — {m['stance']}")
