"""GLM 按 BG 框架解读新闻和公告。

把一只股票最近 N 天的新闻 + 公告丢给 GLM，让它：
1. 给每条贴标签：[商业模式影响 / 护城河 / 管理层信号 / 财务变化 / 行业政策 / 市场噪音]
2. 标记信号强度：🟢加分 / 🟡警告 / 🔴红色 / ⚪噪音
3. 给一句话点评
4. 总结过去 N 天对持仓判断的影响（"持有 / 加仓 / 减仓 / 卖出"建议方向）

CLI:
    uv run python -m news.analyze 600519 a
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from llm.glm_client import _extract_json, chat
from news.fetch import cache_path, fetch_news_for_stock, load_cached_news

ROOT = Path(__file__).parent.parent
ANALYZED_DIR = ROOT / "data" / "news_analyzed"
ANALYZED_DIR.mkdir(parents=True, exist_ok=True)


def analyzed_path(code: str, market: str) -> Path:
    return ANALYZED_DIR / f"{code}_{market}.json"


BG_TAGS = [
    "商业模式影响", "护城河影响", "管理层信号",
    "财务变化", "行业政策", "估值线索", "市场噪音",
]

SIGNAL_LEVELS = ["🟢 加分", "🟡 警告", "🔴 红色", "⚪ 噪音"]

_PROMPT = """你是段永平 + 巴菲特投资 DNA。下面是 {name}（{code}）最近 {days} 天的新闻和公告，请按 BG_DNA 框架解读。

# 任务
为每条新闻 / 公告：
1. **BG 标签**（一个或多个）：商业模式影响 / 护城河影响 / 管理层信号 / 财务变化 / 行业政策 / 估值线索 / 市场噪音
2. **信号强度**：🟢加分 / 🟡警告 / 🔴红色 / ⚪噪音
3. **一句话点评**：从段永平/巴菲特角度，这条对长期持有判断有什么影响

总结：
- 过去 {days} 天的整体信号 → 持有 / 加仓 / 减仓 / 卖出 / 观望
- 触发了卖出三条件中的哪一条吗（① 当初买错 ② 基本面变坏 ③ 找到明显更好的）

# 新闻
{news_block}

# 公告
{announcement_block}

# 输出严格 JSON（不要任何 markdown ``` 包裹）
{{
  "news_analyzed": [
    {{
      "title": "原标题",
      "pub_time": "原时间",
      "bg_tags": ["商业模式影响", ...],
      "signal": "🟢 加分" or "🟡 警告" or "🔴 红色" or "⚪ 噪音",
      "verdict": "一句话点评"
    }}
  ],
  "announcements_analyzed": [
    {{
      "title": "原标题",
      "pub_time": "原时间",
      "bg_tags": [...],
      "signal": "...",
      "verdict": "..."
    }}
  ],
  "summary": {{
    "overall_signal": "🟢/🟡/🔴/⚪",
    "narrative": "2-3 句话总结过去 {days} 天对这家公司长期判断的影响",
    "action_suggestion": "持有 / 加仓 / 减仓 / 卖出 / 观望",
    "sell_condition_triggered": "无 / 当初买错 / 基本面变坏 / 找到明显更好的",
    "key_signals": ["关键信号 1", "关键信号 2"]
  }}
}}"""


def analyze_news_for_stock(code: str, market: str = "a",
                           days: int = 7, refresh_news: bool = False) -> dict:
    """对一只股票的最近 N 天新闻做 GLM 解读，缓存到 data/news_analyzed/."""
    # 1. 拿原始新闻
    if refresh_news:
        raw = fetch_news_for_stock(code, market, days=days)
    else:
        raw = load_cached_news(code, market)
        if not raw:
            raw = fetch_news_for_stock(code, market, days=days)

    news = raw.get("news", [])
    anns = raw.get("announcements", [])

    if not news and not anns:
        return {"_empty": True, "code": code, "market": market}

    # 2. 用 GLM 解读
    name = _name_from(code, market) or code
    news_block = _format_news(news, max_items=15)
    ann_block = _format_announcements(anns, max_items=10)

    prompt = _PROMPT.format(
        name=name, code=code, days=days,
        news_block=news_block, announcement_block=ann_block,
    )
    raw_out = chat(
        messages=[
            {"role": "system", "content": "你是段永平 + 巴菲特投资 DNA。严格按 JSON 输出。"},
            {"role": "user", "content": prompt},
        ],
        max_tokens=4500,
        temperature=0.4,
    )
    try:
        parsed = json.loads(_extract_json(raw_out))
    except json.JSONDecodeError:
        parsed = {"_parse_error": True, "_raw": raw_out[:800]}

    # 3. 缓存
    from datetime import datetime as dt
    payload = {
        "code": code,
        "market": market,
        "days": days,
        "updated_at": dt.now().isoformat(timespec="seconds"),
        "raw_counts": {"news": len(news), "announcements": len(anns)},
        **parsed,
    }
    analyzed_path(code, market).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return payload


def _name_from(code: str, market: str) -> str | None:
    """尝试从已缓存的 analyses 拿公司名字（不发新请求）."""
    p = ROOT / "data" / "analyses" / f"{code}_{market}.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8")).get("name")
        except Exception:
            pass
    return None


def _format_news(items: list[dict], max_items: int) -> str:
    if not items:
        return "（无新闻）"
    lines = []
    for i, n in enumerate(items[:max_items]):
        title = n.get("title", "").strip()
        ts = (n.get("pub_time") or "")[:16]
        src = n.get("source") or "—"
        summary = (n.get("summary") or "")[:200].replace("\n", " ").strip()
        lines.append(f"[{i+1}] {ts} | {src} | {title}")
        if summary:
            lines.append(f"     摘要: {summary}")
    return "\n".join(lines)


def _format_announcements(items: list[dict], max_items: int) -> str:
    if not items:
        return "（无公告）"
    lines = []
    for i, a in enumerate(items[:max_items]):
        title = a.get("title", "")
        ts = (a.get("pub_time") or "")[:10]
        atype = a.get("type") or "公告"
        lines.append(f"[{i+1}] {ts} | {atype} | {title}")
    return "\n".join(lines)


def load_cached_analysis(code: str, market: str) -> dict | None:
    p = analyzed_path(code, market)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


if __name__ == "__main__":
    code = sys.argv[1] if len(sys.argv) > 1 else "600519"
    market = sys.argv[2] if len(sys.argv) > 2 else "a"

    print(f">>> 分析 {code} ({market.upper()}) 新闻（GLM-5.1）…")
    result = analyze_news_for_stock(code, market)
    if result.get("_empty"):
        print("⚠️ 没有新闻或公告可分析")
    elif result.get("_parse_error"):
        print("⚠️ GLM 输出解析失败")
        print(result.get("_raw", "")[:500])
    else:
        summary = result.get("summary", {})
        print()
        print(f"=== 总结 ===")
        print(f"整体信号：{summary.get('overall_signal', '—')}")
        print(f"建议方向：{summary.get('action_suggestion', '—')}")
        print(f"叙述：{summary.get('narrative', '—')}")
        print(f"卖出条件触发：{summary.get('sell_condition_triggered', '无')}")
        print()
        print(f"已分析 {len(result.get('news_analyzed', []))} 条新闻、{len(result.get('announcements_analyzed', []))} 条公告")
        print(f"保存到 {analyzed_path(code, market)}")
