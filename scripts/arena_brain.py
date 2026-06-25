"""五神对决 V2 —— 每日 LLM 决策层(NDT 中转 gpt-5.5)。

跑在 20:30 北京(= 08:30 ET 开盘前,premarket_job):每位股神看一遍自己的持仓 +
最新盘报 + 候选池,在授权范围内提交当日调仓单 → arena_orders(status=pending)。
当晚收盘(次日 05:00 北京)arena_engine 按收盘价撮合;有 AI 单的股神跳过规则自动补仓。

铁律:
- 机械止损永远由引擎执行,AI 无权豁免(风控地板)
- BUY 只能从"他评分 ≥ 阈值"的候选里挑(人设完整性),引擎二次校验
- 任何一位调用失败 → 该股神当日回退 V1 规则,产线不断
- NDT 通道:Claude Opus 4.8 走 Anthropic 式 /v1/messages(非流式;原 gpt-5.5 走 /v1/responses 流式,2026-06-18 已换)

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
# 2026-06-18 五神决策从 gpt-5.5 换 Claude Opus 4.8(与盘报同模型、同 NDT Anthropic /v1/messages 通道)。
# Claude 走 NDT_CLAUDE_KEY(NDT 的 gpt key 不带 Claude);无该 key 时回退 NDT_API_KEY(届时调用失败→规则兜底)。
NDT_KEY = os.environ.get("NDT_CLAUDE_KEY") or os.environ.get("NDT_API_KEY") or ""
MODEL = "claude-opus-4-8"

# 与 arena_engine.RULES 同步(授权范围写进提示词,引擎照此校验)
RULES = {
    "buffett":       dict(min_score=72, slots=8,  weight=12,   stop=None),
    "duan":          dict(min_score=78, slots=4,  weight=24,   stop=None),
    "serenity":      dict(min_score=75, slots=10, weight=9.5,  stop=-15),
    "druckenmiller": dict(min_score=62, slots=8,  weight=11.5, stop=-10),
    "sentiment":     dict(min_score=58, slots=6,  weight=15,   stop=-7),
}


def ndt(prompt: str, retries: int = 1) -> str:
    """五神决策。优先 Claude Opus 4.8,它过载(MODEL_BUSY)或失败时自动降级 gpt-5.5
    —— 统一在 ndt_llm.llm 里:退避重试 + 双模型兜底。任一可用就有输出,不整批回退规则。"""
    from ndt_llm import llm
    return llm(prompt, max_tokens=4000)


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


NASDAQ_HDRS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}


def live_quote(sym: str, etf: bool = False) -> dict | None:
    """单票实时盘口:盘前/盘中 % + 最新价 + 时段标签(失败返回 None,不阻塞决策)。"""
    try:
        d = requests.get(f"https://api.nasdaq.com/api/quote/{sym}/info",
                         params={"assetclass": "etf" if etf else "stocks"},
                         headers=NASDAQ_HDRS, timeout=10).json()["data"]
        pri = d.get("primaryData") or {}
        pct = str(pri.get("percentageChange") or "").replace("%", "")
        px = str(pri.get("lastSalePrice") or "").replace("$", "").replace(",", "")
        status = str(d.get("marketStatus") or "")
        if pct in ("", "N/A", "--"):
            return None
        return {"pct": pct, "px": px, "status": status}
    except Exception:
        return None


def live_tape() -> str:
    """开盘前盘口一行:四指数 ETF 代理的盘前/实时变动 + 抓取时刻(ET)。"""
    bits = []
    for sym, label in [("QQQ", "纳指"), ("SPY", "标普"), ("DIA", "道指"), ("IWM", "罗素")]:
        q = live_quote(sym, etf=True)
        if q:
            bits.append(f"{label} {q['pct']}%")
    now_et = datetime.now(ET).strftime("%H:%M ET")
    return f"({now_et} 实时)" + " · ".join(bits) if bits else "(盘前行情暂不可得)"


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
        ahead = json.loads((ROOT / "web/public/data/ahead.json").read_text(encoding="utf-8"))
        today = datetime.now(ET).strftime("%Y-%m-%d")
        horizon = (datetime.now(ET) + timedelta(days=7)).strftime("%Y-%m-%d")
        evs = [f"{m['date']} {m['name']}({m.get('detail','')})" for m in ahead if today <= str(m.get("date", "")) <= horizon]
        if evs:
            parts.append("近期确定性大事:" + " · ".join(evs))
    except Exception:
        pass
    return "\n\n".join(parts) or "(暂无盘报)"


def build_prompt(mk: str, name: str, persona: str, ctx: str, date: str,
                 cash: float, nav: float, pos_lines: list[str], cand_lines: list[str],
                 tape: str = "", ccy: str = "$", region: str = "美东") -> str:
    r = RULES[mk]
    stop_line = f"- 机械止损 {r['stop']}% 由引擎自动执行,不归你管,你也无权取消\n" if r["stop"] else ""
    return f"""你是{name},在进行一场公开的虚拟实盘对决(起步 {ccy}1,000,000)。你的投资哲学:
{persona}

今天是 {date}({region}),开盘前。你的账户:NAV {ccy}{nav:,.0f},现金 {ccy}{cash:,.0f}。

【此刻盘前实时盘口】
{tape}
(持仓与候选行里的「盘前±x%」也是此刻实时数;若今晨有宏观数据公布,盘前价格的反应就是最诚实的解读)

【市场背景(来自每日盘报)】
{ctx}

【你的当前持仓】
{chr(10).join(pos_lines) if pos_lines else "(空仓)"}

【可买候选】(只能从这里买;均为你此前深度判读过、评分 ≥{r['min_score']} 的票)
{chr(10).join(cand_lines) if cand_lines else "(无)"}

【入场纪律 · 买之前必判(务必遵守)】
你的评分是当时对【生意/瓶颈】的判断,不代表【此刻这个价位】还值得买。看着候选的昨收价 + 今日/盘前涨幅判入场:
- 今天/盘前已经爆拉的(涨幅很大、接近涨停的),别接最后一棒 —— 要么等回落,要么直接放过(不买);
- 已经被市场充分定价、涨上来的,按你自己的风格判:你若是瓶颈狙击,问还在不在 pre-rerating 阶段(小盘、未被充分定价就上;已 rerate、机构拥挤的让);你若是价投,要安全边际、不为好生意付蠢价;你若是动量派,确认趋势还在、别接下跌的刀;
- 宁可空着仓位等好价,也不为"买满"去追高。不买是完全合法的。

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
    ap.add_argument("--dry", action="store_true", help="只打印决策,不写 arena_orders(试跑)")
    args = ap.parse_args()
    if not NDT_KEY:
        sys.exit("缺 NDT_CLAUDE_KEY(.env / GitHub secrets)")

    fill_date = datetime.now(ET).strftime("%Y-%m-%d")  # 20:30 北京 = 08:30 ET 同一交易日
    cx = sqlite3.connect(DB)
    cx.execute("""CREATE TABLE IF NOT EXISTS arena_orders(
        id INTEGER PRIMARY KEY AUTOINCREMENT, fill_date TEXT, master TEXT, action TEXT,
        sym TEXT, reason TEXT, status TEXT DEFAULT 'pending', note TEXT)""")

    masters = {m["key"]: m for m in json.loads((ROOT / "data/masters.json").read_text(encoding="utf-8"))["masters"]}
    ctx = market_context()
    tape = live_tape()
    print(f"盘口 {tape}")
    live_cache: dict[str, dict | None] = {}

    def lq(sym: str) -> str:
        """盘前实时片段(带缓存;失败给空串,绝不阻塞)。"""
        if sym not in live_cache:
            live_cache[sym] = live_quote(sym)
            time.sleep(0.12)
        q = live_cache[sym]
        return f" 盘前{q['pct']}%" if q else ""
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
        if had and not args.force and not args.dry:
            print(f"· {name} {fill_date} 已有 {had} 单,跳过")
            continue
        if had and args.force and not args.dry:
            cx.execute("DELETE FROM arena_orders WHERE master=? AND fill_date=? AND status='pending'", (mk, fill_date))

        cash = (cx.execute("SELECT cash FROM arena_state WHERE master=?", (mk,)).fetchone() or [1_000_000])[0]
        pos, pos_lines = {}, []
        for sym, sh, ep, ed in cx.execute(
                "SELECT sym, shares, entry_price, entry_date FROM arena_positions WHERE master=?", (mk,)):
            u = uni.get(sym)
            px = u["price"] if u else ep
            jd = str((u["panel"].get(mk) or {}).get("judgment") or "")[:55] if u else ""
            pos[sym] = sh
            pos_lines.append(f"- {sym} {u['name'][:18] if u else sym} {sh}股 成本${ep:.2f} 昨收${px:.2f} "
                             f"盈亏{(px/ep-1)*100:+.1f}%{lq(sym)}(你当时的判词:{jd})")
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
        cand_lines = [f"- {sym} {u['name'][:18]} 昨收${u['price']:.2f} 昨日{u['pct']:+.1f}%{lq(sym)} 你的评分{sc:.0f}(判词:{jd})"
                      for sc, sym, u, jd in cands[:15]]

        prompt = build_prompt(mk, name, masters[mk]["prompt"], ctx, fill_date, cash, nav, pos_lines, cand_lines, tape=tape)
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
            if not args.dry:
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
