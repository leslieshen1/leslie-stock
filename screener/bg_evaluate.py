"""BG 6 维度评分器。

输入：单只股票的 snapshot dict（来自 fetchers/snapshot.py）
输出：markdown 格式的 BG 评估报告

量化部分（财务/估值/能力圈）由本模块直接打分；
定性部分（商业模式/护城河/管理层）留 placeholder，由 Claude 在对话中补充。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Leslie 的能力圈起点（参考 core/BG_DNA.md 附录 B）
CIRCLE_OF_COMPETENCE = {
    "AI 上下游": [
        "光模块", "通信设备", "通信终端", "通信工程",
        "半导体", "芯片", "电子元件", "电子化学品",
        "服务器", "PCB", "印制电路板",
        "软件服务", "互联网服务", "应用软件",
        "智能驾驶", "汽车电子", "汽车零部件",
        "机器人", "工业互联网",
    ],
    "能源/材料/资源": [
        "光伏设备", "风电设备", "电网设备", "电源设备",
        "电池", "锂电池", "新能源", "电气设备",
        "煤炭", "石油", "天然气", "油服",
        "有色金属", "铜", "铝", "稀土", "黄金",
        "钢铁", "化工", "化学制品", "化学原料",
        "建材", "水泥",
    ],
    "医药生物": [
        "化学制药", "中药", "生物制品", "医疗器械",
        "医疗服务", "医药商业", "原料药",
    ],
    "互联网": [
        "软件服务", "互联网服务", "传媒", "游戏",
        "电商", "在线教育",
    ],
}

# 财务红线（参考 BG_DNA.md 维度 4，附录 C 按行业调整）
FINANCIAL_REDLINES = {
    "roe_min": 15.0,           # 长期 ROE > 15%
    "roe_warn": 10.0,
    "debt_ratio_max": 60.0,    # 资产负债率 < 60%（金融除外）
    "debt_ratio_warn": 70.0,
    "fcf_to_ni_min": 70.0,     # FCF / 净利润 > 70%
    "goodwill_to_equity_max": 30.0,  # 商誉 / 净资产 < 30%
}

# 估值参考（参考 BG_DNA.md 维度 5）
VALUATION_RULES = {
    "pe_pct_cheap": 30,    # 历史分位 < 30%：偏便宜
    "pe_pct_expensive": 70,
    "payback_years_attractive": 10,  # 十年回本期
    "payback_years_acceptable": 15,
}


@dataclass
class DimensionScore:
    name: str
    score: float                # 0-100
    grade: str                  # "通过" / "警告" / "一票否决"
    details: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)  # 红绿灯标签


@dataclass
class BGReport:
    code: str
    name: str
    market: str
    industry: str | None
    dimensions: dict[str, DimensionScore]
    overall_score: float
    overall_grade: str   # "重点候选" / "学习池" / "过滤"
    sell_triggers: list[str]  # 卖出条件触发情况
    raw_quote: dict
    adjustments_applied: list[str] = field(default_factory=list)
    verdict: str = ""  # LLM 给的最终观点（段永平/巴菲特视角）
    llm_used: bool = False


# ----- 维度评分函数 -----

def score_business_model(industry: str | None, quote: dict) -> DimensionScore:
    """商业模式评分（定性为主，量化为辅）。

    量化部分：行业属性（消费/科技/资源/金融 等），市值规模。
    定性部分：Claude 在对话中补充 10 年视角、长坡厚雪等判断。
    """
    s = DimensionScore(name="商业模式", score=0, grade="待 Claude 评估")
    s.details.append(f"行业：{industry or '未知'}")
    s.details.append(f"市值：{_fmt_market_cap(quote.get('market_cap'))}")
    s.details.append("⚠️ 定性维度，需 Claude 按 BG_DNA 框架补充：")
    s.details.append("  - 10 年后这门生意还在赚钱吗？")
    s.details.append("  - 行业是长坡厚雪还是周期？")
    s.details.append("  - 资本支出 vs 现金流是否健康？")
    s.details.append("  - 定价权强弱？")
    return s


def score_moat(industry: str | None, financials: dict | None) -> DimensionScore:
    """护城河评分（定性 + 部分量化）。

    量化线索：长期高毛利（>40%）暗示品牌/技术护城河；
              长期高 ROIC（>15%）暗示资本配置效率高。
    """
    s = DimensionScore(name="护城河", score=0, grade="待 Claude 评估")
    if financials:
        gross_margin = financials.get("gross_margin_avg_5y")
        roic = financials.get("roic_avg_5y")
        if gross_margin is not None:
            s.details.append(f"5 年平均毛利率：{gross_margin:.1f}%")
            if gross_margin > 40:
                s.flags.append("🟢 高毛利暗示品牌/技术护城河")
        if roic is not None:
            s.details.append(f"5 年平均 ROIC：{roic:.1f}%")
            if roic > 15:
                s.flags.append("🟢 高 ROIC 暗示资本配置效率")
    s.details.append("⚠️ 定性维度，需 Claude 补充：")
    s.details.append("  - 5 种护城河中有哪些（品牌/网络/转换成本/成本/牌照）？")
    s.details.append("  - 过去 5 年护城河变宽还是变窄？")
    s.details.append("  - 竞争对手 5 年内能复制吗？")
    return s


def score_management(financials: dict | None) -> DimensionScore:
    """管理层评分（定性 + 警报信号）。

    量化警报：大股东质押率、近期减持、关联交易、商誉异常。
    定性部分：Claude 补充诚信、能力、股东导向判断。
    """
    s = DimensionScore(name="管理层", score=0, grade="待 Claude 评估")
    if financials:
        pledge = financials.get("major_shareholder_pledge_pct")
        if pledge is not None:
            s.details.append(f"大股东质押率：{pledge:.1f}%")
            if pledge > 50:
                s.flags.append("🔴 质押率 > 50% 高风险")
            elif pledge > 30:
                s.flags.append("🟡 质押率 > 30% 警告")
    s.details.append("⚠️ 定性维度，需 Claude 补充：")
    s.details.append("  - 实控人/CEO 是谁？历史决策记录？")
    s.details.append("  - 资本配置（分红/回购/并购/扩产）是否理性？")
    s.details.append("  - 近期是否有大幅减持/管理层离职？")
    s.details.append("  - 关联交易占比是否健康？")
    return s


def score_financials(financials: dict | None, industry: str | None) -> DimensionScore:
    """财务质量评分（**完全量化**，按 BG_DNA 附录 C 行业差异化）."""
    s = DimensionScore(name="财务质量", score=0, grade="数据不足")

    if not financials:
        s.details.append("⚠️ 财务数据不足，无法量化评分")
        return s

    # 按行业调整红线（附录 C.1）
    adjusted = _adjust_redlines_for_industry(industry)
    passed: list[str] = []
    failed: list[str] = []
    warns: list[str] = []

    roe_avg = financials.get("roe_avg_5y")
    if roe_avg is not None:
        target = adjusted["roe_min"]
        if roe_avg >= target:
            passed.append(f"✅ ROE 5 年均 {roe_avg:.1f}% ≥ {target}%")
        elif roe_avg >= adjusted["roe_warn"]:
            warns.append(f"🟡 ROE 5 年均 {roe_avg:.1f}% 在 [{adjusted['roe_warn']}%, {target}%)")
        else:
            failed.append(f"🔴 ROE 5 年均 {roe_avg:.1f}% < {adjusted['roe_warn']}%")

    debt_ratio = financials.get("debt_ratio")
    if debt_ratio is not None and not adjusted.get("skip_debt_ratio"):
        if debt_ratio < adjusted["debt_ratio_max"]:
            passed.append(f"✅ 资产负债率 {debt_ratio:.1f}% < {adjusted['debt_ratio_max']}%")
        elif debt_ratio < adjusted["debt_ratio_warn"]:
            warns.append(f"🟡 资产负债率 {debt_ratio:.1f}% 偏高")
        else:
            failed.append(f"🔴 资产负债率 {debt_ratio:.1f}% > {adjusted['debt_ratio_warn']}%")

    fcf_ratio = financials.get("fcf_to_ni_avg_5y")
    if fcf_ratio is not None and not adjusted.get("skip_fcf"):
        if fcf_ratio >= FINANCIAL_REDLINES["fcf_to_ni_min"]:
            passed.append(f"✅ FCF/净利润 5 年均 {fcf_ratio:.1f}% ≥ 70%")
        elif fcf_ratio >= 50:
            warns.append(f"🟡 FCF/净利润 {fcf_ratio:.1f}% 偏低")
        else:
            failed.append(f"🔴 FCF/净利润 {fcf_ratio:.1f}% < 50%（盈利质量存疑）")

    goodwill_ratio = financials.get("goodwill_to_equity")
    if goodwill_ratio is not None:
        if goodwill_ratio < 30:
            passed.append(f"✅ 商誉/净资产 {goodwill_ratio:.1f}% < 30%")
        elif goodwill_ratio < 50:
            warns.append(f"🟡 商誉/净资产 {goodwill_ratio:.1f}% 偏高")
        else:
            failed.append(f"🔴 商誉/净资产 {goodwill_ratio:.1f}% > 50%（减值地雷）")

    gross_margin = financials.get("gross_margin_avg_5y")
    if gross_margin is not None:
        s.details.append(f"5 年均毛利率：{gross_margin:.1f}%")

    cf_quality = financials.get("ocf_to_ni_avg_5y")
    if cf_quality is not None:
        if cf_quality >= 1.0:
            passed.append(f"✅ 经营现金流/净利润 5 年均 {cf_quality:.2f} ≥ 1.0")
        elif cf_quality >= 0.8:
            warns.append(f"🟡 经营现金流/净利润 {cf_quality:.2f}")
        else:
            failed.append(f"🔴 经营现金流/净利润 {cf_quality:.2f} < 0.8（现金转化差）")

    total = len(passed) + len(warns) + len(failed)
    if total == 0:
        s.details.append("⚠️ 财务数据不足")
        return s

    s.score = (len(passed) * 100 + len(warns) * 60 + len(failed) * 20) / total
    s.flags.extend(passed + warns + failed)
    if len(failed) >= 2:
        s.grade = "一票否决"
    elif s.score >= 80:
        s.grade = "通过"
    elif s.score >= 60:
        s.grade = "警告"
    else:
        s.grade = "一票否决"
    return s


def score_valuation(quote: dict, valuation_hist: Any = None) -> DimensionScore:
    """估值评分（完全量化）。"""
    s = DimensionScore(name="估值", score=0, grade="数据不足")

    pe_ttm = _safe_num(quote.get("pe_ttm"))
    pb = _safe_num(quote.get("pb"))

    if pe_ttm and pe_ttm > 0:
        payback_years = pe_ttm  # 简化的十年回本期 = PE
        s.details.append(f"PE_TTM = {pe_ttm:.1f}（十年回本期 ≈ {payback_years:.1f} 年）")
        if payback_years < VALUATION_RULES["payback_years_attractive"]:
            s.flags.append(f"🟢 十年回本期 < 10 年，有吸引力")
        elif payback_years < VALUATION_RULES["payback_years_acceptable"]:
            s.flags.append(f"🟡 十年回本期 < 15 年，可接受")
        elif payback_years > 30:
            s.flags.append(f"🔴 十年回本期 > 30 年，估值高")
    elif pe_ttm and pe_ttm < 0:
        s.flags.append(f"⚠️ PE_TTM 为负（亏损），无法用 PE 评估")

    if pb and pb > 0:
        s.details.append(f"PB = {pb:.2f}")

    # 历史分位（如有 valuation_hist 数据）
    if valuation_hist is not None and len(valuation_hist) > 100:
        try:
            current_pe = pe_ttm
            hist_pe = valuation_hist.get("pe_ttm") if hasattr(valuation_hist, "get") else None
            if hist_pe is not None and current_pe:
                pct = (hist_pe < current_pe).mean() * 100
                s.details.append(f"PE 历史分位：{pct:.0f}%")
                if pct < 30:
                    s.flags.append("🟢 PE 在历史 30% 分位以下，偏便宜")
                elif pct > 70:
                    s.flags.append("🔴 PE 在历史 70% 分位以上，偏贵")
        except Exception:
            pass

    # 综合打分
    if pe_ttm and pe_ttm > 0:
        if pe_ttm < 10:
            s.score = 90
            s.grade = "通过"
        elif pe_ttm < 15:
            s.score = 80
            s.grade = "通过"
        elif pe_ttm < 25:
            s.score = 70
            s.grade = "通过"
        elif pe_ttm < 40:
            s.score = 55
            s.grade = "警告"
        else:
            s.score = 40
            s.grade = "一票否决"
    return s


def score_circle(industry: str | None) -> DimensionScore:
    """能力圈检查（针对 Leslie 的能力圈起点）."""
    s = DimensionScore(name="能力圈", score=0, grade="圈外")
    if not industry:
        s.details.append("⚠️ 行业信息缺失，无法判断")
        return s

    matched_circles: list[str] = []
    for circle, keywords in CIRCLE_OF_COMPETENCE.items():
        for kw in keywords:
            if kw in industry:
                matched_circles.append(circle)
                break

    s.details.append(f"行业：{industry}")

    if matched_circles:
        s.score = 80
        s.grade = "在能力圈"
        s.flags.append(f"🟢 在 Leslie 能力圈内：{' / '.join(set(matched_circles))}")
        s.details.append("⚠️ 仍需 Claude 判断是核心圈（用过产品 + 跟踪 3 年+）还是学习圈")
    else:
        s.score = 30
        s.grade = "圈外"
        s.flags.append(f"🔴 行业「{industry}」不在 Leslie 当前能力圈")
        s.details.append("能力圈：AI 上下游 / 能源-材料-资源 / 医药生物 / 互联网")
    return s


# ----- 主入口 -----

def evaluate(snap: dict, use_llm: bool = False) -> BGReport:
    """对一只股票做完整 BG 6 维度评估。

    Args:
        snap: snapshot dict，结构：
            {
                "quote": {...},           # 来自 east_money
                "financials": {...} | None,  # 财务关键指标聚合
                "valuation_history": DataFrame | None,
                "market": "a" | "hk"
            }
        use_llm: True 时调 GLM 填充商业模式 / 护城河 / 管理层 3 个定性维度
    """
    quote = snap["quote"]
    financials = snap.get("financials")
    valuation_hist = snap.get("valuation_history")
    market = snap.get("market", "a")
    industry = quote.get("industry")

    dims = {
        "business_model": score_business_model(industry, quote),
        "moat": score_moat(industry, financials),
        "management": score_management(financials),
        "financials": score_financials(financials, industry),
        "valuation": score_valuation(quote, valuation_hist),
        "circle": score_circle(industry),
    }

    verdict = ""
    llm_used = False
    if use_llm:
        try:
            from llm.glm_client import qualitative_analysis
            llm_out = qualitative_analysis(snap)
            if "_parse_error" not in llm_out:
                _apply_llm_qualitative(dims, llm_out)
                verdict = llm_out.get("verdict", "")
                llm_used = True
        except Exception as e:
            verdict = f"⚠️ LLM 调用失败：{str(e)[:120]}"

    # 综合得分（按附录 A 权重）— 跳过未评分维度（score=0 且待 Claude 评估）
    weights = {
        "business_model": 0.20,
        "moat": 0.20,
        "management": 0.15,
        "financials": 0.20,
        "valuation": 0.15,
        "circle": 0.10,
    }
    total_weight = 0.0
    total_score = 0.0
    for k, w in weights.items():
        if dims[k].score > 0:
            total_score += dims[k].score * w
            total_weight += w
    overall = total_score / total_weight if total_weight > 0 else 0.0

    # 一票否决
    veto = any(d.grade == "一票否决" for d in dims.values())
    pending_claude = total_weight < 0.95  # 还有定性维度待 Claude 补充

    if veto:
        overall_grade = "过滤（一票否决）"
    elif pending_claude and overall >= 70:
        overall_grade = "量化通过（待 Claude 定性补充）"
    elif pending_claude:
        overall_grade = "量化警告（待 Claude 定性补充）"
    elif overall >= 80:
        overall_grade = "重点候选"
    elif overall >= 65:
        overall_grade = "学习池"
    else:
        overall_grade = "过滤"

    return BGReport(
        code=quote.get("code", ""),
        name=quote.get("name", ""),
        market=market,
        industry=industry,
        dimensions=dims,
        overall_score=overall,
        overall_grade=overall_grade,
        sell_triggers=[],   # 待持仓模块补充（仅对已持仓股有意义）
        raw_quote=quote,
        verdict=verdict,
        llm_used=llm_used,
    )


def _apply_llm_qualitative(dims: dict[str, DimensionScore], llm_out: dict) -> None:
    """把 GLM 输出的 3 个定性维度填回 dims（覆盖原来的 'score=0 待 Claude 评估'）."""
    for key in ("business_model", "moat", "management"):
        block = llm_out.get(key)
        if not block:
            continue
        score = float(block.get("score", 0))
        summary = block.get("summary", "")
        details = block.get("details", []) or []
        flags = block.get("flags", []) or []
        # 护城河类型也加进去
        if key == "moat":
            mts = block.get("moat_types", []) or []
            if mts:
                details = [f"护城河类型：{' / '.join(mts)}"] + details

        new_d = DimensionScore(
            name=dims[key].name,
            score=score,
            grade=_grade_from_score(score),
            details=([f"💬 {summary}"] if summary else []) + [f"• {d}" for d in details],
            flags=flags,
        )
        dims[key] = new_d


def _grade_from_score(score: float) -> str:
    if score >= 80:
        return "通过（LLM）"
    if score >= 60:
        return "警告（LLM）"
    return "一票否决（LLM）"


# ----- 报告渲染 -----

def render_markdown(report: BGReport) -> str:
    lines: list[str] = []
    lines.append(f"# BG 评估 — {report.name}（{report.code}）")
    lines.append("")
    lines.append(f"- **市场**：{report.market.upper()}")
    lines.append(f"- **行业**：{report.industry or '未知'}")
    lines.append(f"- **当前价**：{report.raw_quote.get('price')}")
    lines.append(f"- **市值**：{_fmt_market_cap(report.raw_quote.get('market_cap'))}")
    lines.append(f"- **综合得分**：**{report.overall_score:.1f}/100** — {report.overall_grade}")
    lines.append("")

    # 各维度详情
    for key, label in [
        ("business_model", "1. 商业模式"),
        ("moat", "2. 护城河"),
        ("management", "3. 管理层"),
        ("financials", "4. 财务质量"),
        ("valuation", "5. 估值"),
        ("circle", "6. 能力圈"),
    ]:
        d = report.dimensions[key]
        score_str = f"{d.score:.0f}" if d.score else "—"
        lines.append(f"## {label}：{score_str} 分（{d.grade}）")
        for f in d.flags:
            lines.append(f"- {f}")
        for det in d.details:
            lines.append(f"- {det}")
        lines.append("")

    lines.append("---")
    lines.append("")
    if report.llm_used and report.verdict:
        lines.append("## 段永平 / 巴菲特视角（GLM-4.5）")
        lines.append("")
        lines.append(f"> {report.verdict}")
        lines.append("")
    elif not report.llm_used:
        lines.append("## Claude 补充分析（定性维度）")
        lines.append("")
        lines.append("> 商业模式、护城河、管理层这 3 个维度需要 Claude 按 BG_DNA 框架在对话中补充，")
        lines.append("> 或者跑：`uv run python -m screener.bg_evaluate <code> <market> --llm`")
        lines.append("")
    return "\n".join(lines)


# ----- helpers -----

def _adjust_redlines_for_industry(industry: str | None) -> dict:
    """按 BG_DNA 附录 C.1 调整财务红线。"""
    adj = dict(FINANCIAL_REDLINES)
    applied: list[str] = []
    if not industry:
        return adj
    # 金融业
    if any(kw in industry for kw in ["银行", "保险", "证券", "券商", "信托"]):
        adj["skip_debt_ratio"] = True
        adj["roe_min"] = 12.0
        applied.append("金融业：跳过资产负债率，ROE 门槛降至 12%")
    # 周期股
    if any(kw in industry for kw in ["钢铁", "煤炭", "化工", "有色", "海运", "航空", "造纸"]):
        adj["roe_min"] = 10.0
        applied.append("周期股：ROE 门槛降至 10%（看景气位置）")
    # 重资产成长
    if any(kw in industry for kw in ["光伏", "锂电", "半导体设备"]):
        adj["skip_fcf"] = True
        applied.append("重资产成长期：跳过 FCF 红线（扩产期 FCF 可能为负）")
    # 创新药
    if any(kw in industry for kw in ["生物制品", "创新药"]):
        adj["roe_min"] = 5.0
        applied.append("创新药：放宽 ROE 门槛（研发期）")
    return adj


def _safe_num(v: Any) -> float | None:
    try:
        if v is None or v == "-":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _fmt_market_cap(v: Any) -> str:
    n = _safe_num(v)
    if n is None:
        return "—"
    if n >= 1e12:
        return f"{n / 1e12:.2f} 万亿"
    if n >= 1e8:
        return f"{n / 1e8:.1f} 亿"
    if n >= 1e4:
        return f"{n / 1e4:.1f} 万"
    return str(int(n))


if __name__ == "__main__":
    # 完整端到端 demo: 拉 snapshot → 评估 → 打印报告
    import sys
    from fetchers.snapshot import snapshot

    code = sys.argv[1] if len(sys.argv) > 1 else "600519"
    market = sys.argv[2] if len(sys.argv) > 2 else "a"
    use_llm = "--llm" in sys.argv

    print(f"\n>>> 拉取 {code} ({market.upper()}) 数据 …\n", flush=True)
    snap = snapshot(code, market)
    if use_llm:
        print(">>> 调用 GLM-4.5 做定性分析（30-60 秒）…\n", flush=True)
    report = evaluate(snap, use_llm=use_llm)
    print(render_markdown(report))
