"""五神对决 —— 5 位股神各 $1M 虚拟资金,从已判读股票池里按各自纪律每天交易。

SoT = leslie.db(arena_* 四张表),输出 web/public/data/arena.json。
refresh.py 抓完行情后、build_json 前调用;按 price_history 最新收盘日跑,幂等(同一天重复跑不动账)。

规则 V1(确定性、收盘成交、整股、无费用滑点 —— 页面公开此说明;非投资建议):
- 股票池:已判读 + 收盘价 ≥$2 + 市值 ≥$0.2B
- buffett        他评分≥72 取前 8,各 12% 仓;评分<60 才卖(≈长持)
- duan           ≥78 取前 4,各 24%;<70 卖(极度集中,几乎不动)
- serenity       ≥75 取前 10,各 9.5%;止损 -15% 或评分<60,卖后补位
- druckenmiller  ≥62 且 20日动量>0 取前 8,各 11.5%;止损 -10% 或动量<-5%
- sentiment      ≥58 按当日涨幅排前 6,各 15%;持有≥5 交易日 / 止损-7% / 止盈+15%
"""
from __future__ import annotations
import json, sqlite3, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
DB = ROOT / "data" / "leslie.db"
OUT = ROOT / "web" / "public" / "data" / "arena.json"
START_CASH = 1_000_000.0

MASTERS = [
    ("buffett", "巴菲特", "价值 · 护城河 · 长持"),
    ("duan", "段永平", "本分 · 极度集中"),
    ("serenity", "Serenity", "瓶颈狙击 · 带止损"),
    ("druckenmiller", "德鲁肯米勒", "宏观趋势 · 动量"),
    ("sentiment", "情绪资金面", "盘口轮动 · 快进快出"),
]

RULES = {
    "buffett":       dict(min_score=72, slots=8,  weight=0.12,  sell_score=60),
    "duan":          dict(min_score=78, slots=4,  weight=0.24,  sell_score=70),
    "serenity":      dict(min_score=75, slots=10, weight=0.095, sell_score=60, stop=-15.0),
    "druckenmiller": dict(min_score=62, slots=8,  weight=0.115, stop=-10.0, need_momo=True, momo_exit=-5.0),
    "sentiment":     dict(min_score=58, slots=6,  weight=0.15,  stop=-7.0, take=15.0, max_hold=5, rank_by_pct=True),
}

SELL_VOICE = {
    "stop": {
        "serenity": "破位 {pnl:+.1f}%,纪律止损 —— 瓶颈逻辑没死也得先离场,活着才有下一枪",
        "druckenmiller": "错了就是错了,{pnl:+.1f}% 砍掉 —— 仓位是用来表达判断的,不是用来证明自尊的",
        "sentiment": "{pnl:+.1f}% 触止损,情绪票不恋战,反转比谁都快",
    },
    "take": {"sentiment": "+{pnl:.1f}% 止盈落袋 —— 情绪给的钱要趁情绪还在时拿走"},
    "time": {"sentiment": "持有满 {days} 个交易日,轮动纪律到点离场({pnl:+.1f}%)"},
    "score": {
        "buffett": "重新判读后评分跌破线,生意逻辑变了就卖,价格不是理由",
        "duan": "这生意不再符合我的标准,卖出不需要第二个理由",
        "serenity": "评分掉出瓶颈区,卡位逻辑松动,离场",
    },
    "momo": {"druckenmiller": "20 日动量翻负,趋势不在了 —— 先下车,看对了再上"},
}


def trading_date(cx) -> str | None:
    r = cx.execute("SELECT MAX(date) FROM price_history").fetchone()
    return r[0] if r and r[0] else None


def load_universe(cx) -> dict[str, dict]:
    """sym → {price, pct, name, scores{master}, judgments{master}}(已判读 + 流动性闸)"""
    uni: dict[str, dict] = {}
    rows = cx.execute(
        "SELECT m.sym, m.name, m.price, m.pct, m.mcapB, a.data FROM us_market m "
        "JOIN us_analyses a ON a.sym = m.sym "
        "WHERE m.price >= 2 AND m.mcapB >= 0.2"
    ).fetchall()
    for sym, name, price, pct, mcap, data in rows:
        try:
            panel = json.loads(data).get("panel") or {}
        except Exception:
            continue
        scores, judgments = {}, {}
        for mk, _, _ in MASTERS:
            v = panel.get(mk) or {}
            try:
                scores[mk] = float(v.get("score"))
            except (TypeError, ValueError):
                scores[mk] = None
            judgments[mk] = str(v.get("judgment") or "")[:90]
        uni[sym] = dict(name=name, price=float(price), pct=float(pct or 0), scores=scores, judgments=judgments)
    return uni


def momentum20(cx, sym: str) -> float | None:
    rows = cx.execute(
        "SELECT close FROM price_history WHERE sym=? ORDER BY date DESC LIMIT 21", (sym,)
    ).fetchall()
    if len(rows) < 21 or not rows[0][0] or not rows[-1][0]:
        return None
    return (rows[0][0] / rows[-1][0] - 1) * 100


def ensure_tables(cx):
    cx.executescript("""
    CREATE TABLE IF NOT EXISTS arena_state(master TEXT PRIMARY KEY, cash REAL);
    CREATE TABLE IF NOT EXISTS arena_positions(
      master TEXT, sym TEXT, shares INTEGER, entry_price REAL, entry_date TEXT,
      PRIMARY KEY(master, sym));
    CREATE TABLE IF NOT EXISTS arena_trades(
      id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, master TEXT, side TEXT,
      sym TEXT, shares INTEGER, price REAL, reason TEXT);
    CREATE TABLE IF NOT EXISTS arena_nav(master TEXT, date TEXT, nav REAL, PRIMARY KEY(master, date));
    CREATE TABLE IF NOT EXISTS arena_orders(
      id INTEGER PRIMARY KEY AUTOINCREMENT, fill_date TEXT, master TEXT, action TEXT,
      sym TEXT, reason TEXT, status TEXT DEFAULT 'pending', note TEXT);
    """)
    try:
        cx.execute("ALTER TABLE arena_trades ADD COLUMN src TEXT DEFAULT 'rule'")
    except sqlite3.OperationalError:
        pass  # 已有


def candidates(master: str, uni: dict, cx, exclude: set[str]) -> list[str]:
    rule = RULES[master]
    cands = []
    for sym, u in uni.items():
        if sym in exclude:
            continue
        sc = u["scores"].get(master)
        if sc is None or sc < rule["min_score"]:
            continue
        if rule.get("need_momo"):
            mo = momentum20(cx, sym)
            if mo is None or mo <= 0:
                continue
        cands.append(sym)
    if rule.get("rank_by_pct"):
        cands.sort(key=lambda s: (-uni[s]["pct"], s))           # 情绪面:追当日强势
    else:
        cands.sort(key=lambda s: (-(uni[s]["scores"][master] or 0), s))  # 其他:按该股神评分
    return cands


def run_day(cx, date: str, uni: dict) -> None:
    for mk, _, _ in MASTERS:
        rule = RULES[mk]
        cash = cx.execute("SELECT cash FROM arena_state WHERE master=?", (mk,)).fetchone()
        if cash is None:
            cx.execute("INSERT INTO arena_state VALUES(?,?)", (mk, START_CASH))
            cash = START_CASH
        else:
            cash = cash[0]
        pos = {r[0]: dict(shares=r[1], entry=r[2], entry_date=r[3]) for r in cx.execute(
            "SELECT sym, shares, entry_price, entry_date FROM arena_positions WHERE master=?", (mk,))}

        # ---- 卖出纪律 ----
        for sym, p in list(pos.items()):
            u = uni.get(sym)
            if not u:
                continue  # 当天没行情(停牌/退市待查):不动
            px = u["price"]
            pnl = (px / p["entry"] - 1) * 100
            held = cx.execute(
                "SELECT COUNT(DISTINCT date) FROM price_history WHERE sym=? AND date>? AND date<=?",
                (sym, p["entry_date"], date)).fetchone()[0]
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
                mo = momentum20(cx, sym)
                if mo is not None and mo <= rule["momo_exit"]:
                    reason = SELL_VOICE["momo"][mk]
            if reason:
                cash += p["shares"] * px
                cx.execute("DELETE FROM arena_positions WHERE master=? AND sym=?", (mk, sym))
                cx.execute("INSERT INTO arena_trades(date,master,side,sym,shares,price,reason,src) VALUES(?,?,?,?,?,?,?,'rule')",
                           (date, mk, "SELL", sym, p["shares"], px, reason))
                del pos[sym]

        # ---- V2:执行 AI 决策单(arena_brain 当日 pending;SELL 先于 BUY 腾现金;机械止损已先行,AI 无权豁免)----
        ai_rows = cx.execute(
            "SELECT id, action, sym, reason FROM arena_orders WHERE master=? AND fill_date=? AND status='pending' "
            "ORDER BY CASE action WHEN 'SELL' THEN 0 WHEN 'BUY' THEN 1 ELSE 2 END, id", (mk, date)).fetchall()
        ai_mode = bool(ai_rows)
        for oid, action, sym, reason in ai_rows:
            status, note = "filled", ""
            if action == "HOLD":
                pass
            elif action == "SELL":
                p = pos.get(sym)
                u = uni.get(sym)
                if not p or not u:
                    status, note = "rejected", "未持有或无行情(可能已被机械止损)"
                else:
                    px = u["price"]
                    cash += p["shares"] * px
                    cx.execute("DELETE FROM arena_positions WHERE master=? AND sym=?", (mk, sym))
                    cx.execute("INSERT INTO arena_trades(date,master,side,sym,shares,price,reason,src) VALUES(?,?,?,?,?,?,?,'ai')",
                               (date, mk, "SELL", sym, p["shares"], px, reason))
                    del pos[sym]
            elif action == "BUY":
                u = uni.get(sym)
                sc = (u or {}).get("scores", {}).get(mk)
                nav_now = cash + sum(p2["shares"] * uni.get(s2, {"price": p2["entry"]})["price"] for s2, p2 in pos.items())
                if sym in pos:
                    status, note = "rejected", "已持有"
                elif not u:
                    status, note = "rejected", "无行情"
                elif sc is None or sc < rule["min_score"]:
                    status, note = "rejected", "低于授权评分线"
                elif len(pos) >= rule["slots"]:
                    status, note = "rejected", "仓位已满"
                else:
                    px = u["price"]
                    budget = min(nav_now * rule["weight"], cash)
                    shares = int(budget // px)
                    if shares < 1:
                        status, note = "rejected", "现金不足一股"
                    else:
                        cash -= shares * px
                        cx.execute("INSERT INTO arena_positions VALUES(?,?,?,?,?)", (mk, sym, shares, px, date))
                        cx.execute("INSERT INTO arena_trades(date,master,side,sym,shares,price,reason,src) VALUES(?,?,?,?,?,?,?,'ai')",
                                   (date, mk, "BUY", sym, shares, px, reason))
                        pos[sym] = dict(shares=shares, entry=px, entry_date=date)
            cx.execute("UPDATE arena_orders SET status=?, note=? WHERE id=?", (status, note, oid))

        # ---- 规则补仓(仅当该股神今日无 AI 决策 —— AI 说了算的日子,规则不抢戏)----
        nav_now = cash + sum(p["shares"] * uni.get(s, {"price": p["entry"]})["price"] for s, p in pos.items())
        free = rule["slots"] - len(pos)
        if free > 0 and not ai_mode:
            for sym in candidates(mk, uni, cx, exclude=set(pos)):
                if free == 0:
                    break
                px = uni[sym]["price"]
                budget = min(nav_now * rule["weight"], cash)
                shares = int(budget // px)
                if shares < 1:
                    continue
                cost = shares * px
                cash -= cost
                cx.execute("INSERT INTO arena_positions VALUES(?,?,?,?,?)", (mk, sym, shares, px, date))
                cx.execute("INSERT INTO arena_trades(date,master,side,sym,shares,price,reason,src) VALUES(?,?,?,?,?,?,?,'rule')",
                           (date, mk, "BUY", sym, shares, px, uni[sym]["judgments"][mk] or "按纪律建仓"))
                free -= 1

        # ---- 结账 ----
        pos2 = cx.execute("SELECT sym, shares, entry_price FROM arena_positions WHERE master=?", (mk,)).fetchall()
        nav = cash + sum(sh * uni.get(s, {"price": ep})["price"] for s, sh, ep in pos2)
        cx.execute("UPDATE arena_state SET cash=? WHERE master=?", (cash, mk))
        cx.execute("INSERT OR REPLACE INTO arena_nav VALUES(?,?,?)", (mk, date, nav))


def export(cx, date: str):
    out = {"as_of": date, "start_cash": START_CASH, "masters": []}
    for mk, name, school in MASTERS:
        cash = (cx.execute("SELECT cash FROM arena_state WHERE master=?", (mk,)).fetchone() or [START_CASH])[0]
        pos = []
        for sym, sh, ep, ed in cx.execute(
                "SELECT sym, shares, entry_price, entry_date FROM arena_positions WHERE master=?", (mk,)):
            m = cx.execute("SELECT name, price, pct FROM us_market WHERE sym=?", (sym,)).fetchone()
            px = m[1] if m else ep
            jd = ""
            a = cx.execute("SELECT data FROM us_analyses WHERE sym=?", (sym,)).fetchone()
            if a:
                try:
                    jd = str((json.loads(a[0])["panel"].get(mk) or {}).get("judgment") or "")[:90]
                except Exception:
                    pass
            pos.append(dict(sym=sym, name=(m[0] if m else sym), shares=sh, entry=round(ep, 2),
                            price=round(px, 2), pnlPct=round((px / ep - 1) * 100, 2),
                            dayPct=(round(m[2], 2) if m and m[2] is not None else None),
                            since=ed, judgment=jd))
        pos.sort(key=lambda p: -p["shares"] * p["price"])
        nav_hist = [dict(date=d, nav=round(n)) for d, n in cx.execute(
            "SELECT date, nav FROM arena_nav WHERE master=? ORDER BY date", (mk,))]
        nav = nav_hist[-1]["nav"] if nav_hist else START_CASH
        trades = [dict(date=d, side=sd, sym=s, shares=sh, price=round(p, 2), reason=r, src=src or "rule")
                  for d, sd, s, sh, p, r, src in cx.execute(
                "SELECT date, side, sym, shares, price, reason, src FROM arena_trades "
                "WHERE master=? ORDER BY id DESC LIMIT 14", (mk,))]
        out["masters"].append(dict(key=mk, name=name, school=school, cash=round(cash),
                                   nav=nav, retPct=round((nav / START_CASH - 1) * 100, 2),
                                   positions=pos, navHist=nav_hist, trades=trades))
    out["masters"].sort(key=lambda m: -m["nav"])
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"✓ arena.json: {date} · " + " · ".join(f"{m['name']} {m['retPct']:+.2f}%" for m in out["masters"]))


def main():
    cx = sqlite3.connect(DB)
    ensure_tables(cx)
    date = trading_date(cx)
    if not date:
        sys.exit("price_history 为空,先跑 refresh")
    done = cx.execute("SELECT COUNT(*) FROM arena_nav WHERE date=?", (date,)).fetchone()[0]
    if done >= len(MASTERS) and "--force" not in sys.argv:
        print(f"· 对决 {date} 已结账,跳过(--force 重跑)")
    else:
        uni = load_universe(cx)
        print(f"五神对决 · 交易日 {date} · 股票池 {len(uni)} 只")
        run_day(cx, date, uni)
        cx.commit()
    export(cx, date)
    cx.close()


if __name__ == "__main__":
    main()
