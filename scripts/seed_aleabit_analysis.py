"""为 watchlist 中 8 只股票预填 aleabit (Serenity @aleabitoreddit) 瓶颈狙击分析。

Serenity 的框架不是价投，是"找还没被定价为关键节点的关键节点"。
对每只股票评估：
- 在 AI capex 供应链的哪一层（1-4）
- 7 个 chokepoint 信号命中几个
- verdict：high_conviction / worth_watching / macro_tailwind /
          aleabit_analogue / crowded_but_valid / not_aleabit_territory
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
ANALYSES_DIR = ROOT / "data" / "analyses"


def make_signal(name: str, hit: str, note: str) -> dict:
    return {"name": name, "hit": hit, "note": note}


# ============================================================
# 紫金矿业 A (601899) 和 H (02899) — 同一家公司，同一份 aleabit 分析
# ============================================================
ZIJIN_ALEABIT = {
    "supply_chain_layer": 4,
    "layer_label": "Layer 4 — 原材料/物料控制点",
    "bottleneck_score": 62,
    "verdict": "macro_tailwind",
    "verdict_label": "🌊 宏观顺风（市值过大）",
    "thesis": (
        "Copper is the new oil for AI datacenters. Every MW of compute needs ~5kg of copper "
        "for power infra. $Zijin sits at top-3 globally in copper output + scaling lithium. "
        "But at $60B+ market cap she's way past my $500M-$5B sweet spot — "
        "this is a macro tailwind play, not a chokepoint sniper."
    ),
    "signals": [
        make_signal("供应链汇聚", "yes",
                    "AI 数据中心、EV、电网、绿能全都依赖铜；紫金占全球铜矿产量 5%+"),
        make_signal("材料价格 ATH", "yes",
                    "金价 2024-2025 持续创 ATH，铜价突破 $10K/吨高位"),
        make_signal("分析师覆盖率 < 3", "no",
                    "全球矿业最广泛覆盖标的之一，>30 家分析师跟踪"),
        make_signal("技术深度门槛", "no",
                    "大宗矿业逻辑透明，ChatGPT 也能解释 polymetallic 战略"),
        make_signal("政府/国防关联", "partial",
                    "战略金属储备 + 国资委间接持股，但非直接国防订单"),
        make_signal("CEO 二级市场买入", "no",
                    "陈景河持股稳定但无明显市场公开增持，SOE-民企混合机制"),
        make_signal("小盘 + 关键产能", "no",
                    "市值 60B+ USD 等价，远超 aleabit 偏好的 500M-5B 区间"),
    ],
    "signals_hit": 2,
    "red_flags": [
        "市值远超 aleabit 典型仓位（她不重仓 large cap）",
        "分析师广泛覆盖，没有信息不对称 alpha",
        "国企混合结构，CEO 不在二级市场买股",
    ],
    "ai_relevance": "铜是 AI 数据中心电力基础设施的关键材料；锂支撑 humanoid robotics 电池供应链",
    "updated_at": datetime.now().isoformat(),
}


# ============================================================
# 天坛生物 (600161_a) — 血液制品/疫苗，完全不在 aleabit 射程
# ============================================================
TIANTAN_ALEABIT = {
    "supply_chain_layer": None,
    "layer_label": "N/A — 不在 AI capex 供应链",
    "bottleneck_score": 8,
    "verdict": "not_aleabit_territory",
    "verdict_label": "❌ 不在射程",
    "thesis": (
        "Biotech / blood products / vaccines — zero connection to AI capex, "
        "photonics, semiconductors, humanoid robotics, or any of my themes. "
        "Pass."
    ),
    "signals": [
        make_signal("供应链汇聚", "no", "医药供应链，非 AI/半导体相关"),
        make_signal("材料价格 ATH", "no", "血浆/原料药价格与 AI 无关"),
        make_signal("分析师覆盖率 < 3", "no", "A 股医药白马，覆盖充分"),
        make_signal("技术深度门槛", "partial", "血制品工艺有技术壁垒，但她不研究医药"),
        make_signal("政府/国防关联", "no", "民用医药"),
        make_signal("CEO 二级市场买入", "no", "SOE（国药集团子公司）"),
        make_signal("小盘 + 关键产能", "no", "市值 ~$3B，但非 AI 节点"),
    ],
    "signals_hit": 0,
    "red_flags": [
        "完全不在 aleabit 的赛道（她明确避开生物医药）",
        "段巴框架更合适评估这只股票",
    ],
    "ai_relevance": "无 — 这是价投视角的标的，不是 aleabit 视角的标的",
    "updated_at": datetime.now().isoformat(),
}


# ============================================================
# MU (Micron) — 内存巨头，她明确提过对标 SNDK
# ============================================================
MU_ALEABIT = {
    "supply_chain_layer": 2,
    "layer_label": "Layer 2 — 模块/接口（HBM for AI compute）",
    "bottleneck_score": 68,
    "verdict": "crowded_but_valid",
    "verdict_label": "🚦 拥挤但 thesis 有效",
    "thesis": (
        "HBM is the bottleneck for AI compute throughput. Every NVDA H100/B200/B300 needs HBM. "
        "$MU is one of 3 HBM suppliers globally (SK Hynix / Samsung / Micron). "
        "I called $SNDK at Q3 EPS beat $13 vs est $4.21 — same memory cycle plays here. "
        "But $MU at $100B+ is already on every analyst's screen. Crowded long, not a sniper."
    ),
    "signals": [
        make_signal("供应链汇聚", "yes",
                    "NVDA + 所有 hyperscaler 都依赖 HBM3/HBM3e；MU 是 3 家供应商之一"),
        make_signal("材料价格 ATH", "partial",
                    "HBM ASP 持续上涨，但 DRAM 现货价格仍有周期性"),
        make_signal("分析师覆盖率 < 3", "no",
                    "Wall Street 几十家分析师覆盖，零信息不对称"),
        make_signal("技术深度门槛", "partial",
                    "HBM 堆叠 + TSV + 良率确实是 deep tech，但市场已充分理解"),
        make_signal("政府/国防关联", "yes",
                    "CHIPS Act 大额补贴接受方 + 美国本土晶圆厂战略地位"),
        make_signal("CEO 二级市场买入", "no",
                    "Sanjay Mehrotra 主要是 stock-based comp，无显著公开买入"),
        make_signal("小盘 + 关键产能", "no",
                    "市值 100B+ USD，远超 aleabit 偏好的 500M-5B 区间"),
    ],
    "signals_hit": 2,
    "red_flags": [
        "市值过大 — 她不会重仓这种 large cap memory",
        "memory 周期已被市场充分定价",
        "她更倾向 $SNDK / $AXTI 这种更上游、更不为人知的标的",
    ],
    "ai_relevance": "HBM 是 AI 训练/推理的 memory bandwidth 瓶颈，但作为投资标的太 crowded",
    "updated_at": datetime.now().isoformat(),
}


# ============================================================
# 华锡有色 (600301_a) — 锡矿，类似她的 AXTI 思路 (Layer 4 材料)
# ============================================================
HUAXI_ALEABIT = {
    "supply_chain_layer": 4,
    "layer_label": "Layer 4 — 原材料/物料控制点",
    "bottleneck_score": 78,
    "verdict": "aleabit_analogue",
    "verdict_label": "🪞 中国版 $AXTI 类比",
    "thesis": (
        "Tin is the chokepoint material for semiconductor packaging — every chip on Earth "
        "uses tin solder for SMT assembly. Global tin supply concentrated in China + Indonesia. "
        "华锡 is a China A-stock $2B mcap tin pure-play, almost zero analyst coverage. "
        "If you can stomach A-stock, this is the China version of my $AXTI thesis."
    ),
    "signals": [
        make_signal("供应链汇聚", "yes",
                    "全球每一颗芯片的 PCB 焊接都需要锡；台积电、三星、英特尔无一例外"),
        make_signal("材料价格 ATH", "partial",
                    "LME 锡价 2024 突破 $35K/吨，但未到历史 ATH"),
        make_signal("分析师覆盖率 < 3", "yes",
                    "A 股小盘有色金属，公开覆盖 < 3 家，信息不对称大"),
        make_signal("技术深度门槛", "partial",
                    "锡的电子级高纯精炼（5N+）有壁垒，但矿端逻辑相对透明"),
        make_signal("政府/国防关联", "yes",
                    "国家战略储备品种 + 出口管制讨论中"),
        make_signal("CEO 二级市场买入", "no",
                    "国资委间接控股的混合所有制，无显著管理层公开增持"),
        make_signal("小盘 + 关键产能", "yes",
                    "市值 ~$2B USD 等价，正好在 aleabit 偏好的 500M-5B sweet spot"),
    ],
    "signals_hit": 4,
    "red_flags": [
        "A 股流动性受限，外资难以建仓",
        "国企背景，capital allocation 不如纯民企灵活",
        "锡的需求也有焊接铅替代的长期不确定性",
    ],
    "ai_relevance": "锡是半导体后道封装/PCB SMT 焊接的关键耗材，AI 服务器爆发直接拉动锡需求",
    "updated_at": datetime.now().isoformat(),
}


# ============================================================
# 天赐材料 (002709_a) — 锂电池电解液，humanoid 电池供应链
# ============================================================
TIANCI_ALEABIT = {
    "supply_chain_layer": 3,
    "layer_label": "Layer 3 — 关键工艺（电解液/特种化学）",
    "bottleneck_score": 58,
    "verdict": "worth_watching",
    "verdict_label": "💎 值得关注（humanoid 供应链）",
    "thesis": (
        "Lithium battery electrolytes are a hidden chokepoint for humanoid robotics + EV scale. "
        "CATL / BYD / Samsung SDI all depend on a handful of LiPF6 formulators. "
        "天赐 is the largest China electrolyte player. "
        "Connects to my humanoid theme — but A-stock + currently in oversupply cycle."
    ),
    "signals": [
        make_signal("供应链汇聚", "yes",
                    "CATL、BYD、三星 SDI、LG 新能源全是客户；电解液产能高度集中"),
        make_signal("材料价格 ATH", "no",
                    "电解液价格 2023-2025 持续下跌，碳酸锂周期底部"),
        make_signal("分析师覆盖率 < 3", "no",
                    "锂电中游白马，覆盖充分"),
        make_signal("技术深度门槛", "yes",
                    "LiPF6 + 添加剂配方专有，新进入者很难追赶（aleabit 会喜欢这点）"),
        make_signal("政府/国防关联", "partial",
                    "新能源供应链国策支持，但非直接国防"),
        make_signal("CEO 二级市场买入", "no",
                    "徐金富持股稳定，无显著公开增持"),
        make_signal("小盘 + 关键产能", "partial",
                    "市值 ~$8B USD 等价，略超 aleabit 偏好但不算 large cap"),
    ],
    "signals_hit": 3,
    "red_flags": [
        "电解液行业产能过剩，价格仍在底部",
        "humanoid robotics 大规模量产还需 2-3 年",
        "A 股 + 中游材料，aleabit 一般更偏好上游",
    ],
    "ai_relevance": "humanoid robotics + AI 数据中心 UPS 电池供应链关键环节",
    "updated_at": datetime.now().isoformat(),
}


# ============================================================
# 航天彩虹 (002389_a) — 军用无人机，中国国防类比
# ============================================================
HTCH_ALEABIT = {
    "supply_chain_layer": 3,
    "layer_label": "Layer 3 — 国防/UAV 子系统",
    "bottleneck_score": 52,
    "verdict": "aleabit_analogue",
    "verdict_label": "🪞 中国版 $SIVE × Golden Dome",
    "thesis": (
        "$SIVE × Golden Dome thesis — aleabit loves defense-adjacent chokepoints. "
        "航天彩虹 is CASC subsidiary doing military UAV (彩虹 series). "
        "China defense bid not accessible to her — but the framework lens applies: "
        "concentrated government buyer + classified tech depth + small float."
    ),
    "signals": [
        make_signal("供应链汇聚", "partial",
                    "PLA + 出口（中东/非洲）是主要客户，集中度高"),
        make_signal("材料价格 ATH", "no",
                    "非材料密集型业务"),
        make_signal("分析师覆盖率 < 3", "yes",
                    "军工股公开信息有限，分析师覆盖少"),
        make_signal("技术深度门槛", "yes",
                    "军用无人机涉密技术，外部很难评估真实能力"),
        make_signal("政府/国防关联", "yes",
                    "央企 CASC（中国航天科技集团）子公司，直接国防订单"),
        make_signal("CEO 二级市场买入", "no",
                    "央企管理层，无市场化激励"),
        make_signal("小盘 + 关键产能", "yes",
                    "市值 ~$3-4B USD 等价，在 aleabit sweet spot"),
    ],
    "signals_hit": 4,
    "red_flags": [
        "中国国防股，外资和 Serenity 这类美国 trader 完全无法交易",
        "央企管理层 capital allocation 受限",
        "民品（彩虹系列出口）受地缘政治影响大",
    ],
    "ai_relevance": "AI 在自主无人机集群作战 + ISR 数据处理领域是核心赋能技术",
    "updated_at": datetime.now().isoformat(),
}


# ============================================================
# Circle Internet (CRCL_us) — USDC 稳定币，crypto 不在她的赛道
# ============================================================
CRCL_ALEABIT = {
    "supply_chain_layer": None,
    "layer_label": "N/A — 不在 AI capex 供应链",
    "bottleneck_score": 10,
    "verdict": "not_aleabit_territory",
    "verdict_label": "❌ 不在射程（crypto 协议层）",
    "thesis": (
        "Stablecoin issuer / payments — zero connection to AI capex or supply chain. "
        "She's openly bearish on crypto ($ETH 'terrible investment above $4K'). "
        "Pass on aleabit framework. Different thesis applies (Buffett-style: 段永平 bought CRCL)."
    ),
    "signals": [
        make_signal("供应链汇聚", "no", "稳定币业务，非物理供应链"),
        make_signal("材料价格 ATH", "no", "无相关材料"),
        make_signal("分析师覆盖率 < 3", "no", "刚 IPO 即广泛覆盖"),
        make_signal("技术深度门槛", "no", "区块链协议层，她不研究"),
        make_signal("政府/国防关联", "partial", "美国监管+stablecoin Act"),
        make_signal("CEO 二级市场买入", "no", "Jeremy Allaire 锁定期"),
        make_signal("小盘 + 关键产能", "no", "市值 $10B+，且非节点逻辑"),
    ],
    "signals_hit": 0,
    "red_flags": [
        "Serenity 明确避开 crypto 协议层投资",
        "段巴框架（段永平视角）反而更适合评估 CRCL",
    ],
    "ai_relevance": "无 — 这是金融基础设施，不是 AI 物理供应链",
    "updated_at": datetime.now().isoformat(),
}


# ============================================================
# 写入
# ============================================================

ASSIGNMENTS = [
    ("601899_a", ZIJIN_ALEABIT),
    ("02899_hk", ZIJIN_ALEABIT),
    ("600161_a", TIANTAN_ALEABIT),
    ("MU_us", MU_ALEABIT),
    ("600301_a", HUAXI_ALEABIT),
    ("002709_a", TIANCI_ALEABIT),
    ("002389_a", HTCH_ALEABIT),
    ("CRCL_us", CRCL_ALEABIT),
]


def seed():
    updated = 0
    skipped = []
    for key, aleabit_data in ASSIGNMENTS:
        path = ANALYSES_DIR / f"{key}.json"
        if not path.exists():
            skipped.append(key)
            continue
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data["aleabit"] = aleabit_data
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        updated += 1
        v = aleabit_data["verdict"]
        score = aleabit_data["bottleneck_score"]
        print(f"  ✓ {key:<14} → {v:<25} score={score} hit={aleabit_data['signals_hit']}/7")

    print()
    print(f"✅ 完成：更新 {updated} 个 JSON，跳过 {len(skipped)} 个（缺文件: {skipped}）")


if __name__ == "__main__":
    seed()
