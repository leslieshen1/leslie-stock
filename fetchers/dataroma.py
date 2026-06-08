"""超级投资者 13F 持仓(Dataroma,免费无 key 抓取)→ 合并进 whales.json + leslie.db.superinvestors。

对标 ru7 的 Dataroma 机构持仓。Dataroma 聚合了 ~82 位价投大佬的季度 13F:
巴菲特、段永平、李录、霍华德·马克斯、Klarman、Einhorn、Icahn、Ackman、Burry…
正好喂我们的 buffett 主理人 + 个股详情页"谁也持有它"。

合并策略:保留现有 A股顶流 / 政客投资者,只替换 superinvestor 那部分为 Dataroma 真数据,
by_ticker 用全集重建。带中文名映射(段永平/巴菲特…),on-brand。

用法: uv run python -m fetchers.dataroma [--limit N] [--top-holdings 40]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).parent.parent
WHALES = [ROOT / "data" / "whales.json", ROOT / "web" / "data" / "whales.json"]
HOME = "https://www.dataroma.com/m/home.php"
HOLD = "https://www.dataroma.com/m/holdings.php?m={code}"
UA = {"user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}

# 英文名(小写子串)→ 中文名,on-brand 显示。匹配不到就用英文。
NAME_CN = {
    "warren buffett": "巴菲特", "duan yongping": "段永平", "li lu": "李录",
    "howard marks": "霍华德·马克斯", "charlie munger": "查理·芒格",
    "seth klarman": "塞斯·卡拉曼", "david einhorn": "大卫·爱因霍恩",
    "carl icahn": "卡尔·伊坎", "nelson peltz": "纳尔逊·佩尔茨",
    "bill ackman": "比尔·阿克曼", "michael burry": "迈克尔·伯里",
    "mohnish pabrai": "莫尼什·帕伯莱", "guy spier": "盖伊·斯皮尔",
    "chuck akre": "查克·阿克尔", "terry smith": "特里·史密斯",
    "bruce berkowitz": "布鲁斯·伯科威茨", "david tepper": "大卫·泰珀",
    "chase coleman": "蔡斯·科尔曼", "stanley druckenmiller": "德鲁肯米勒",
    "bill nygren": "比尔·奈格伦", "tom russo": "汤姆·拉索",
    "prem watsa": "普雷姆·沃特萨", "thomas gayner": "托马斯·盖纳",
}


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "investor"


def parse_managers(html: str) -> list[dict]:
    """home.php → [{code, person, fund, updated}]。"""
    soup = BeautifulSoup(html, "lxml")
    out, seen = [], set()
    for a in soup.find_all("a", href=re.compile(r"holdings\.php\?m=")):
        m = re.search(r"m=([A-Za-z0-9]+)", a["href"])
        if not m:
            continue
        code = m.group(1)
        if code in seen:
            continue
        seen.add(code)
        txt = a.get_text(" ", strip=True)
        # "Howard Marks - Oaktree Capital Management Updated 20 May 2026"
        updated = ""
        um = re.search(r"\bUpdated\b(.*)$", txt)
        if um:
            updated = um.group(1).strip()
            txt = txt[: um.start()].strip()
        if " - " in txt:
            person, fund = txt.split(" - ", 1)
        else:
            person, fund = "", txt
        out.append({"code": code, "person": person.strip(), "fund": fund.strip(),
                    "updated": updated})
    return out


def _change_type(activity: str) -> str | None:
    a = (activity or "").lower()
    if not a:
        return "hold"
    if a.startswith("buy"):
        return "new"
    if "add" in a:
        return "add"
    if "reduce" in a:
        return "trim"
    if "sell" in a:
        return "exit"
    return "hold"


def parse_holdings(html: str, top: int) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table", id="grid") or soup.find("table")
    if not table:
        return []
    holds = []
    rank = 0
    for tr in table.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) < 6:
            continue
        stock = cells[1].get_text(" ", strip=True)  # "AAPL- Apple Inc."
        sm = re.match(r"([A-Z][A-Z0-9\.\-]*)\s*[-–]\s*(.*)", stock)
        if not sm:
            continue
        ticker = sm.group(1).strip().upper()
        name = sm.group(2).strip()
        pct = cells[2].get_text(strip=True).replace("%", "")
        activity = cells[3].get_text(" ", strip=True)
        try:
            pct_f = float(pct)
        except ValueError:
            pct_f = None
        rank += 1
        holds.append({
            "ticker": ticker, "stock_name": name, "pct_of_portfolio": pct_f,
            "rank_in_portfolio": rank, "change_type": _change_type(activity),
        })
        if rank >= top:
            break
    return holds


def fetch_manager(mgr: dict, top: int) -> dict | None:
    try:
        r = requests.get(HOLD.format(code=mgr["code"]), headers=UA, timeout=25)
        r.raise_for_status()
        holds = parse_holdings(r.text, top)
        if not holds:
            return None
        person = mgr["person"]
        display = person or mgr["fund"]
        name_cn = NAME_CN.get(person.lower()) if person else None
        return {
            "slug": slugify(display),
            "name": name_cn or display,
            "name_en": display,
            "entity": mgr["fund"] or None,
            "type": "superinvestor",
            "archetype": "contract",
            "country": "US",
            "aum_usd": None,
            "holdings_count": len(holds),
            "notable_for": None,
            "latest_period": mgr["updated"] or "2026Q1",
            "holdings": [{
                "ticker": h["ticker"], "market": "us", "stock_name": h["stock_name"],
                "period": mgr["updated"] or "2026Q1", "shares": None, "market_value": None,
                "pct_of_portfolio": h["pct_of_portfolio"], "rank_in_portfolio": h["rank_in_portfolio"],
                "change_type": h["change_type"], "change_pct": None, "source": "dataroma",
            } for h in holds],
        }
    except Exception as e:
        print(f"   ⚠ {mgr['code']}: {str(e)[:50]}")
        return None


def rebuild_by_ticker(investors: list[dict]) -> dict:
    by: dict[str, list] = {}
    for inv in investors:
        for h in inv.get("holdings", []):
            t = h.get("ticker")
            if not t:
                continue
            by.setdefault(t, []).append({
                "investor": inv["name"], "slug": inv["slug"], "type": inv["type"],
                "archetype": inv.get("archetype"), "entity": inv.get("entity"),
                "pct": h.get("pct_of_portfolio"), "rank": h.get("rank_in_portfolio"),
                "change_type": h.get("change_type"),
                "amount_range": h.get("amount_range"), "trade_date": h.get("trade_date"),
                "period": h.get("period"),
            })
    # 每只票按仓位占比降序
    for t in by:
        by[t].sort(key=lambda x: (x["pct"] or 0), reverse=True)
    return by


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只抓前 N 个经理(测试)")
    ap.add_argument("--top-holdings", type=int, default=40, help="每位经理取前 N 大持仓")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    print("🐋 抓超级投资者持仓(Dataroma)...")
    home = requests.get(HOME, headers=UA, timeout=25).text
    mgrs = parse_managers(home)
    if args.limit:
        mgrs = mgrs[: args.limit]
    print(f"   {len(mgrs)} 位经理")

    t0 = time.time()
    supers = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(fetch_manager, m, args.top_holdings): m for m in mgrs}
        for fut in as_completed(futs):
            inv = fut.result()
            if inv:
                supers.append(inv)
    print(f"   ✓ {len(supers)} 位有持仓 ({time.time()-t0:.0f}s)")

    # 合并:保留现有非 superinvestor(A股顶流/政客),superinvestor 用 Dataroma 全替换
    existing = {"investors": [], "by_ticker": {}}
    if WHALES[0].exists():
        existing = json.loads(WHALES[0].read_text(encoding="utf-8"))
    kept = [i for i in existing.get("investors", []) if i.get("type") != "superinvestor"]
    supers.sort(key=lambda i: i.get("holdings_count") or 0, reverse=True)
    merged_investors = kept + supers
    by_ticker = rebuild_by_ticker(merged_investors)
    data = {"investors": merged_investors, "by_ticker": by_ticker}

    for w in WHALES:
        w.parent.mkdir(parents=True, exist_ok=True)
        w.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    # 入库(SoT 备份)
    try:
        sys.path.insert(0, str(ROOT))
        from db import connect, init_schema
        init_schema()
        c = connect()
        gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        c.executemany(
            "INSERT INTO superinvestors(slug,data,updated_at) VALUES(?,?,?) "
            "ON CONFLICT(slug) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
            [(inv["slug"], json.dumps(inv, ensure_ascii=False), gen) for inv in supers])
        c.execute("INSERT INTO meta(key,value) VALUES('superinvestors_generated_at',?) "
                  "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (gen,))
        c.commit()
        print(f"   ↳ 入库 leslie.db.superinvestors: {len(supers)}")
    except Exception as e:
        print(f"   ↳ 入库跳过: {e}")

    print(f"✅ whales.json:{len(merged_investors)} 投资者(含 {len(supers)} 超级投资者)· "
          f"{len(by_ticker)} 只票有持仓 → data/whales.json")
    # 巴菲特 / 段永平 抽样
    for inv in merged_investors:
        if inv["slug"] in ("warren-buffett", "duan-yongping"):
            top3 = ", ".join(f"{h['ticker']}({h['pct_of_portfolio']}%)" for h in inv["holdings"][:3])
            print(f"   {inv['name']}: {top3}")


if __name__ == "__main__":
    main()
