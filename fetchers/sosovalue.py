"""Crypto ETF 资金流(SoSoValue,免费 key,best-effort)→ crypto-etf.json + leslie.db.crypto_etf。

对标 ru7 的 SoSoValue。比特币/以太坊现货 ETF 每日净流入。
SoSoValue openapi 需 key(sosovalue.com 开发者页申请,有免费档)。

key 放 .env: SOSOVALUE_KEY=xxxx(没有则优雅跳过)

用法: uv run python -m fetchers.sosovalue
"""
from __future__ import annotations

import json
import os
import sys
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
KEY = os.environ.get("SOSOVALUE_KEY") or os.environ.get("SOSOVALUE_API_KEY") or ""
BASE = "https://api.sosovalue.com/openapi/v1/etf"


def fetch(kind: str) -> dict | None:
    """kind: 'us-btc-spot' / 'us-eth-spot'"""
    try:
        r = requests.post(f"{BASE}/historicalInflowChart",
                          headers={"x-soso-api-key": KEY, "content-type": "application/json"},
                          json={"type": kind}, timeout=25)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"   ⚠ {kind}: {str(e)[:60]}")
        return None


def main():
    if not KEY:
        print("⏭  未设 SOSOVALUE_KEY,跳过(在 .env 加 SOSOVALUE_KEY=xxx 即启用 · sosovalue.com 开发者页申请)")
        return
    print("🪙 Crypto ETF 资金流(SoSoValue)...")
    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    out = {}
    for kind in ("us-btc-spot", "us-eth-spot"):
        d = fetch(kind)
        if d:
            out[kind] = d.get("data", d)
            print(f"   ✓ {kind}")
    (PUB / "crypto-etf.json").write_text(
        json.dumps({"generated_at": gen, "flows": out}, ensure_ascii=False), encoding="utf-8")
    try:
        sys.path.insert(0, str(ROOT))
        from db import connect, init_schema
        init_schema()
        c = connect()
        c.executemany(
            "INSERT INTO crypto_etf(id,data,updated_at) VALUES(?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
            [(k, json.dumps(v, ensure_ascii=False), gen) for k, v in out.items()])
        c.commit()
        print(f"   ↳ 入库 leslie.db.crypto_etf: {len(out)}")
    except Exception as e:
        print(f"   ↳ 入库跳过: {e}")
    print(f"✅ Crypto ETF 资金流 {len(out)} → crypto-etf.json")


if __name__ == "__main__":
    main()
