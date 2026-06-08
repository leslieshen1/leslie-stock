"""清洗基本面里的 Infinity/NaN（Python json 允许、但 JS JSON.parse 拒绝整份文件）。

把 data/_cache/fundamentals/*.json、leslie.db.us_fundamentals、web/public/data/us-fundamentals.json
里的 inf/nan 字段全部删掉，并用 allow_nan=False 强制产出合法 JSON。

用法: uv run python scripts/sanitize_fundamentals.py
"""
from __future__ import annotations
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
from db import connect, init_schema

PUB = ROOT / "web" / "public" / "data"
CACHE = ROOT / "data" / "_cache" / "fundamentals"
OUT = PUB / "us-fundamentals.json"


def clean(rec: dict) -> dict:
    out = {}
    for k, v in rec.items():
        if isinstance(v, float) and not math.isfinite(v):
            continue  # 丢掉 inf/nan
        out[k] = v
    return out


def main():
    # 1) 缓存文件
    n_cache = n_cache_fixed = 0
    if CACHE.exists():
        for f in CACHE.glob("*.json"):
            n_cache += 1
            try:
                rec = json.loads(f.read_text(encoding="utf-8"))  # python 接受 Infinity
            except Exception:
                continue
            cleaned = clean(rec)
            if cleaned != rec:
                n_cache_fixed += 1
                f.write_text(json.dumps(cleaned, ensure_ascii=False, allow_nan=False),
                             encoding="utf-8")
    print(f"  缓存: {n_cache} 个，修了 {n_cache_fixed}")

    # 2) 重新从缓存汇总 → us-fundamentals.json（合法 JSON）+ db
    out: dict[str, dict] = {}
    for f in (CACHE.glob("*.json") if CACHE.exists() else []):
        sym = f.stem.upper()
        try:
            rec = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        rec = {k: v for k, v in clean(rec).items() if k != "_ts" and v is not None}
        if rec:
            out[sym] = rec
    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    # allow_nan=False：若还有 inf 会直接报错（验证）
    OUT.write_text(json.dumps({"generated_at": gen, "count": len(out), "stocks": out},
                              ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"  us-fundamentals.json: {len(out)} 只（合法 JSON 校验通过）")

    # 3) db
    init_schema()
    c = connect()
    c.execute("DELETE FROM us_fundamentals")
    c.executemany(
        "INSERT INTO us_fundamentals(sym,data,updated_at) VALUES(?,?,?)",
        [(s, json.dumps(r, ensure_ascii=False, allow_nan=False), gen) for s, r in out.items()])
    c.execute("INSERT INTO meta(key,value) VALUES('us_fundamentals_generated_at',?) "
              "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (gen,))
    c.commit()
    print(f"  leslie.db.us_fundamentals: {len(out)}")
    print("✅ 清洗完成")


if __name__ == "__main__":
    main()
