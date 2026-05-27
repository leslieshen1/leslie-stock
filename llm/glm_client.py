"""智谱 GLM 客户端。

用 OpenAI 兼容接口调智谱 BigModel API（base_url = https://open.bigmodel.cn/api/paas/v4/）。
默认模型：glm-4.5（reasoning 模型，对价投定性分析特别合适）。

环境变量：
- ZHIPU_API_KEY：智谱 API key
- GLM_MODEL：默认模型名（glm-4.5 / glm-5 / glm-5.1 / glm-4.6）
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")

DEFAULT_MODEL = os.getenv("GLM_MODEL", "glm-4.5")
BASE_URL = "https://open.bigmodel.cn/api/paas/v4/"

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        key = os.getenv("ZHIPU_API_KEY")
        if not key:
            raise RuntimeError(
                "缺少 ZHIPU_API_KEY。请在 .env 中设置（去 https://bigmodel.cn 申请）"
            )
        _client = OpenAI(api_key=key, base_url=BASE_URL)
    return _client


def chat(
    messages: list[dict],
    model: str | None = None,
    max_tokens: int = 2000,
    temperature: float = 0.6,
    **kwargs,
) -> str:
    """通用 chat 接口，返回 content。"""
    client = _get_client()
    resp = client.chat.completions.create(
        model=model or DEFAULT_MODEL,
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
        **kwargs,
    )
    return resp.choices[0].message.content or ""


# ---- BG 定性分析 ----

_BG_QUAL_PROMPT_TEMPLATE = """你是段永平 + 巴菲特价值投资 DNA 的化身。

# 评估对象
- 公司：{name}（{code}）
- 市场：{market}
- 行业：{industry}
- 市值：{market_cap}
- 当前价：{price}
- PE_TTM：{pe_ttm}
- PB：{pb}
- ROE 5 年均：{roe}
- 资产负债率：{debt_ratio}
- 5 年均毛利率：{gross_margin}
- 经营现金流/净利润：{ocf_ni}

# 任务
按 BG_DNA 框架对这家公司做 3 个定性维度评分。每个 0-100 分。

## 1. 商业模式（Business Model）
- 10 年后还在赚钱吗？长坡厚雪 vs 周期？
- 资本支出 vs 现金流是否健康？
- 定价权强弱？
- 评分参考：好生意 80-95，平庸 60-75，差生意 30-50

## 2. 护城河（Moat）
- 5 种护城河里占了哪些（品牌 / 网络效应 / 转换成本 / 成本优势 / 牌照）？
- 过去 5 年护城河变宽还是变窄？
- 竞争对手 5 年内能复制吗？巴菲特 100 亿打击测试？

## 3. 管理层（Management）
- CEO / 实控人是谁？历史决策记录？
- 资本配置（分红 / 回购 / 并购 / 扩产）是否理性？
- 股东导向 vs 利益输送？
- A 股 / 港股警报：质押率、减持、关联交易？国企 vs 民企？

# 输出（严格 JSON，不要任何前后文字、不要 markdown ```）
{{
  "business_model": {{
    "score": 0-100 整数,
    "summary": "一句话总结",
    "details": ["要点1", "要点2", "要点3"],
    "flags": ["🟢/🟡/🔴 +一句话信号"]
  }},
  "moat": {{
    "score": 0-100,
    "summary": "...",
    "moat_types": ["品牌"/"网络效应"/"转换成本"/"成本优势"/"牌照"],
    "details": ["要点1", "要点2", "要点3"],
    "flags": ["..."]
  }},
  "management": {{
    "score": 0-100,
    "summary": "...",
    "details": ["要点1", "要点2", "要点3"],
    "flags": ["..."]
  }},
  "verdict": "段永平 / 巴菲特会买吗？2-3 句话观点（结合估值）。"
}}"""


def qualitative_analysis(snap: dict, model: str | None = None) -> dict:
    """对一只股票的 snapshot 做 BG 定性 3 维度分析。

    Returns:
        dict 包含 business_model / moat / management / verdict 字段。
    """
    quote = snap.get("quote", {})
    fin = snap.get("financials") or {}

    prompt = _BG_QUAL_PROMPT_TEMPLATE.format(
        name=quote.get("name", "—"),
        code=snap.get("code", quote.get("code", "—")),
        market=("A 股" if snap.get("market") == "a" else "港股"),
        industry=quote.get("industry") or "—",
        market_cap=_fmt_cap(quote.get("market_cap")),
        price=quote.get("price") or "—",
        pe_ttm=quote.get("pe_ttm") or "—",
        pb=quote.get("pb") or "—",
        roe=_pct(fin.get("roe_avg_5y")),
        debt_ratio=_pct(fin.get("debt_ratio")),
        gross_margin=_pct(fin.get("gross_margin_avg_5y")),
        ocf_ni=_num(fin.get("ocf_to_ni_avg_5y"), 2),
    )

    raw = chat(
        messages=[
            {"role": "system", "content": "你是段永平 + 巴菲特投资 DNA。严格按 JSON 输出，不要任何额外文字。"},
            {"role": "user", "content": prompt},
        ],
        model=model,
        max_tokens=3500,
        temperature=0.5,
    )

    # 提取 JSON
    json_text = _extract_json(raw)
    try:
        return json.loads(json_text)
    except json.JSONDecodeError as e:
        return {
            "_parse_error": str(e),
            "_raw": raw[:500],
        }


def _extract_json(text: str) -> str:
    """从模型输出中提取最外层 JSON。"""
    text = text.strip()
    # 去掉可能的 ```json ... ``` 包裹
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    # 找第一个 { 到最后一个 }
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start : end + 1]
    return text


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


def _pct(v: Any) -> str:
    try:
        return f"{float(v):.2f}%"
    except (TypeError, ValueError):
        return "—"


def _num(v: Any, digits: int = 2) -> str:
    try:
        return f"{float(v):.{digits}f}"
    except (TypeError, ValueError):
        return "—"


if __name__ == "__main__":
    import sys
    from fetchers.snapshot import snapshot

    code = sys.argv[1] if len(sys.argv) > 1 else "600519"
    market = sys.argv[2] if len(sys.argv) > 2 else "a"

    print(f">>> 拉 {code} 数据 …")
    snap = snapshot(code, market)
    print(f">>> 调 GLM 做定性分析（{DEFAULT_MODEL}）…")
    result = qualitative_analysis(snap)
    print()
    print(json.dumps(result, ensure_ascii=False, indent=2))
