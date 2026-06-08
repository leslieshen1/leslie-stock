"""财报日历 + 市场新闻(Finnhub,免费 key)→ earnings-calendar.json / market-news.json + leslie.db。

对标 ru7 的 Finnhub。免费 key(finnhub.io 注册即得,60 call/min):
  - 财报日历:未来 2 周谁出财报 + EPS/营收预期 → 补我们想要的"驾驶舱日历"
  - 市场新闻:大盘综合新闻

key 放 .env: FINNHUB_KEY=xxxx(没有则优雅跳过,refresh 不报错)

用法: uv run python -m fetchers.finnhub [--days 14]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
KEY = os.environ.get("FINNHUB_KEY") or os.environ.get("FINNHUB_TOKEN") or ""
BASE = "https://finnhub.io/api/v1"


def get(path: str, **params) -> dict | list:
    params["token"] = KEY
    r = requests.get(f"{BASE}/{path}", params=params, timeout=25)
    r.raise_for_status()
    return r.json()


def upsert_db(table_meta: list[tuple], meta_key: str, gen: str):
    sys.path.insert(0, str(ROOT))
    from db import connect, init_schema
    init_schema()
    c = connect()
    c.executemany(
        "INSERT INTO us_earnings(sym,data,updated_at) VALUES(?,?,?) "
        "ON CONFLICT(sym) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
        table_meta)
    c.execute("INSERT INTO meta(key,value) VALUES(?,?) "
              "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (meta_key, gen))
    c.commit()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=14, help="财报日历向后天数")
    args = ap.parse_args()

    if not KEY:
        print("⏭  未设 FINNHUB_KEY,跳过(在 .env 加 FINNHUB_KEY=xxx 即启用 · finnhub.io 免费注册)")
        return

    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    today = datetime.now(timezone.utc).date()

    # 1) 财报日历
    print(f"📅 财报日历(Finnhub,未来 {args.days} 天)...")
    cal = get("calendar/earnings", **{"from": str(today),
                                      "to": str(today + timedelta(days=args.days))})
    rows = cal.get("earningsCalendar", []) if isinstance(cal, dict) else []
    by_sym: dict[str, list] = {}
    for e in rows:
        sym = (e.get("symbol") or "").upper()
        if not sym:
            continue
        by_sym.setdefault(sym, []).append({
            "date": e.get("date"), "hour": e.get("hour"),
            "epsEst": e.get("epsEstimate"), "epsAct": e.get("epsActual"),
            "revEst": e.get("revenueEstimate"), "revAct": e.get("revenueActual"),
        })
    (PUB / "earnings-calendar.json").write_text(
        json.dumps({"generated_at": gen, "from": str(today),
                    "to": str(today + timedelta(days=args.days)),
                    "count": len(rows), "stocks": by_sym}, ensure_ascii=False), encoding="utf-8")
    print(f"   ✓ {len(rows)} 条财报事件 · {len(by_sym)} 只票")

    # 2) 市场综合新闻
    print("📰 市场新闻(Finnhub)...")
    news = get("news", category="general")
    items = [{"title": n.get("headline"), "url": n.get("url"), "source": n.get("source"),
              "ts": n.get("datetime"), "summary": (n.get("summary") or "")[:200]}
             for n in (news or [])[:40]]
    (PUB / "market-news.json").write_text(
        json.dumps({"generated_at": gen, "items": items}, ensure_ascii=False), encoding="utf-8")
    print(f"   ✓ {len(items)} 条市场新闻")

    # 入库
    try:
        upsert_db([(sym, json.dumps(v, ensure_ascii=False), gen) for sym, v in by_sym.items()],
                  "earnings_generated_at", gen)
        print(f"   ↳ 入库 leslie.db.us_earnings: {len(by_sym)}")
    except Exception as e:
        print(f"   ↳ 入库跳过: {e}")

    print("✅ Finnhub 财报日历 + 市场新闻已更新")


if __name__ == "__main__":
    main()
