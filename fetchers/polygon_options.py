"""期权 gamma 敞口(Polygon,免费 key,best-effort)→ us-options.json + leslie.db.us_options。

对标 ru7 的 Polygon options Greeks / gamma。免费 key(polygon.io 注册即得,5 call/min)。
注:greeks 字段在 Polygon 免费档可能缺失(需 Options Starter),此时只给 OI 聚合,GEX 留空。
对少数高流动性标的(SPY/QQQ/NVDA/AAPL/TSLA)算简化净 GEX。

key 放 .env: POLYGON_KEY=xxxx(没有则优雅跳过)

用法: uv run python -m fetchers.polygon_options [--syms SPY,QQQ,NVDA]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
KEY = os.environ.get("POLYGON_KEY") or os.environ.get("POLYGON_API_KEY") or ""
SNAP = "https://api.polygon.io/v3/snapshot/options/{u}"
DEFAULT = ["SPY", "QQQ", "NVDA", "AAPL", "TSLA", "MSFT", "AMZN", "META"]


def fetch_gex(sym: str) -> dict | None:
    call_g = put_g = 0.0
    spot = None
    n = 0
    url = SNAP.format(u=sym)
    params = {"apiKey": KEY, "limit": 250}
    for _ in range(6):  # 翻页(免费档限速,温柔点)
        try:
            r = requests.get(url, params=params, timeout=25)
            if r.status_code in (401, 403):
                print(f"   ⚠ {sym}: {r.status_code}(免费档无此数据?)")
                return None
            r.raise_for_status()
            j = r.json()
        except Exception as e:
            print(f"   ⚠ {sym}: {str(e)[:50]}")
            break
        for c in j.get("results", []):
            det = c.get("details", {})
            greeks = c.get("greeks", {}) or {}
            oi = c.get("open_interest") or 0
            g = greeks.get("gamma")
            spot = spot or (c.get("underlying_asset", {}) or {}).get("price")
            if g is None:
                continue
            contrib = g * oi
            if det.get("contract_type") == "call":
                call_g += contrib
            elif det.get("contract_type") == "put":
                put_g += contrib
            n += 1
        nxt = j.get("next_url")
        if not nxt:
            break
        url, params = nxt, {"apiKey": KEY}
        time.sleep(13)  # 5/min 限速
    gex = (call_g - put_g) * (spot or 0) * 100 if spot else None
    return {"gex": gex, "callGamma": round(call_g, 2), "putGamma": round(put_g, 2),
            "spot": spot, "contracts": n}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--syms", type=str, default="")
    args = ap.parse_args()
    if not KEY:
        print("⏭  未设 POLYGON_KEY,跳过(在 .env 加 POLYGON_KEY=xxx 即启用 · polygon.io 免费注册)")
        return
    syms = [s.strip().upper() for s in args.syms.split(",") if s.strip()] or DEFAULT
    print(f"📐 期权 gamma 敞口(Polygon)... {len(syms)} 标的")
    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    out = {}
    for s in syms:
        rec = fetch_gex(s)
        if rec:
            out[s] = rec
            print(f"   {s}: GEX {rec['gex']}  contracts {rec['contracts']}")
    (PUB / "us-options.json").write_text(
        json.dumps({"generated_at": gen, "stocks": out}, ensure_ascii=False), encoding="utf-8")
    try:
        sys.path.insert(0, str(ROOT))
        from db import connect, init_schema
        init_schema()
        c = connect()
        c.executemany(
            "INSERT INTO us_options(sym,data,updated_at) VALUES(?,?,?) "
            "ON CONFLICT(sym) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
            [(s, json.dumps(v, ensure_ascii=False), gen) for s, v in out.items()])
        c.commit()
        print(f"   ↳ 入库 leslie.db.us_options: {len(out)}")
    except Exception as e:
        print(f"   ↳ 入库跳过: {e}")
    print(f"✅ 期权 gamma {len(out)} 标的 → us-options.json")


if __name__ == "__main__":
    main()
