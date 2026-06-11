"""捕获四指数收盘 % → web/public/data/yclose.json。

跑在 05:00 北京(= 17:00 ET,闭市)refresh_job 里 —— 此刻 primary 即定格收盘,数据最干净。
BIG EVENTS 卡(17:00 北京)只读这个文件,不再临场调 Nasdaq
(2026-06-11 教训:盘前时段该端点的部分边缘节点把盘前价标成 "Closed at",共识双询都防不住)。
"""
from __future__ import annotations
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
OUT = ROOT / "web" / "public" / "data" / "yclose.json"
HDRS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
ET = timezone(timedelta(hours=-4))


def main():
    rows = []
    for sym, label in [("QQQ", "Nasdaq"), ("SPY", "S&P 500"), ("DIA", "Dow"), ("IWM", "Russell 2K")]:
        try:
            d = requests.get(f"https://api.nasdaq.com/api/quote/{sym}/info",
                             params={"assetclass": "etf"}, headers=HDRS, timeout=15).json()["data"]
            pri, sec = d.get("primaryData") or {}, d.get("secondaryData") or {}
            closed = lambda x: "closed at" in str(x.get("lastTradeTimestamp", "")).lower()
            # 闭市时段 primary 通常就是定格收盘(timestamp 带 Closed at);否则认 secondary
            src = pri if closed(pri) else (sec if closed(sec) else pri)
            pct = str(src.get("percentageChange") or "").replace("%", "")
            ts = str(src.get("lastTradeTimestamp") or "")
            if pct and pct not in ("N/A", "--"):
                rows.append({"label": label, "pct": pct, "ts": ts})
        except Exception:
            continue
    if len(rows) >= 3:
        date_et = datetime.now(ET).strftime("%Y-%m-%d")
        OUT.write_text(json.dumps({"date": date_et, "rows": rows}, ensure_ascii=False), encoding="utf-8")
        print(f"✓ yclose.json: {date_et} · " + " ".join(f"{r['label']} {r['pct']}" for r in rows))
    else:
        print(f"⚠ 只拿到 {len(rows)} 只,保留旧文件不覆盖")


if __name__ == "__main__":
    main()
