"""导出待五方判读的美股清单(>=50M 未判读)+ Nasdaq 公司简介,供 workflow 批量分析。
用法: uv run python scripts/export_panel_todo.py  → /tmp/panel_todo.json
"""
from __future__ import annotations
import json, sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import requests

ROOT = Path(__file__).parent.parent
DB = ROOT / "data" / "leslie.db"
OUT = Path("/tmp/panel_todo.json")
NH = {"user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "accept": "application/json", "origin": "https://www.nasdaq.com", "referer": "https://www.nasdaq.com/"}


def desc(sym: str) -> str:
    try:
        d = requests.get(f"https://api.nasdaq.com/api/company/{sym}/company-profile",
                         headers=NH, timeout=12).json().get("data") or {}
        return ((d.get("CompanyDescription") or {}).get("value") or "")[:600]
    except Exception:
        return ""


def main():
    cx = sqlite3.connect(DB)
    done = set(r[0] for r in cx.execute("SELECT DISTINCT sym FROM us_panel_history"))
    rows = cx.execute("SELECT sym,name,mcapB,sector,industry,price,pct FROM us_market WHERE mcapB>=0.05 ORDER BY mcapB DESC").fetchall()
    targets = [{"sym": s, "name": n, "mcapB": round(m, 3), "sector": sec or "", "industry": ind or "",
                "price": p, "pct": pc} for s, n, m, sec, ind, p, pc in rows if s not in done]
    print(f"目标 {len(targets)} 只,抓简介中…")
    with ThreadPoolExecutor(max_workers=16) as ex:
        descs = list(ex.map(desc, [t["sym"] for t in targets]))
    got = 0
    for t, d in zip(targets, descs):
        t["desc"] = d
        if d:
            got += 1
    OUT.write_text(json.dumps(targets, ensure_ascii=False), encoding="utf-8")
    print(f"✅ {OUT} — {len(targets)} 只({got} 有简介)")
    print("   样本:", ", ".join(f"{t['sym']}({t['mcapB']:.2f}B)" for t in targets[:6]))


if __name__ == "__main__":
    main()
