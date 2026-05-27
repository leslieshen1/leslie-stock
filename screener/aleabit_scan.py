"""按 Serenity / aleabit 框架批量扫描 A 股候选 → 写入 data/analyses/{code}_a.json 的 aleabit 字段。

特点：
- 不依赖 snapshot fetcher（避开东方财富反爬）
- 直接喂 candidate dict 给 LLM（包含 theme / expected_layer / mcap / pe / pb）
- 增量保存（每只一存）
- 断点续跑（基于已有 aleabit 字段判断 skip）
- 重试 + 跳过
- 进度日志（写文件 + stdout）

用法：
  uv run python -m screener.aleabit_scan          # 全量
  uv run python -m screener.aleabit_scan --limit 5  # 限制只数（测试用）
  uv run python -m screener.aleabit_scan --force  # 强制重跑已存在的
  uv run python -m screener.aleabit_scan --theme Layer4_关键金属  # 只跑某 theme
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
CANDIDATES_PATH = ROOT / "data" / "aleabit_candidates.json"
ANALYSES_DIR = ROOT / "data" / "analyses"
LOG_PATH = Path("/tmp/aleabit_scan.log")


# 适配 candidate dict（不需要 snap）的 aleabit prompt
_PROMPT = """你是 Serenity (@aleabitoreddit, "WSB Trader Serenity") 的 AI 化身。
bio: "trading unknown bottlenecks"。YTD 3840%。已被验证早于市场的调用：$AXTI / $SIVE / $IQE / $RPI / $EWY / $SNDK / $AAOI / $SOI / $LPK。

# 框架

**四层供应链**：
- Layer 1: 终端 AI（NVDA / GOOGL / AVGO）— crowded
- Layer 2: 模块 / 接口（HBM / 光模块 / 内存）
- Layer 3: 关键工艺 / 子组件（SIVE / IQE / LPK）— 主战场
- Layer 4: 原材料 / 物料控制点（AXTI / SOI / 7N Indium）— 最爱

**7 chokepoint 信号**：
1. 供应链汇聚（多个头部都依赖这家小公司）
2. 原材料价格创 ATH 但下游股没反应
3. 分析师覆盖率 < 3
4. 技术深度门槛（ChatGPT 解释不清）
5. 政府 / CHIPS / 国防 / 出口管制
6. CEO 在二级市场亲自买
7. 市值 $500M-$5B + 关键产能

# 评估对象

- **公司**：{name}（{code}.SH/SZ）
- **市值**：{mcap_yi} 亿 RMB（约 ${mcap_usd_b:.1f}B）
- **PE TTM** / **PB**：{pe_ttm} / {pb}
- **粗筛 theme**：{themes}
- **粗筛预期层级**：Layer {expected_layer}

# 任务

基于你对该 A 股公司业务的训练知识（公开财报、新闻、行业报告），严格按 Serenity 瓶颈狙击框架评估。
**不要用价投 / 段巴框架**——她不在乎 ROE / 护城河 / 估值，她在乎"是不是市场还没定价的关键节点"。

判断 verdict（必选一个）：
- `high_conviction`：🎯 完美命中，Layer 3-4 + 5+ 信号
- `worth_watching`：💎 4-5 信号
- `macro_tailwind`：🌊 宏观叙事相符但不完美（市值过大）
- `aleabit_analogue`：🪞 中国版她的美股标的（如华锡之于 $AXTI）
- `crowded_but_valid`：🚦 thesis 有效但已被市场充分发现
- `not_aleabit_territory`：❌ 完全不在射程

A 股语境下，市值上限放宽到 1000 亿 RMB ≈ $140B 也算"小盘"（西方资本进不来 → 信息不对称是 alpha）。

# 输出（严格 JSON，不要前后文字、不要 ```）

{{
  "supply_chain_layer": 1-4 或 null,
  "layer_label": "Layer X — ...",
  "bottleneck_score": 0-100,
  "verdict": "...",
  "verdict_label": "emoji + 中文短语",
  "thesis": "Serenity 口吻 2-3 句，英文短句 + 关键 ticker 引用风格",
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
  "ai_relevance": "和 AI 资本支出供应链的关联，一句话"
}}"""


def analyze_one(candidate: dict) -> dict:
    """对单只 candidate 调 LLM 做 aleabit 分析。"""
    from llm.glm_client import chat, _extract_json

    mcap_yi = candidate.get("market_cap_yi") or 0
    mcap_usd_b = mcap_yi / 7.2 / 10  # 亿 RMB → $B

    prompt = _PROMPT.format(
        name=candidate["name"],
        code=candidate["code"],
        mcap_yi=mcap_yi,
        mcap_usd_b=mcap_usd_b,
        pe_ttm=candidate.get("pe_ttm") or "—",
        pb=candidate.get("pb") or "—",
        themes=", ".join(candidate.get("themes", [])),
        expected_layer=candidate.get("expected_layer", "?"),
    )

    raw = chat(
        messages=[
            {"role": "system",
             "content": "你是 Serenity 的 AI 化身，严格 JSON 输出瓶颈狙击分析。"},
            {"role": "user", "content": prompt},
        ],
        max_tokens=3000,
        temperature=0.5,
    )

    return json.loads(_extract_json(raw))


def load_existing_analysis(code: str) -> dict | None:
    p = ANALYSES_DIR / f"{code}_a.json"
    if not p.exists():
        return None
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def save_analysis(code: str, candidate: dict, aleabit_result: dict):
    """把 aleabit 字段写到 data/analyses/{code}_a.json。
    如果文件不存在，创建一个最小结构。
    如果存在，只 merge aleabit 字段。
    """
    p = ANALYSES_DIR / f"{code}_a.json"
    existing = load_existing_analysis(code)
    if existing is None:
        existing = {
            "code": code,
            "name": candidate["name"],
            "market": "a",
            "industry": None,
            "sector": candidate.get("themes", [""])[0] if candidate.get("themes") else "",
            "concepts": [],
            "overall_score": 0,
            "overall_grade": "未评估",
            "verdict": "（仅 Serenity 视角，未做段巴 BG 评估）",
            "llm_used": True,
            "llm_model": "aleabit-scan",
            "dimensions": {
                "business_model": {"score": 0, "grade": "—", "details": [], "flags": []},
                "moat": {"score": 0, "grade": "—", "details": [], "flags": []},
                "management": {"score": 0, "grade": "—", "details": [], "flags": []},
                "financials": {"score": 0, "grade": "—", "details": [], "flags": []},
                "valuation": {"score": 0, "grade": "—", "details": [], "flags": []},
                "circle": {"score": 0, "grade": "—", "details": [], "flags": []},
            },
            "raw_quote": {
                "code": code,
                "name": candidate["name"],
                "market_cap": (candidate.get("market_cap_yi") or 0) * 1e8,
                "pe_ttm": candidate.get("pe_ttm"),
                "pb": candidate.get("pb"),
            },
            "sell_triggers": [],
            "updated_at": datetime.now().isoformat(),
        }

    aleabit_result["updated_at"] = datetime.now().isoformat()
    existing["aleabit"] = aleabit_result
    existing["updated_at"] = datetime.now().isoformat()

    ANALYSES_DIR.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(existing, f, ensure_ascii=False, indent=2)


def log(msg: str):
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只跑前 N 只（0=全部）")
    ap.add_argument("--force", action="store_true", help="强制重跑已有 aleabit 的")
    ap.add_argument("--theme", default="", help="只跑某 theme（部分匹配）")
    ap.add_argument("--sleep", type=float, default=2.0, help="每只之间 sleep 秒数")
    ap.add_argument("--max-retries", type=int, default=2, help="单只失败最多重试")
    args = ap.parse_args()

    if not CANDIDATES_PATH.exists():
        print(f"❌ 候选文件不存在：{CANDIDATES_PATH}")
        print(f"   先跑：uv run python -m screener.aleabit_candidates")
        sys.exit(1)

    with open(CANDIDATES_PATH, encoding="utf-8") as f:
        candidates = json.load(f)

    if args.theme:
        candidates = [c for c in candidates if any(args.theme in t for t in c.get("themes", []))]
        log(f"按 theme 过滤后：{len(candidates)} 只")

    if args.limit > 0:
        candidates = candidates[:args.limit]
        log(f"limit 后：{len(candidates)} 只")

    log("=" * 60)
    log(f"🚀 启动 aleabit 扫描，共 {len(candidates)} 只候选")
    log(f"   --force={args.force} --sleep={args.sleep}s")
    log("=" * 60)

    stats = {"ok": 0, "skip": 0, "fail": 0}
    t_start = time.time()

    for i, cand in enumerate(candidates, 1):
        code = cand["code"]
        name = cand["name"]

        # 检查 skip
        if not args.force:
            existing = load_existing_analysis(code)
            if existing and existing.get("aleabit"):
                log(f"[{i:3d}/{len(candidates)}] {code} {name:<10} ⏭ skip (已有 aleabit)")
                stats["skip"] += 1
                continue

        # 跑 GLM
        last_err = None
        result = None
        for attempt in range(args.max_retries + 1):
            t0 = time.time()
            try:
                result = analyze_one(cand)
                dt = time.time() - t0
                score = result.get("bottleneck_score", "—")
                verdict = result.get("verdict_label", "—")
                log(f"[{i:3d}/{len(candidates)}] {code} {name:<10} ✓ {dt:>5.1f}s | score {score:>3} | {verdict}")
                break
            except Exception as e:
                last_err = e
                if attempt < args.max_retries:
                    log(f"[{i:3d}/{len(candidates)}] {code} {name:<10} ⚠ attempt {attempt+1} 失败：{str(e)[:80]}")
                    time.sleep(5)
                else:
                    log(f"[{i:3d}/{len(candidates)}] {code} {name:<10} ✗ 放弃：{str(e)[:80]}")

        if result:
            try:
                save_analysis(code, cand, result)
                stats["ok"] += 1
            except Exception as e:
                log(f"  ⚠ save 失败 {code}: {e}")
                stats["fail"] += 1
        else:
            stats["fail"] += 1

        # 进度统计
        elapsed = time.time() - t_start
        avg = elapsed / i
        eta = avg * (len(candidates) - i)
        if i % 10 == 0:
            log(f"  📊 进度 {i}/{len(candidates)} | ok={stats['ok']} skip={stats['skip']} fail={stats['fail']} | 已耗时 {elapsed/60:.1f}min | ETA {eta/60:.1f}min")

        time.sleep(args.sleep)

    log("=" * 60)
    log(f"✅ 完成：ok={stats['ok']} skip={stats['skip']} fail={stats['fail']}")
    log(f"   总耗时：{(time.time()-t_start)/60:.1f} 分钟")
    log("=" * 60)


if __name__ == "__main__":
    main()
