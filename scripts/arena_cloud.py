"""五神对决 · 云端版 —— 状态全 JSON,跑在 GitHub Actions,脱离本地机器。

  python scripts/arena_cloud.py brain    # 开盘前决策(08:30 ET cron):NDT gpt-5.5,写 pending 单
  python scripts/arena_cloud.py engine   # 收盘撮合(20:20 ET cron):机械止损→AI 单→结账→arena.json

状态 = data/arena-state.json(git 即审计日志);行情输入全部来自仓库里随每日 refresh
提交的 JSON(us-stocks / us-analyses / price-history-30d / reports / ahead)。
实时盘前报价走已部署的 Vercel /api/quote(GH 机房直连 Nasdaq 会被拦,自家 API 是验证通路)。

规则、台词、提示词与本地版同源(import 自 arena_engine / arena_brain),绝不分叉。
单写者:本地 refresh 已不再跑引擎;谁拥有 arena-state.json,谁就是唯一记账人(= 这里)。
"""
from __future__ import annotations
import json, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
STATE = ROOT / "data" / "arena-state.json"
# DST 正确(夏令时 -4 / 冬令时 -5),与 cloud_price_refresh.py 同源;GH ubuntu runner 自带 tzdata。
# 旧的硬编码 timezone(-4) 在冬令时会把 today_et 算错,午夜边界尤危(虽 00:20 UTC 跑时影响小)。
ET = ZoneInfo("America/New_York")

from arena_engine import RULES, SELL_VOICE, MASTERS, START_CASH          # noqa: E402
from arena_brain import (RULES as BRAIN_RULES, ndt, parse_orders,        # noqa: E402
                         build_prompt, market_context)

import os, re                                                            # noqa: E402
QUOTE_API = os.environ.get("QUOTE_API", "https://stockgod.xyz/api/quote")

# 市场配置:美股(默认,与原版逐字节一致)+ A 股(独立平行赛场,¥ 现金、北京时区、读 a-* JSON)。
# 逻辑(规则/撮合/AI单/止损/拆股/结账)全市场共用、绝不分叉 —— 只换"读哪些文件 / 时区 / 写哪个输出"。
A_START_CASH = 1_000_000.0  # ¥,与美股 $100万 对称(数值同,币种仅前端显示区分)
CHASE_PCT = 9.0  # 入场纪律:今日涨幅 > 此值(接近 A 股涨停/美股大幅爆拉)的票,规则补仓不追(brain 由 prompt 自行判)
MARKETS = {
    "us": dict(mkt="us", state="arena-state.json",   out="arena.json",   hist="price-history-30d.json",   tz=ET,                         ccy="$"),
    "a":  dict(mkt="a",  state="arena-state-a.json", out="arena-a.json", hist="a-price-history-30d.json", tz=ZoneInfo("Asia/Shanghai"), ccy="¥"),
}
MK = MARKETS["us"]  # main() 按命令行第 2 个参数(us|a)覆盖,同时覆盖 STATE


# ---------------- 状态 ----------------
def load_state() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {"cash": {mk: START_CASH for mk, _, _ in MASTERS},
            "positions": [], "nav": [], "trades": [], "orders": [], "next_order_id": 1}


def save_state(st: dict) -> None:
    STATE.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")


# ---------------- 行情输入(仓库 JSON)----------------
def load_a_uni(hist: dict) -> dict[str, dict]:
    """A 股宇宙:a-analyses(五方分+判词,同 us-analyses 结构)× a-price-history 最新收盘当价(结算用)。
    流动性闸:收盘价 ≥¥2 且市值 ≥¥20亿(≈$0.28B,与美股 $0.2B 闸对称)。pct 由最近两日收盘算。"""
    ana = json.loads((PUB / "a-analyses.json").read_text(encoding="utf-8"))
    ana = ana.get("stocks", ana)
    dates = hist["dates"]; last = dates[-1]; prev = dates[-2] if len(dates) > 1 else last
    uni: dict[str, dict] = {}
    for code, v in ana.items():
        if not re.match(r"^\d{6}$", code):
            continue
        cl = hist["closes"].get(code) or {}
        px = cl.get(last)
        cap = v.get("cap") or 0  # 亿¥
        if not px or px < 2 or cap < 20:
            continue
        pv = cl.get(prev) or px
        pct = (px / pv - 1) * 100 if pv else 0.0
        panel = v.get("panel") or {}
        scores, judgments = {}, {}
        for mk, _, _ in MASTERS:
            mm = panel.get(mk) or {}
            try:
                scores[mk] = float(mm.get("score"))
            except (TypeError, ValueError):
                scores[mk] = None
            judgments[mk] = str(mm.get("judgment") or "")[:90]
        uni[code] = {"name": v.get("name", code), "price": float(px), "pct": pct, "scores": scores, "judgments": judgments}
    return uni


def load_inputs():
    hist = json.loads((PUB / MK["hist"]).read_text(encoding="utf-8"))
    if MK["mkt"] == "a":
        return hist, load_a_uni(hist)
    us = {s["sym"]: s for s in json.loads((PUB / "us-stocks.json").read_text(encoding="utf-8"))["stocks"]}
    ana = json.loads((PUB / "us-analyses.json").read_text(encoding="utf-8"))["stocks"]
    uni: dict[str, dict] = {}
    for sym, v in ana.items():
        m = us.get(sym)
        if not m or (m.get("price") or 0) < 2 or (m.get("mcapB") or 0) < 0.2:
            continue
        panel = v.get("panel") or {}
        scores, judgments = {}, {}
        for mk, _, _ in MASTERS:
            mm = panel.get(mk) or {}
            try:
                scores[mk] = float(mm.get("score"))
            except (TypeError, ValueError):
                scores[mk] = None
            judgments[mk] = str(mm.get("judgment") or "")[:90]
        uni[sym] = {"name": m.get("name", sym), "price": float(m["price"]), "pct": float(m.get("pct") or 0),
                    "scores": scores, "judgments": judgments}
    return hist, uni


def momentum20(hist: dict, sym: str) -> float | None:
    cl = hist["closes"].get(sym)
    if not cl:
        return None
    ds = sorted(cl)
    if len(ds) < 21:
        return None
    a, b = cl[ds[-21]], cl[ds[-1]]
    return (b / a - 1) * 100 if a else None


def held_days(hist: dict, entry_date: str, upto: str) -> int:
    return sum(1 for d in hist["dates"] if entry_date < d <= upto)


def candidates(mk: str, uni: dict, hist: dict, exclude: set[str]) -> list[str]:
    rule = RULES[mk]
    out = []
    for sym, u in uni.items():
        if sym in exclude:
            continue
        sc = u["scores"].get(mk)
        if sc is None or sc < rule["min_score"]:
            continue
        if rule.get("need_momo"):
            mo = momentum20(hist, sym)
            if mo is None or mo <= 0:
                continue
        out.append(sym)
    if rule.get("rank_by_pct"):
        out.sort(key=lambda s: (-uni[s]["pct"], s))
    else:
        out.sort(key=lambda s: (-(uni[s]["scores"][mk] or 0), s))
    return out


# ---------------- 引擎(收盘撮合)----------------
def run_engine() -> None:
    hist, uni = load_inputs()
    date = hist["dates"][-1]
    today_et = datetime.now(MK["tz"]).strftime("%Y-%m-%d")  # 美股=ET、A股=北京
    st = load_state()

    if any(n["date"] == date for n in st["nav"]):
        print(f"· {date} 已结账,只重导出 arena.json")
        export(st, uni, date)
        return
    if date != today_et:
        print(f"⚠ 行情最新日 {date} ≠ 今日 {today_et}(假日/本地 refresh 未跑)→ 不撮合,只导出")
        export(st, uni, date)
        return

    pos_by = {}
    for p in st["positions"]:
        pos_by.setdefault(p["master"], {})[p["sym"]] = p

    for mk, _, _ in MASTERS:
        rule = RULES[mk]
        cash = st["cash"].get(mk, START_CASH)
        pos = pos_by.get(mk, {})

        def sell(sym, p, reason, src):
            nonlocal cash
            px = uni.get(sym, {}).get("price")
            if px is None:
                return False
            cash += p["shares"] * px
            st["positions"].remove(p)
            del pos[sym]
            st["trades"].append({"date": date, "master": mk, "side": "SELL", "sym": sym,
                                 "shares": p["shares"], "price": round(px, 4), "reason": reason, "src": src})
            return True

        # ⓪ 拆股/并股自愈:前一交易日收盘与现价量级断裂、但官方当日涨跌正常 → 公司行动,
        #    按整数比例调账(NAV 不变),当日豁免止损/动量 —— KLAC 2026-06-12 10:1 拆股差点被当 -89% 误砍
        #    幂等台账 st["splits"]:同一 sym 25 天内已调过就跳过(防手工+引擎/多日重复 ×10,2026-06-12 踩过)
        from datetime import date as _date
        def _within(d1: str, d2: str, n: int) -> bool:
            try:
                a = _date.fromisoformat(d1); b = _date.fromisoformat(d2)
                return abs((a - b).days) <= n
            except Exception:
                return False
        ledger = st.setdefault("splits", [])
        recent = {(s["sym"], s.get("master")) for s in ledger if _within(s.get("date", ""), date, 25)}
        split_adjusted: set[str] = set()
        for sym, p in list(pos.items()):
            if (sym, mk) in recent:                 # 该股该 master 近期已调账,绝不重复
                continue
            u = uni.get(sym)
            cl = hist["closes"].get(sym) or {}
            ds = sorted(cl)
            if not u or len(ds) < 2 or abs(u["pct"]) >= 25:
                continue
            prev2 = cl[ds[-2]]
            if not prev2 or not u["price"]:
                continue
            k_float = prev2 / u["price"] * (1 + u["pct"] / 100)
            if k_float >= 1.8:                      # 正向拆股(如 10:1)
                k = round(k_float)
                if k >= 2 and abs(k_float - k) / k < 0.08:
                    p["shares"] = p["shares"] * k
                    p["entry"] = round(p["entry"] / k, 4)
                    split_adjusted.add(sym)
                    ledger.append({"sym": sym, "date": date, "k": k, "master": mk})
                    st.setdefault("notes", []).append({"date": date, "event": f"{sym} {k}:1 拆股自动调账({mk})"})
            elif k_float <= 0.4:                    # 并股(如 1:10)
                k = round(1 / k_float)
                if k >= 3 and abs(1 / k_float - k) / k < 0.08 and p["shares"] >= k:
                    p["shares"] = p["shares"] // k
                    p["entry"] = round(p["entry"] * k, 4)
                    split_adjusted.add(sym)
                    ledger.append({"sym": sym, "date": date, "k": -k, "master": mk})
                    st.setdefault("notes", []).append({"date": date, "event": f"{sym} 1:{k} 并股自动调账({mk})"})

        # ① 机械纪律(风控地板,AI 无权豁免;拆并股当日豁免——历史序列被断裂污染)
        for sym, p in list(pos.items()):
            if sym in split_adjusted:
                continue
            u = uni.get(sym)
            if not u:
                continue
            px = u["price"]
            pnl = (px / p["entry"] - 1) * 100
            held = held_days(hist, p["entry_date"], date)
            sc = u["scores"].get(mk)
            reason = None
            if rule.get("stop") is not None and pnl <= rule["stop"]:
                reason = SELL_VOICE["stop"][mk].format(pnl=pnl)
            elif rule.get("take") is not None and pnl >= rule["take"]:
                reason = SELL_VOICE["take"][mk].format(pnl=pnl)
            elif rule.get("max_hold") is not None and held >= rule["max_hold"]:
                reason = SELL_VOICE["time"][mk].format(days=held, pnl=pnl)
            elif rule.get("sell_score") is not None and sc is not None and sc < rule["sell_score"]:
                reason = SELL_VOICE["score"][mk]
            elif rule.get("momo_exit") is not None:
                mo = momentum20(hist, sym)
                if mo is not None and mo <= rule["momo_exit"]:
                    reason = SELL_VOICE["momo"][mk]
            if reason:
                sell(sym, p, reason, "rule")

        # ② AI 决策单(SELL 先腾现金;过期单作废)
        ai_rows = sorted([o for o in st["orders"] if o["master"] == mk and o["status"] == "pending"],
                         key=lambda o: ({"SELL": 0, "BUY": 1}.get(o["action"], 2), o["id"]))
        ai_mode = False
        for o in ai_rows:
            if o["fill_date"] != date:
                o["status"], o["note"] = "expired", f"撮合日 {date} ≠ 下单日 {o['fill_date']}"
                continue
            ai_mode = True
            o["status"], o["note"] = "filled", ""
            if o["action"] == "HOLD":
                continue
            if o["action"] == "SELL":
                p = pos.get(o["sym"])
                if not p or not sell(o["sym"], p, o["reason"], "ai"):
                    o["status"], o["note"] = "rejected", "未持有或无行情(可能已被机械止损)"
            elif o["action"] == "BUY":
                sym = o["sym"]
                u = uni.get(sym)
                sc = (u or {}).get("scores", {}).get(mk)
                nav_now = cash + sum(p["shares"] * uni.get(p["sym"], {"price": p["entry"]})["price"] for p in pos.values())
                if sym in pos:
                    o["status"], o["note"] = "rejected", "已持有"
                elif not u:
                    o["status"], o["note"] = "rejected", "无行情"
                elif sc is None or sc < rule["min_score"]:
                    o["status"], o["note"] = "rejected", "低于授权评分线"
                elif len(pos) >= rule["slots"]:
                    o["status"], o["note"] = "rejected", "仓位已满"
                else:
                    px = u["price"]
                    shares = int(min(nav_now * rule["weight"], cash) // px)
                    if shares < 1:
                        o["status"], o["note"] = "rejected", "现金不足一股"
                    else:
                        cash -= shares * px
                        np = {"master": mk, "sym": sym, "shares": shares, "entry": round(px, 4), "entry_date": date}
                        st["positions"].append(np)
                        pos[sym] = np
                        st["trades"].append({"date": date, "master": mk, "side": "BUY", "sym": sym,
                                             "shares": shares, "price": round(px, 4), "reason": o["reason"], "src": "ai"})

        # ③ 规则补仓(仅当今日无 AI 决策)
        nav_now = cash + sum(p["shares"] * uni.get(p["sym"], {"price": p["entry"]})["price"] for p in pos.values())
        free = rule["slots"] - len(pos)
        if free > 0 and not ai_mode:
            for sym in candidates(mk, uni, hist, exclude=set(pos)):
                if free == 0:
                    break
                if (uni[sym].get("pct") or 0) > CHASE_PCT:  # 入场纪律:别追今日爆拉的(接近涨停),没 AI 的日子也守住
                    continue
                px = uni[sym]["price"]
                shares = int(min(nav_now * rule["weight"], cash) // px)
                if shares < 1:
                    continue
                cash -= shares * px
                np = {"master": mk, "sym": sym, "shares": shares, "entry": round(px, 4), "entry_date": date}
                st["positions"].append(np)
                pos[sym] = np
                st["trades"].append({"date": date, "master": mk, "side": "BUY", "sym": sym,
                                     "shares": shares, "price": round(px, 4),
                                     "reason": uni[sym]["judgments"][mk] or "按纪律建仓", "src": "rule"})
                free -= 1

        # ④ 结账
        nav = cash + sum(p["shares"] * uni.get(p["sym"], {"price": p["entry"]})["price"] for p in pos.values())
        st["cash"][mk] = round(cash, 2)
        st["nav"].append({"master": mk, "date": date, "nav": round(nav, 2)})

    save_state(st)
    export(st, uni, date)


def export(st: dict, uni: dict, date: str) -> None:
    out = {"as_of": date, "start_cash": START_CASH, "masters": []}
    for mk, name, school in MASTERS:
        cash = st["cash"].get(mk, START_CASH)
        pos = []
        for p in (q for q in st["positions"] if q["master"] == mk):
            u = uni.get(p["sym"], {})
            px = u.get("price", p["entry"])
            pos.append({"sym": p["sym"], "name": u.get("name", p["sym"]), "shares": p["shares"],
                        "entry": round(p["entry"], 2), "price": round(px, 2),
                        "pnlPct": round((px / p["entry"] - 1) * 100, 2),
                        "dayPct": round(u["pct"], 2) if u.get("pct") is not None else None,
                        "since": p["entry_date"], "judgment": u.get("judgments", {}).get(mk, "")})
        pos.sort(key=lambda r: -r["shares"] * r["price"])
        hist = sorted((n for n in st["nav"] if n["master"] == mk), key=lambda n: n["date"])
        nav_hist = [{"date": n["date"], "nav": round(n["nav"])} for n in hist]
        nav = nav_hist[-1]["nav"] if nav_hist else START_CASH
        trades = [t | {} for t in st["trades"] if t["master"] == mk][-14:][::-1]
        trades = [{"date": t["date"], "side": t["side"], "sym": t["sym"], "shares": t["shares"],
                   "price": round(t["price"], 2), "reason": t["reason"], "src": t.get("src", "rule")} for t in trades]
        out["masters"].append({"key": mk, "name": name, "school": school, "cash": round(cash),
                               "nav": nav, "retPct": round((nav / START_CASH - 1) * 100, 2),
                               "positions": pos, "navHist": nav_hist, "trades": trades})
    out["masters"].sort(key=lambda m: -m["nav"])
    out["market"] = MK["mkt"]; out["ccy"] = MK["ccy"]
    (PUB / MK["out"]).write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"✓ arena.json @{date} · " + " · ".join(f"{m['name']} {m['retPct']:+.2f}%" for m in out["masters"]))


# ---------------- 大脑(开盘前决策)----------------
def lq_batch(syms: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for i in range(0, len(syms), 25):
        try:
            r = requests.get(QUOTE_API, params={"syms": ",".join(syms[i:i + 25])}, timeout=20)
            out.update(r.json().get("quotes") or {})
        except Exception:
            pass
        time.sleep(0.3)
    return out


def run_brain(force: bool = False) -> None:
    if not (os.environ.get("NDT_CLAUDE_KEY") or os.environ.get("NDT_API_KEY")):
        sys.exit("缺 NDT_CLAUDE_KEY / NDT_API_KEY")
    hist, uni = load_inputs()
    ccy = MK["ccy"]
    fill_date = datetime.now(MK["tz"]).strftime("%Y-%m-%d")  # 美股=ET、A股=北京
    st = load_state()
    if any(n["date"] == fill_date for n in st["nav"]):
        print(f"· {fill_date} 已结账,今天不再决策")
        return

    masters_def = {m["key"]: m for m in json.loads((ROOT / "data" / "masters.json").read_text(encoding="utf-8"))["masters"]}

    pos_by: dict[str, dict[str, dict]] = {}
    for p in st["positions"]:
        pos_by.setdefault(p["master"], {})[p["sym"]] = p
    cand_by: dict[str, list[str]] = {mk: candidates(mk, uni, hist, exclude=set(pos_by.get(mk, {})))[:15] for mk in RULES}

    if MK["mkt"] == "a":
        # A 股:无美股盘前 / 自家指数代理;以候选昨收 + 今日涨幅判当前价位(入场纪律在 prompt 强制)
        ctx = "(A 股盘报暂未接入;按候选的基本面/瓶颈成色 + 当前价位与今日涨幅自行判断入场。)"
        quotes: dict[str, dict] = {}
        tape = "(A 股开盘前 = 集合竞价;以候选昨收价 + 今日涨幅判断当前价位)"
        region = "北京"
    else:
        # 实时盘口(走自家 /api/quote):四指数 + 持仓 + 各家候选前 15
        ctx = market_context()
        want = {"QQQ", "SPY", "DIA", "IWM"} | {p["sym"] for p in st["positions"]}
        for cs in cand_by.values():
            want |= set(cs)
        quotes = lq_batch(sorted(want))
        zh = {"QQQ": "纳指", "SPY": "标普", "DIA": "道指", "IWM": "罗素"}
        now_et = datetime.now(ET).strftime("%H:%M ET")
        tape_bits = [f"{zh[s]} {quotes[s]['pct']:+.2f}%" for s in ("QQQ", "SPY", "DIA", "IWM") if s in quotes and quotes[s].get("pct") is not None]
        tape = f"({now_et} 实时)" + " · ".join(tape_bits) if tape_bits else "(盘前行情暂不可得)"
        region = "美东"
    print(f"盘口 {tape}")

    def lq(sym: str) -> str:
        q = quotes.get(sym)
        return f" 盘前{q['pct']:+.2f}%" if q and q.get("pct") is not None else ""

    for mk, rule in RULES.items():
        name = masters_def[mk]["name"]
        had = [o for o in st["orders"] if o["master"] == mk and o["fill_date"] == fill_date]
        if had and not force:
            print(f"· {name} {fill_date} 已有 {len(had)} 单,跳过")
            continue
        if had:
            st["orders"] = [o for o in st["orders"] if not (o["master"] == mk and o["fill_date"] == fill_date and o["status"] == "pending")]

        cash = st["cash"].get(mk, START_CASH)
        pos = pos_by.get(mk, {})
        pos_lines = []
        for sym, p in pos.items():
            u = uni.get(sym)
            px = u["price"] if u else p["entry"]
            jd = (u or {}).get("judgments", {}).get(mk, "")[:55]
            pos_lines.append(f"- {sym} {(u or {}).get('name', sym)[:18]} {p['shares']}股 成本{ccy}{p['entry']:.2f} 昨收{ccy}{px:.2f} "
                             f"盈亏{(px / p['entry'] - 1) * 100:+.1f}%{lq(sym)}(你当时的判词:{jd})")
        nav = cash + sum(p["shares"] * uni.get(s, {"price": p["entry"]})["price"] for s, p in pos.items())
        cand_lines = [f"- {sym} {uni[sym]['name'][:18]} 昨收{ccy}{uni[sym]['price']:.2f} 今日{uni[sym]['pct']:+.1f}%{lq(sym)} "
                      f"你的评分{uni[sym]['scores'][mk]:.0f}(判词:{uni[sym]['judgments'][mk]})"
                      for sym in cand_by[mk]]

        prompt = build_prompt(mk, name, masters_def[mk]["prompt"], ctx, fill_date, cash, nav, pos_lines, cand_lines, tape=tape, ccy=ccy, region=region)
        print(f"▶ {name}(prompt {len(prompt)} 字)…")
        try:
            text = ndt(prompt)
        except Exception as e:
            print(f"   ✗ 调用失败,当日回退规则引擎: {e}")
            continue
        j = parse_orders(text)
        if not j:
            print(f"   ✗ JSON 解析失败,回退规则。片段: {text[:100]!r}")
            continue
        n_ok = 0
        cset = set(cand_by[mk])
        for o in j["orders"][:10]:
            action = str(o.get("action", "")).upper()
            sym = str(o.get("sym", "") or "").upper().strip()
            reason = str(o.get("reason", ""))[:140]
            if action not in ("BUY", "SELL", "HOLD"):
                continue
            if action == "BUY" and sym not in cset:
                print(f"   ⚠ 越权 BUY {sym},丢弃")
                continue
            if action == "SELL" and sym not in pos:
                print(f"   ⚠ SELL 未持有 {sym},丢弃")
                continue
            st["orders"].append({"id": st["next_order_id"], "fill_date": fill_date, "master": mk,
                                 "action": action, "sym": sym if action != "HOLD" else "",
                                 "reason": reason, "status": "pending", "note": ""})
            st["next_order_id"] += 1
            n_ok += 1
        print(f"   ✓ {n_ok} 单入册 · 总评: {str(j.get('note', ''))[:60]}")
        for o in j["orders"][:10]:
            print(f"     {str(o.get('action', '?')):4s} {str(o.get('sym', '') or ''):6s} {str(o.get('reason', ''))[:64]}")
        save_state(st)
        time.sleep(8)

    save_state(st)
    print("✅ 大脑决策完成(收盘 cron 撮合)")


def main():
    sys.path.insert(0, str(ROOT / "scripts"))
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    global MK, STATE
    mkt = next((a for a in sys.argv[2:] if a in ("us", "a")), "us")  # 第2参数 us|a,默认 us(美股行为不变)
    MK = MARKETS[mkt]
    STATE = ROOT / "data" / MK["state"]
    if cmd == "engine":
        run_engine()
    elif cmd == "brain":
        run_brain(force="--force" in sys.argv)
    else:
        sys.exit("用法: arena_cloud.py {brain|engine} [us|a]")


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).parent))
    main()
