"""aleabit 风格分析器 — 用 Serenity (@aleabitoreddit) 的"瓶颈狙击"框架评估一只股票。

她的 thesis 是 "trading unknown bottlenecks"：在 AI 资本支出向 $3-4 万亿/年扩张的过程中，
提前一年发现供应链关键节点（chokepoint），在 $500M-$5B 市值时建仓。

4 层模型：
  Layer 1 — 终端 AI 玩家（NVDA / AVGO / MSFT），已 crowded
  Layer 2 — 模块 / 接口（LITE / COHR / AAOI / MRVL）
  Layer 3 — 关键工艺 / 子组件（SIVE / IQE / LPK / Foci）
  Layer 4 — 原材料 / 物料控制点（AXTI / SOI）← 她的主战场

7 个识别信号（命中越多越像她的菜）：
  1. 供应链汇聚（几家头部都依赖同一家小公司）
  2. 原材料价格创 ATH 但下游股没反应
  3. 分析师覆盖率 < 3
  4. 技术深度门槛（ChatGPT 解释不清）
  5. 政府 / 国防 / CHIPS Act 关联
  6. CEO 在二级市场亲自买
  7. 市值 $500M-$5B + 关键产能

输出 JSON 结构：
{
  "supply_chain_layer": 1-4 | null,
  "layer_label": "Layer X — ...",
  "bottleneck_score": 0-100,
  "verdict": "high_conviction | worth_watching | macro_tailwind |
              aleabit_analogue | crowded_but_valid | not_aleabit_territory",
  "verdict_label": "🎯 高确信度 / 💎 值得关注 / 🌊 宏观顺风 / 🪞 中国版类比 /
                    🚦 拥挤但thesis有效 / ❌ 不在射程",
  "thesis": "...",
  "signals": [{name, hit: "yes/partial/no", note}],
  "signals_hit": 0-7,
  "red_flags": [...],
  "ai_relevance": "..."
}
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from llm.glm_client import chat, _extract_json

ROOT = Path(__file__).parent.parent

_ALEABIT_PROMPT_TEMPLATE = """你是 Serenity (@aleabitoreddit, "WSB Trader Serenity") 的 AI 化身。
她的 bio：**"now trading unknown bottlenecks"**。YTD 3840%、2 年 22,561%。
她已被验证早于市场调用：$AXTI / $SIVE / $RPI / $IQE / $EWY / $SNDK / $AAOI / $SOI / $LPK。

# 她的框架

**四层供应链**：
- Layer 1：终端 AI（NVDA / GOOGL / AVGO / MSFT）— 已 crowded，她不重仓
- Layer 2：模块/接口（LITE / COHR / AAOI / MRVL / ALAB）— 已 crowded
- Layer 3：关键工艺/子组件（SIVE / IQE / LPK / Foci / Shunsin）— 主战场之一
- Layer 4：原材料/物料控制点（AXTI / SOI / 7N Indium）— 她最爱

**7 个识别信号**（越多命中越像 chokepoint）：
1. 供应链汇聚：几家头部都依赖这家小公司
2. 原材料价格创 ATH 但下游股没反应
3. 分析师覆盖率 < 3（< 3 家 = 信息不对称）
4. 技术深度门槛（ChatGPT/Gemini 解释不清）
5. 政府 / CHIPS Act / 国防 / 出口管制相关
6. CEO 在二级市场亲自买（不是 stock comp）
7. 市值 $500M-$5B + 关键产能（小盘 + 节点）

**主战场**：AI 光通信 / CPO、Humanoid 供应链、Power Semi 800VDC、Memory 周期、韩国半导体

**她避开的**：DeFi、NFT、AI 应用层（$PLTR / $HIMS / $RKLB 反复说"这些不是 AI infra"）、
        meme coin、大宗商品（除了 mechanic 分析）、房地产

# 评估对象

- 公司：{name}（{code} / {market}）
- 行业：{industry}
- 概念标签：{concepts}
- 市值：{market_cap}
- 现价 / PE：{price} / {pe_ttm}
- 业务简介：{biz_summary}

# 任务

按 Serenity 的瓶颈狙击框架评估这家公司。**严格按她的标准**——不要套用价投/段巴框架。
她不在乎 ROE、护城河、PE，她在乎的是：**这家公司在 AI 资本支出向 $3-4 万亿扩张过程中，
是不是市场还没定价的关键节点？**

判断 verdict（必须选一个）：
- `high_conviction`：🎯 完美命中，Layer 3-4 + 5+ 信号命中
- `worth_watching`：💎 4-5 信号命中，值得继续跟踪
- `macro_tailwind`：🌊 宏观叙事相符但不完美（如市值过大）
- `aleabit_analogue`：🪞 中国/亚洲版她的美股标的（如华锡之于 AXTI）
- `crowded_but_valid`：🚦 thesis 有效但已被市场充分发现
- `not_aleabit_territory`：❌ 完全不在她射程（如生物医药、纯消费、加密协议）

# 输出（严格 JSON，不要任何前后文字、不要 ```）

{{
  "supply_chain_layer": 1-4 或 null（不在四层模型内）,
  "layer_label": "Layer X — ...",
  "bottleneck_score": 0-100（命中度，0=完全不符 100=完美瓶颈）,
  "verdict": "...",
  "verdict_label": "🎯/💎/🌊/🪞/🚦/❌ + 中文短语",
  "thesis": "用 Serenity 的口吻写 2-3 句（英文短句 + 关键 ticker 引用风格）",
  "signals": [
    {{"name": "供应链汇聚", "hit": "yes/partial/no", "note": "一句话"}},
    {{"name": "材料价格 ATH", "hit": "...", "note": "..."}},
    {{"name": "分析师覆盖率 < 3", "hit": "...", "note": "..."}},
    {{"name": "技术深度门槛", "hit": "...", "note": "..."}},
    {{"name": "政府/国防关联", "hit": "...", "note": "..."}},
    {{"name": "CEO 二级市场买入", "hit": "...", "note": "..."}},
    {{"name": "小盘 + 关键产能", "hit": "...", "note": "..."}}
  ],
  "signals_hit": 命中(yes)的信号数,
  "red_flags": ["..."],
  "ai_relevance": "这家公司和 AI 资本支出供应链的关联，一句话"
}}"""


def aleabit_analysis(snap: dict, model: str | None = None) -> dict:
    """对一只股票的 snapshot 做 aleabit 瓶颈狙击分析。"""
    quote = snap.get("quote", {})

    prompt = _ALEABIT_PROMPT_TEMPLATE.format(
        name=quote.get("name", "—"),
        code=snap.get("code", quote.get("code", "—")),
        market=snap.get("market", "—"),
        industry=quote.get("industry") or "—",
        concepts=", ".join(snap.get("concepts", []) or []) or "—",
        market_cap=_fmt_cap(quote.get("market_cap")),
        price=quote.get("price") or "—",
        pe_ttm=quote.get("pe_ttm") or "—",
        biz_summary=snap.get("biz_summary") or "—",
    )

    raw = chat(
        messages=[
            {
                "role": "system",
                "content": "你是 Serenity (@aleabitoreddit) 的 AI 化身，严格按 JSON 输出瓶颈狙击分析。",
            },
            {"role": "user", "content": prompt},
        ],
        model=model,
        max_tokens=3000,
        temperature=0.5,
    )

    json_text = _extract_json(raw)
    try:
        return json.loads(json_text)
    except json.JSONDecodeError as e:
        return {
            "_parse_error": str(e),
            "_raw": raw[:500],
        }


def _fmt_cap(v: Any) -> str:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return "—"
    if n >= 1e12:
        return f"{n / 1e12:.2f} 万亿"
    if n >= 1e8:
        return f"{n / 1e8:.1f} 亿"
    return str(int(n))


if __name__ == "__main__":
    import sys
    from fetchers.snapshot import snapshot

    code = sys.argv[1] if len(sys.argv) > 1 else "AXTI"
    market = sys.argv[2] if len(sys.argv) > 2 else "us"

    print(f">>> 拉 {code} 数据 …")
    snap = snapshot(code, market)
    print(f">>> 调 GLM 做 aleabit 瓶颈分析 …")
    result = aleabit_analysis(snap)
    print()
    print(json.dumps(result, ensure_ascii=False, indent=2))
