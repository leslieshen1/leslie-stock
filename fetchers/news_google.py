"""个股新闻(Google News RSS,免费无 key)→ us-news.json + leslie.db.us_news。

对标 ru7 的"个股新闻(近 2 天)"。Google News 的 RSS 搜索端点公开、无 key、无限流(温柔点)。
query 用公司名(带引号精确)+ stock,取近期 top 几条。

输出 web/public/data/us-news.json: {generated_at, stocks:{SYM:[{title,url,source,ts}...]}}

用法:
  uv run python -m fetchers.news_google              # 所有 panels(可点详情的票)
  uv run python -m fetchers.news_google --syms NVDA,AAPL
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
PUB = ROOT / "web" / "public" / "data"
OUT = PUB / "us-news.json"
CACHE = ROOT / "data" / "_cache" / "news"
PANELS = PUB / "us-panels"
US_STOCKS = PUB / "us-stocks.json"

UA = {"user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
RSS = "https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
MAX_ITEMS = 6


def name_map() -> dict[str, str]:
    if not US_STOCKS.exists():
        return {}
    stocks = json.loads(US_STOCKS.read_text(encoding="utf-8")).get("stocks", [])
    return {s["sym"].upper(): s.get("name") or s["sym"] for s in stocks}


def fetch_one(sym: str, name: str, max_age_hours: int) -> list[dict] | None:
    cf = CACHE / f"{sym}.json"
    if cf.exists():
        try:
            cached = json.loads(cf.read_text(encoding="utf-8"))
            ts = datetime.fromisoformat(cached.get("_ts"))
            if (datetime.now(timezone.utc) - ts).total_seconds() < max_age_hours * 3600:
                return cached.get("items", [])
        except Exception:
            pass
    # query：公司名精确 + stock；名字太短(<=2 词且像通用词)时附 ticker
    q = f'"{name}" stock' if name and name.upper() != sym else f"{sym} stock"
    url = RSS.format(q=urllib.parse.quote(q))
    for attempt in range(3):
        try:
            r = requests.get(url, headers=UA, timeout=20)
            r.raise_for_status()
            root = ET.fromstring(r.content)
            items = []
            for it in root.iter("item"):
                title = (it.findtext("title") or "").strip()
                link = (it.findtext("link") or "").strip()
                pub = (it.findtext("pubDate") or "").strip()
                src_el = it.find("source")
                src = (src_el.text.strip() if src_el is not None and src_el.text else "")
                # 标题常是 "Headline - Source",剥出来
                if not src and " - " in title:
                    src = title.rsplit(" - ", 1)[-1].strip()
                    title = title.rsplit(" - ", 1)[0].strip()
                if title and link:
                    items.append({"title": title, "url": link, "source": src, "ts": pub})
                if len(items) >= MAX_ITEMS:
                    break
            rec = {"_ts": datetime.now(timezone.utc).isoformat(), "items": items}
            cf.parent.mkdir(parents=True, exist_ok=True)
            cf.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
            return items
        except Exception as e:
            if attempt == 2:
                print(f"   ⚠ {sym}: {str(e)[:50]}")
            time.sleep(1.0 * (attempt + 1))
    return None


def universe(args) -> list[str]:
    if args.syms:
        return [s.strip().upper() for s in args.syms.split(",") if s.strip()]
    syms = []
    if PANELS.exists():
        syms = sorted(p.stem.upper() for p in PANELS.glob("*.json"))
    if args.limit:
        syms = syms[: args.limit]
    return syms


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--syms", type=str, default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--max-age-hours", type=int, default=12)
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    nm = name_map()
    syms = universe(args)
    print(f"📰 拉个股新闻(Google News)... 共 {len(syms)} 只 · {args.workers} 线程")
    t0 = time.time()
    out: dict[str, list] = {}
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(fetch_one, s, nm.get(s, s), args.max_age_hours): s for s in syms}
        for fut in as_completed(futs):
            sym = futs[fut]
            items = fut.result()
            done += 1
            if items:
                out[sym] = items
            if done % 200 == 0:
                print(f"   {done}/{len(syms)} ({len(out)} 有新闻, {time.time()-t0:.0f}s)")

    prev = {}
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text(encoding="utf-8")).get("stocks", {})
        except Exception:
            pass
    merged = {**prev, **out}
    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    OUT.write_text(json.dumps({"generated_at": gen, "count": len(merged), "stocks": merged},
                              ensure_ascii=False), encoding="utf-8")

    try:
        sys.path.insert(0, str(ROOT))
        from db import connect, init_schema
        init_schema()
        c = connect()
        c.executemany(
            "INSERT INTO us_news(sym,data,updated_at) VALUES(?,?,?) "
            "ON CONFLICT(sym) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
            [(sym, json.dumps(items, ensure_ascii=False), gen) for sym, items in out.items()])
        c.execute("INSERT INTO meta(key,value) VALUES('us_news_generated_at',?) "
                  "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (gen,))
        c.commit()
        print(f"   ↳ 入库 leslie.db.us_news: 本次 {len(out)}")
    except Exception as e:
        print(f"   ↳ 入库跳过: {e}")

    print(f"✅ 新闻 {len(out)}/{len(syms)} 本次有数据 · 累计 {len(merged)} → {OUT}  ({time.time()-t0:.0f}s)")
    for sym in list(out)[:3]:
        print(f"   {sym}: {out[sym][0]['title'][:60]}  [{out[sym][0]['source']}]")


if __name__ == "__main__":
    main()
