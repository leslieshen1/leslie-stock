#!/usr/bin/env python3
"""云端权威价格刷新(DB-free,脱离本地 Mac)。

为什么:arena-engine 结账依赖 us-stocks 收盘价 + price-history;过去这俩靠本地 Mac 跑 refresh
生成提交,Mac 睡了就不更新 → 股神冻住。本脚本在云端(GitHub Actions)跑,彻底脱离本地。

取价源:自家 /api/market(Nasdaq 实时,与热力图同源,已验证可靠)。收盘后跑 → 拿到的就是当日收盘。
做的事:① 更新 us-stocks.json 的 price/pct/mcapB/vol(**保留 seg/sub/sub2/capDup/name/industry 等**)
        ② 追加今日收盘进 price-history-30d.json(close=各票现价),trim 30 天
可靠性:抓不到足够多的票(<MIN_QUOTES)→ 直接中止、不写,绝不写脏数据污染账本。
用法:python scripts/cloud_price_refresh.py [--dry]   (--dry 只抓+校验+报告,不写文件)
"""
import json
import sys
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

PUB = Path(__file__).resolve().parent.parent / "web" / "public" / "data"
API = "https://stockgod.xyz/api/market"
MIN_QUOTES = 3000   # 正常 /api/market 回 5000+;低于此视为抓取异常 → 中止(fail-safe)
ET = ZoneInfo("America/New_York")
# 美股全天休市日(周一~五但不开盘)。这些天跑会把上一交易日收盘当"今日"重复写 → price-history 多塞
# 一个非交易日,动量窗口轻微偏移。每年初补下一年。2026-2027:
US_HOLIDAYS = {
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
    "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
    "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
}


def fetch_payload() -> dict:
    req = urllib.request.Request(API, headers={"user-agent": "price-refresh"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read()) or {}


def main(dry: bool) -> None:
    payload = fetch_payload()
    quotes = payload.get("quotes") or {}
    n = sum(1 for q in quotes.values() if q.get("price") is not None)
    print(f"/api/market 回 {len(quotes)} 只,有价 {n} 只,stale={payload.get('stale')}")
    # 闸①:源降级(Nasdaq 上游故障 → 路由回退「上次好值」并标 stale)。陈旧的盘中价绝不能当收盘写。
    if payload.get("stale"):
        sys.exit("❌ /api/market 标记 stale(Nasdaq 上游降级)→ 中止,不写(fail-safe)")
    # 闸②:抓不到足够多的票 → 疑似异常。
    if n < MIN_QUOTES:
        sys.exit(f"❌ 有价仅 {n}(<{MIN_QUOTES}),疑似抓取异常 → 中止,不写(fail-safe)")
    if dry:
        print("✓ --dry:校验通过,不写文件"); return

    # 闸③:只在收盘后窗口写(防盘中价/非交易时段被当收盘价写脏)。ET 周一~五、≥16:00 才写;
    # 否则干净跳过(exit 0,非错误)—— 这样即便被误触发/GitHub schedule 误点,也绝不污染账本。
    et = datetime.now(ET)
    today = et.strftime("%Y-%m-%d")
    if et.weekday() >= 5 or et.hour < 16 or today in US_HOLIDAYS:
        why = "周末" if et.weekday() >= 5 else "假期休市" if today in US_HOLIDAYS else "未到收盘(<16:00)"
        print(f"· {et:%Y-%m-%d %H:%M} ET 非交易日收盘窗口({why})→ 跳过不写(clean skip)")
        return

    # ① us-stocks 价格(保留其它字段)
    usp = PUB / "us-stocks.json"
    us = json.loads(usp.read_text(encoding="utf-8"))
    upd = 0
    for s in us.get("stocks", []):
        q = quotes.get(s.get("sym"))
        if q and q.get("price") is not None:
            s["price"] = q["price"]
            for k_src, k_dst in (("pct", "pct"), ("mcapB", "mcapB"), ("vol", "vol")):
                if q.get(k_src) is not None:
                    s[k_dst] = q[k_src]
            upd += 1
    us["generated_at"] = datetime.now(ET).strftime("%Y-%m-%d %H:%M ET")
    usp.write_text(json.dumps(us, ensure_ascii=False), encoding="utf-8")

    # ② price-history 追加今日(close=现价)。
    #    **结构铁律**:closes 是 {sym: {date: close}}(dict,非 list!见 export_arena_inputs.py:4,41-49),
    #    dates 是 list[30日]。引擎 arena_cloud.py:69-77 按 sorted(cl.keys()) 取最近21/最新日、date=dates[-1]。
    #    同日重刷=覆盖该 sym 的 today;否则给每个有报价的 sym 写 closes[sym][today]。trim:只留最近 30 个交易日。
    php = PUB / "price-history-30d.json"
    ph = json.loads(php.read_text(encoding="utf-8"))
    dates = ph.setdefault("dates", [])
    closes = ph.setdefault("closes", {})
    if today not in dates:
        dates.append(today)
    wrote = 0
    for sym, c in closes.items():
        if not isinstance(c, dict):   # 防御:结构异常立即中止,绝不写脏
            sys.exit(f"❌ closes[{sym!r}] 不是 dict({type(c).__name__}),结构异常 → 中止不写(fail-safe)")
        q = quotes.get(sym)
        if q and q.get("price") is not None:
            c[today] = q["price"]
            wrote += 1
    # trim:dates 只留最近 30 日,各 sym 同步裁剪(保持与权威写者一致)
    if len(dates) > 30:
        dates[:] = dates[-30:]
    keep = set(dates)
    for sym in list(closes):
        closes[sym] = {d: v for d, v in closes[sym].items() if d in keep}
    php.write_text(json.dumps(ph, ensure_ascii=False), encoding="utf-8")
    print(f"✓ 更新 {upd} 只 us-stocks 价 + price-history 写 {wrote} 只收盘 @ {today}(共 {len(dates)} 日)")


if __name__ == "__main__":
    main("--dry" in sys.argv)
