"""五神对决 V2 —— 每日 LLM 决策层(NDT 中转 gpt-5.5)。

跑在 20:30 北京(= 08:30 ET 开盘前,premarket_job):每位股神看一遍自己的持仓 +
最新盘报 + 候选池,在授权范围内提交当日调仓单 → arena_orders(status=pending)。
当晚收盘(次日 05:00 北京)arena_engine 按收盘价撮合;有 AI 单的股神跳过规则自动补仓。

铁律:
- 机械止损永远由引擎执行,AI 无权豁免(风控地板)
- BUY 只能从"他评分 ≥ 阈值"的候选里挑(人设完整性),引擎二次校验
- 任何一位调用失败 → 该股神当日回退 V1 规则,产线不断
- NDT 通道:/v1/responses 且必须 stream:true(2026-06 实测非流式一律 MODEL_NOT_AVAILABLE)

成本:每天 5 次调用,合计 ~2-3 万 token。
"""
from __future__ import annotations
import argparse, json, re, sqlite3, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass
import os

DB = ROOT / "data" / "leslie.db"
ET = timezone(timedelta(hours=-4))
NDT_BASE = (os.environ.get("NDT_BASE_URL") or "https://api.nadoutong.org").rstrip("/")
NDT_KEY = os.environ.get("NDT_API_KEY") or ""
MODEL = "gpt-5.5"

# 与 arena_engine.RULES 同步(授权范围写进提示词,引擎照此校验)
RULES = {
    "buffett":       dict(min_score=72, slots=8,  weight=12,   stop=None),
    "duan":          dict(min_score=78, slots=4,  weight=24,   stop=None),
    "serenity":      dict(min_score=75, slots=10, weight=9.5,  stop=-15),
    "druckenmiller": dict(min_score=62, slots=8,  weight=11.5, stop=-10),
    "sentiment":     dict(min_score=58, slots=6,  weight=15,   stop=-7),
}


def ndt(prompt: str, retries: int = 1) -> str:
    """NDT /v1/responses 流式调用,返回纯文本。"""
    body = {"model": MODEL, "stream": True, "input": prompt}
    for attempt in range(retries + 1):
        try:
            with requests.post(f"{NDT_BASE}/v1/responses",
                               headers={"Authorization": f"Bearer {NDT_KEY}",
                                        "Content-Type": "application/json"},
                               json=body, stream=True, timeout=300) as r:
                r.raise_for_status()
                r.encoding = "utf-8"  # SSE 无 charset 头时 requests 按 Latin-1 解,中文必乱码(6/11 踩过)
                out = []
                for line in r.iter_lines(decode_unicode=True):
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        j = json.loads(data)
                    except ValueError:
                        continue
                    t = j.get("type", "")
                    if t == "response.output_text.delta":
                        out.append(j.get("delta") or "")
                    elif t in ("response.failed", "error"):
                        raise RuntimeError(str(j)[:300])
                text = "".join(out).strip()
                if text:
                    return text
                raise RuntimeError("空回复")
        except Exception as e:
            if attempt >= retries:
                raise
            print(f"   ↻ 调用失败({e}),30s 后重试…")
            time.sleep(30)
    return ""


def parse_orders(text: str) -> dict | None:
    """容错提取 JSON:取第一个 { 到最后一个 }。"""
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        j = json.loads(m.group(0))
        return j if isinstance(j.get("orders"), list) else None
    except ValueError:
        return None


def market_context() -> str:
    """最新两篇盘报(tone + 正文截断)+ 今日前瞻 → 市场背景块。"""
    parts = []
    try:
        arr = json.loads((ROOT / "web/public/data/reports.json").read_text(encoding="utf-8"))
        arr = arr if isinstance(arr, list) else arr.get("reports", [])
        for r in arr[:2]:
            body = re.sub(r"\n{2,}", "\n", r.get("body", ""))[:1100]
            parts.append(f"《{r.get('title','')}》({r.get('timeET','')})\n一句话:{r.get('tone','')}\n{body}")
    except Exception:
        pass
    try:
        ahead = json.loads((ROOT / "data/cards/ahead.json").read_text(encoding="utf-8"))
        today = datetime.now(ET).strftime("%Y-%m-%d")
        horizon = (datetime.now(ET) + timedelta(days=7)).strftime("%Y-%m-%d")
        evs = [f"{m['date']} {m['name']}({m.get('detail','')})" for m in ahead if today <= str(m.get("date", "")) <= horizon]
        if evs:
            parts.append("近期确定性大事:" + " · ".join(evs))
    except Exception:
        pass
    return "\n\n".join(parts) or "(暂无盘报)"


def build_prompt(mk: str, name: str, persona: str, ctx: str, date: str,
                 cash: float, nav: float, pos_lines: list[str], cand_lines: list[str]) -> str:
    r = RULES[mk]
    stop_line = f"- 机械止损 {r['stop']}% 由引擎自动执行,不归你管,你也无权取消\n" if r["stop"] else ""
    return f"""你是{name},在进行一场公开的虚拟实盘对决(起步 $1,000,000)。你的投资哲学:
{persona}

今天是 {date}(美东),开盘前。你的账户:NAV ${nav:,.0f},现金 ${cash:,.0f}。

【市场背景(来自每日盘报)】
{ctx}

【你的当前持仓】
{chr(10).join(pos_lines) if pos_lines else "(空仓)"}

【可买候选】(只能从这里买;均为你此前深度判读过、评分 ≥{r['min_score']} 的票)
{chr(10).join(cand_lines) if cand_lines else "(无)"}

【授权范围(引擎强制校验,越权单会被拒)】
- 最多 {r['slots']} 仓,每仓约 {r['weight']}% NAV,整仓买卖
- SELL 只能卖当前持仓;BUY 只能买候选列表里的票
{stop_line}- 什么都不做是完全合法的选择(尤其当你的哲学要求按兵不动)

按你的哲学决定今天的操作,数量不限(0 到多笔)。**只输出 JSON,不要任何其他文字**:
{{"orders":[{{"action":"BUY|SELL|HOLD","sym":"代码(HOLD 时为空)","reason":"一句话理由,你的口吻,中文"}}],"note":"你对当下市场的一句总评,中文"}}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="已有当日单也重新决策(覆盖 pending)")
    ap.add_argument("--only", default="", help="只跑某位股神(调试)")
    args = ap.parse_args()
    if not NDT_KEY:
        sys.exit("缺 NDT_API_KEY(.env)")

    fill_date = datetime.now(ET).strftime("%Y-%m-%d")  # 20:30 北京 = 08:30 ET 同一交易日
    cx = sqlite3.connect(DB)
    cx.execute("""CREATE TABLE IF NOT EXISTS arena_orders(
        id INTEGER PRIMARY KEY AUTOINCREMENT, fill_date TEXT, master TEXT, action TEXT,
        sym TEXT, reason TEXT, status TEXT DEFAULT 'pending', note TEXT)""")

    masters = {m["key"]: m for m in json.loads((ROOT / "data/masters.json").read_text(encoding="utf-8"))["masters"]}
    ctx = market_context()
    uni: dict[str, dict] = {}
    for sym, name_, price, pct, data in cx.execute(
            "SELECT m.sym, m.name, m.price, m.pct, a.data FROM us_market m "
            "JOIN us_analyses a ON a.sym=m.sym WHERE m.price>=2 AND m.mcapB>=0.2"):
        try:
            panel = json.loads(data).get("panel") or {}
        except Exception:
            continue
        uni[sym] = {"name": name_, "price": price, "pct": pct or 0, "panel": panel}

    for mk, rule in RULES.items():
        if args.only and mk != args.only:
            continue
        name = masters[mk]["name"]
        had = cx.execute("SELECT COUNT(*) FROM arena_orders WHERE master=? AND fill_date=?", (mk, fill_date)).fetchone()[0]
        if had and not args.force:
            print(f"· {name} {fill_date} 已有 {had} 单,跳过")
            continue
        if had:
            cx.execute("DELETE FROM arena_orders WHERE master=? AND fill_date=? AND status='pending'", (mk, fill_date))

        cash = (cx.execute("SELECT cash FROM arena_state WHERE master=?", (mk,)).fetchone() or [1_000_000])[0]
        pos, pos_lines = {}, []
        for sym, sh, ep, ed in cx.execute(
                "SELECT sym, shares, entry_price, entry_date FROM arena_positions WHERE master=?", (mk,)):
            u = uni.get(sym)
            px = u["price"] if u else ep
            jd = str((u["panel"].get(mk) or {}).get("judgment") or "")[:55] if u else ""
            pos[sym] = sh
            pos_lines.append(f"- {sym} {u['name'][:18] if u else sym} {sh}股 成本${ep:.2f} 现价${px:.2f} "
                             f"盈亏{(px/ep-1)*100:+.1f}%(你当时的判词:{jd})")
        nav = cash + sum(sh * (uni.get(s, {}).get("price") or 0) for s, sh in pos.items())

        cands = []
        for sym, u in uni.items():
            if sym in pos:
                continue
            v = u["panel"].get(mk) or {}
            try:
                sc = float(v.get("score"))
            except (TypeError, ValueError):
                continue
            if sc >= rule["min_score"]:
                cands.append((sc, sym, u, str(v.get("judgment") or "")[:55]))
        cands.sort(key=lambda x: (-x[0], x[1]))
        cand_lines = [f"- {sym} {u['name'][:18]} ${u['price']:.2f} 昨日{u['pct']:+.1f}% 你的评分{sc:.0f}(判词:{jd})"
                      for sc, sym, u, jd in cands[:15]]

        prompt = build_prompt(mk, name, masters[mk]["prompt"], ctx, fill_date, cash, nav, pos_lines, cand_lines)
        print(f"▶ {name}(prompt {len(prompt)} 字)…")
        try:
            text = ndt(prompt)
        except Exception as e:
            print(f"   ✗ 调用失败,当日回退规则引擎: {e}")
            continue
        j = parse_orders(text)
        if not j:
            print(f"   ✗ JSON 解析失败,回退规则。原文片段: {text[:120]!r}")
            continue

        cand_syms = {sym for _, sym, _, _ in cands[:15]}
        n_ok = 0
        for o in j["orders"][:10]:
            action = str(o.get("action", "")).upper()
            sym = str(o.get("sym", "") or "").upper().strip()
            reason = str(o.get("reason", ""))[:140]
            if action not in ("BUY", "SELL", "HOLD"):
                continue
            if action == "BUY" and sym not in cand_syms:
                print(f"   ⚠ 越权 BUY {sym},丢弃")
                continue
            if action == "SELL" and sym not in pos:
                print(f"   ⚠ SELL 未持有 {sym},丢弃")
                continue
            cx.execute("INSERT INTO arena_orders(fill_date,master,action,sym,reason) VALUES(?,?,?,?,?)",
                       (fill_date, mk, action, sym if action != "HOLD" else "", reason))
            n_ok += 1
        note = str(j.get("note", ""))[:200]
        print(f"   ✓ {n_ok} 单入册 · 总评: {note[:60]}")
        for o in j["orders"][:10]:
            print(f"     {o.get('action','?'):4s} {str(o.get('sym','') or ''):6s} {str(o.get('reason',''))[:64]}")
        cx.commit()
        time.sleep(8)  # NDT 节流

    cx.close()
    print("✅ 大脑决策完成(收盘时由 arena_engine 撮合)")


if __name__ == "__main__":
    main()
