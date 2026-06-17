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

    today = datetime.now(ET).strftime("%Y-%m-%d")

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

    # ② price-history 追加今日(close=现价);同日重刷则更新,否则 append + trim 30
    php = PUB / "price-history-30d.json"
    ph = json.loads(php.read_text(encoding="utf-8"))
    dates, closes = ph.get("dates", []), ph.get("closes", {})
    if today in dates:
        idx = dates.index(today)
        for sym, arr in closes.items():
            q = quotes.get(sym)
            if q and q.get("price") is not None and len(arr) > idx:
                arr[idx] = q["price"]
    else:
        dates.append(today)
        for sym, arr in closes.items():
            q = quotes.get(sym)
            arr.append(q["price"] if (q and q.get("price") is not None) else (arr[-1] if arr else None))
        if len(dates) > 30:
            cut = len(dates) - 30
            ph["dates"] = dates[cut:]
            for sym in closes:
                closes[sym] = closes[sym][cut:]
    php.write_text(json.dumps(ph, ensure_ascii=False), encoding="utf-8")
    print(f"✓ 更新 {upd} 只 us-stocks 价 + price-history 追加/更新 {today}")


if __name__ == "__main__":
    main("--dry" in sys.argv)
