"""累积 A 股每日收盘 → a-price-history-30d.json,供板块热力的 A 股「近7天/近1月」趋势用。

A 股没有现成的 30 天历史(云端只有 /api/a-market 实时/收盘),所以从今天起每天攒一根:
收盘后(数据刷新 CI ~北京06:35,A 股早已 15:00 收盘)读 /api/a-market 的最新收盘价,按当前中国日期
append 进 a-price-history-30d.json,保留最近 30 个交易日。攒满 ~30 天后 7日/30日趋势就能算。

结构(与美股 price-history-30d.json 同构):{ "dates": [...], "closes": { "600519": { "2026-06-19": 1680.5 }, ... } }
抓空 / 异常少 → 不覆盖(同 cloud_price_refresh / market_calendar)。纯 stdlib。

用法: python scripts/cloud_a_history_refresh.py [--dry]
"""
from __future__ import annotations
import json
import sys
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

PUB = Path(__file__).parent.parent / "web" / "public" / "data"
OUT = PUB / "a-price-history-30d.json"
API = "https://stockgod.xyz/api/a-market"
KEEP = 30  # 保留最近 N 个交易日


def fetch_quotes() -> dict:
    req = urllib.request.Request(API, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8")).get("quotes", {})


def main() -> None:
    dry = "--dry" in sys.argv
    quotes = fetch_quotes()
    # 取有正收盘价的票
    closes_today = {code: q["price"] for code, q in quotes.items()
                    if isinstance(q, dict) and isinstance(q.get("price"), (int, float)) and q["price"] > 0}
    if len(closes_today) < 1000:
        print(f"⚠ /api/a-market 仅 {len(closes_today)} 只有价,疑似异常 → 不写(保留旧历史)")
        return

    # 中国交易日(收盘后跑,以当前中国日期为这一根的 key;只取交易日:周末不跑由 CI schedule 控)
    cn = datetime.now(ZoneInfo("Asia/Shanghai"))
    day = cn.strftime("%Y-%m-%d")
    if cn.weekday() >= 5:
        print(f"⚠ {day} 是周末,A 股无新收盘 → 跳过")
        return

    try:
        hist = json.loads(OUT.read_text(encoding="utf-8"))
    except Exception:
        hist = {"dates": [], "closes": {}}
    dates = hist.get("dates", [])
    closes = hist.get("closes", {})

    if day not in dates:
        dates.append(day)
    dates = sorted(set(dates))[-KEEP:]  # 升序 + 留最近 30 天
    keep_set = set(dates)

    for code, px in closes_today.items():
        dc = closes.setdefault(code, {})
        dc[day] = round(px, 4)
        # 修剪每只票只留窗口内日期
        for d in list(dc):
            if d not in keep_set:
                del dc[d]
    # 清掉本轮没有任何窗口内数据的票
    for code in list(closes):
        if not closes[code]:
            del closes[code]

    print(f"✓ a-price-history-30d.json: 今日 {day} 收 {len(closes_today)} 只 · 累计 {len(dates)} 个交易日 · {len(closes)} 只票")
    if dry:
        print("  [dry] 不写文件")
        return
    OUT.write_text(json.dumps({"dates": dates, "closes": closes}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
