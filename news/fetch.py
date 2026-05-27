"""新闻聚合：东方财富个股新闻 + 巨潮上市公司公告。

数据源：
- 东方财富：akshare.stock_news_em(symbol=code)  ← A 股
- 巨潮（cninfo）：直接 POST API                ← A 股公告权威源
- 港股财经新闻：akshare.stock_hk_news_em(symbol=code)

CLI:
    uv run python -m news.fetch 600519 a
    uv run python -m news.fetch 00700 hk
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import pandas as pd
from curl_cffi import requests as cffi_requests

ROOT = Path(__file__).parent.parent
NEWS_DIR = ROOT / "data" / "news"
NEWS_DIR.mkdir(parents=True, exist_ok=True)

# 浏览器指纹（绕反爬）
IMPERSONATES = ["chrome120", "edge101", "safari17_0"]


def cache_path(code: str, market: str) -> Path:
    return NEWS_DIR / f"{code}_{market}.json"


def fetch_news_for_stock(code: str, market: str = "a",
                         days: int = 7) -> dict:
    """拉一只股票的新闻 + 公告，写到 data/news/{code}_{market}.json。

    Args:
        code: 股票代码
        market: a / hk
        days: 只保留最近 N 天的新闻
    """
    cutoff = datetime.now() - timedelta(days=days)

    news = _fetch_news(code, market)
    news = [n for n in news if _newer_than(n.get("pub_time"), cutoff)]

    anns = []
    if market == "a":
        anns = _fetch_announcements_cninfo(code)
        anns = [a for a in anns if _newer_than(a.get("pub_time"), cutoff)]

    payload = {
        "code": code,
        "market": market,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "days": days,
        "news": news[:30],
        "announcements": anns[:20],
    }
    cache_path(code, market).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return payload


# ===== 东方财富新闻搜索 API（直接 HTTP，绕过 akshare 的 regex bug） =====

EM_NEWS_URL = "https://search-api-web.eastmoney.com/search/jsonp"


def _fetch_news(code: str, market: str) -> list[dict]:
    """通过东财搜索 API 拉个股新闻（A 股 + 港股都用同一个接口）."""
    import json as _json
    keyword = code
    if market == "hk":
        # 港股代码搜索时去掉前导 0 命中率更高
        keyword = code.lstrip("0") or code

    param = {
        "uid": "",
        "keyword": keyword,
        "type": ["cmsArticleWebOld"],
        "client": "web",
        "clientType": "web",
        "clientVersion": "curr",
        "param": {
            "cmsArticleWebOld": {
                "searchScope": "default",
                "sort": "default",
                "pageIndex": 1,
                "pageSize": 30,
                "preTag": "",
                "postTag": "",
            }
        },
    }
    params = {"cb": "j", "param": _json.dumps(param), "_": "1700000000000"}

    last_err = None
    for imp in IMPERSONATES:
        try:
            r = cffi_requests.get(EM_NEWS_URL, params=params, impersonate=imp, timeout=10)
            r.raise_for_status()
            text = r.text
            if text.startswith("j("):
                text = text[2:-1]
            data = _json.loads(text)
            articles = data.get("result", {}).get("cmsArticleWebOld") or []
            return _normalize_em_articles(articles)
        except Exception as e:
            last_err = e
            continue
    return [{"_error": str(last_err)[:200] if last_err else "未知错误", "source": "eastmoney"}]


def _normalize_em_articles(items: list) -> list[dict]:
    out: list[dict] = []
    for a in items:
        out.append({
            "title": (a.get("title") or "").replace("<em>", "").replace("</em>", ""),
            "source": a.get("mediaName") or "东方财富",
            "pub_time": a.get("date") or "",
            "summary": (a.get("content") or "").replace("<em>", "").replace("</em>", "")[:600],
            "url": a.get("url") or "",
        })
    return out


# ===== 巨潮公告 =====

CNINFO_API = "http://www.cninfo.com.cn/new/hisAnnouncement/query"

def _exchange_for_code(code: str) -> str:
    """A 股代码 → 巨潮交易所标识。"""
    if code.startswith(("60", "68", "9", "5")):
        return "sse"
    if code.startswith(("00", "30", "20", "002", "300")):
        return "szse"
    if code.startswith("8"):
        return "bjse"
    return "sse"


def _fetch_announcements_cninfo(code: str) -> list[dict]:
    """从巨潮拉上市公司公告。"""
    exch = _exchange_for_code(code)
    payload = {
        "stock": f"{code},{exch}",
        "tabName": "fulltext",
        "pageSize": 30,
        "pageNum": 1,
        "isHLtitle": "true",
    }
    headers = {
        "Accept": "*/*",
        "Origin": "http://www.cninfo.com.cn",
        "Referer": "http://www.cninfo.com.cn/new/disclosure/stock?stockCode=" + code,
    }
    for imp in IMPERSONATES:
        try:
            r = cffi_requests.post(
                CNINFO_API, data=payload, headers=headers,
                impersonate=imp, timeout=15,
            )
            r.raise_for_status()
            data = r.json()
            return _normalize_announcements(data.get("announcements") or [])
        except Exception:
            continue
    return []


def _normalize_announcements(items: list) -> list[dict]:
    out: list[dict] = []
    for ann in items:
        out.append({
            "title": ann.get("announcementTitle", ""),
            "type": ann.get("announcementType") or ann.get("announcementTypeName") or "",
            "pub_time": _ms_to_iso(ann.get("announcementTime")),
            "url": f"http://static.cninfo.com.cn/{ann.get('adjunctUrl', '')}",
            "size_kb": int(ann.get("adjunctSize", 0) or 0),
        })
    return out


# ===== 工具 =====

def _ms_to_iso(ms: Any) -> str:
    try:
        return datetime.fromtimestamp(int(ms) / 1000).isoformat(timespec="seconds")
    except (TypeError, ValueError):
        return str(ms or "")


def _newer_than(ts: str | None, cutoff: datetime) -> bool:
    if not ts:
        return True  # 缺时间不过滤
    try:
        for fmt in (
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d",
        ):
            try:
                return datetime.strptime(ts[:19], fmt) >= cutoff
            except ValueError:
                continue
    except Exception:
        pass
    return True


def load_cached_news(code: str, market: str) -> dict | None:
    p = cache_path(code, market)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


if __name__ == "__main__":
    code = sys.argv[1] if len(sys.argv) > 1 else "600519"
    market = sys.argv[2] if len(sys.argv) > 2 else "a"
    days = int(sys.argv[3]) if len(sys.argv) > 3 else 7

    print(f">>> 拉 {code} ({market.upper()}) 最近 {days} 天新闻 + 公告 …")
    data = fetch_news_for_stock(code, market, days=days)
    print()
    print(f"新闻 {len(data['news'])} 条 · 公告 {len(data['announcements'])} 条")
    print()
    print("=== 新闻 TOP 5 ===")
    for n in data["news"][:5]:
        if "_error" in n:
            print(f"  ❌ {n['_error'][:100]}")
            continue
        print(f"  [{n.get('pub_time', '')[:16]}] {n['title']}")
        if n.get("source"):
            print(f"      源: {n['source']}")
    print()
    print("=== 公告 TOP 5 ===")
    for a in data["announcements"][:5]:
        print(f"  [{a['pub_time'][:10]}] {a['title']} ({a.get('type', '')})")
    print()
    print(f"已保存：{cache_path(code, market)}")
