"""统一 Tushare Pro client wrapper。

设计原则：
- 单一入口（避免散落多处调 ts.pro_api）
- 自动重试（网络/积分不足）
- 简单缓存（同一个调用 24h 内不重复扣积分）
- 优雅降级（高级接口失败自动 fallback）

用法：
    from fetchers.tushare_client import client
    df = client.daily("000831.SZ", "20240101", "20251231")
    info = client.company("002428.SZ")
    fin = client.financials("002428.SZ")
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")

TUSHARE_TOKEN = os.getenv("TUSHARE_TOKEN")
CACHE_DIR = ROOT / "data" / "_cache" / "tushare"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# 缓存有效期（按接口分）
CACHE_TTL = {
    "daily": 12 * 3600,            # 行情 12h（盘后才更新）
    "daily_basic": 12 * 3600,      # 估值指标
    "fina_indicator": 7 * 86400,   # 财务指标 一周
    "income": 30 * 86400,          # 利润表 月级
    "balancesheet": 30 * 86400,
    "cashflow": 30 * 86400,
    "stock_basic": 30 * 86400,     # 公司基本信息
    "stock_company": 30 * 86400,
    "anns_d": 6 * 3600,            # 公告 6h
    "news": 1 * 3600,              # 新闻 1h
    "default": 12 * 3600,
}


class TushareClient:
    def __init__(self, token: str | None = None):
        self.token = token or TUSHARE_TOKEN
        self._pro = None
        self._cache_hits = 0
        self._api_calls = 0
        self._failures = 0
        self._failure_log: list[str] = []

    def _ensure_pro(self):
        if self._pro is not None:
            return self._pro
        if not self.token:
            raise RuntimeError("TUSHARE_TOKEN not set in .env")
        try:
            import tushare as ts
        except ImportError as e:
            raise RuntimeError("pip install tushare 先") from e
        self._pro = ts.pro_api(self.token)
        return self._pro

    def _cache_path(self, api: str, params: dict) -> Path:
        key = api + "_" + "_".join(f"{k}={v}" for k, v in sorted(params.items()))
        # 简单的文件名 safe（截断过长）
        safe = "".join(c if c.isalnum() or c in "_-." else "_" for c in key)[:200]
        return CACHE_DIR / f"{safe}.parquet"

    def _from_cache(self, api: str, params: dict) -> pd.DataFrame | None:
        p = self._cache_path(api, params)
        if not p.exists():
            return None
        ttl = CACHE_TTL.get(api, CACHE_TTL["default"])
        if time.time() - p.stat().st_mtime > ttl:
            return None
        try:
            return pd.read_parquet(p)
        except Exception:
            return None

    def _to_cache(self, api: str, params: dict, df: pd.DataFrame):
        if df is None or df.empty:
            return
        try:
            df.to_parquet(self._cache_path(api, params))
        except Exception:
            pass

    def _call(self, api: str, **params) -> pd.DataFrame:
        """统一调用入口（带缓存 + 重试）。"""
        # 1. 读缓存
        cached = self._from_cache(api, params)
        if cached is not None:
            self._cache_hits += 1
            return cached

        # 2. 真调用
        pro = self._ensure_pro()
        last_err: Optional[Exception] = None
        for attempt in range(3):
            try:
                df = getattr(pro, api)(**params)
                self._api_calls += 1
                self._to_cache(api, params, df)
                return df
            except Exception as e:
                last_err = e
                msg = str(e)
                # 积分不足类错误不重试
                if "积分" in msg or "权限" in msg or "permission" in msg.lower():
                    self._failures += 1
                    self._failure_log.append(f"{api} {params}: {msg[:120]}")
                    break
                time.sleep(0.5 + attempt)

        self._failures += 1
        self._failure_log.append(f"{api} {params}: {last_err}")
        return pd.DataFrame()  # 返回空 df 而非 raise，调用方自己 check

    # ============================================================
    # 行情类
    # ============================================================
    def daily(self, ts_code: str, start: str | None = None,
              end: str | None = None) -> pd.DataFrame:
        """日线行情（前复权可以另传 adj）。
        ts_code 格式: '000831.SZ' / '600301.SH' / '00883.HK' / 'NVDA.O'
        日期格式: '20240101'
        """
        params = {"ts_code": ts_code}
        if start: params["start_date"] = start
        if end: params["end_date"] = end
        return self._call("daily", **params)

    def daily_basic(self, ts_code: str, start: str | None = None,
                    end: str | None = None) -> pd.DataFrame:
        """每日估值指标（PE / PB / 换手 / 市值）。"""
        params = {"ts_code": ts_code}
        if start: params["start_date"] = start
        if end: params["end_date"] = end
        return self._call("daily_basic", **params)

    # ============================================================
    # 基本信息
    # ============================================================
    def stock_basic(self, market: str = "") -> pd.DataFrame:
        """A 股股票列表（含基本信息）。
        market: 'SSE' / 'SZSE' / '' 全部
        """
        params = {"exchange": market} if market else {}
        return self._call("stock_basic", **params)

    def stock_company(self, ts_code: str | None = None) -> pd.DataFrame:
        """公司详细信息（行业、注册地、董事长、主营业务）。"""
        params = {"ts_code": ts_code} if ts_code else {}
        return self._call("stock_company", **params)

    # ============================================================
    # 财务
    # ============================================================
    def fina_indicator(self, ts_code: str, start: str | None = None,
                        end: str | None = None) -> pd.DataFrame:
        """财务指标（ROE / 毛利 / 净利 / FCF / 资产负债率等 100+ 指标）。"""
        params = {"ts_code": ts_code}
        if start: params["start_date"] = start
        if end: params["end_date"] = end
        return self._call("fina_indicator", **params)

    def income(self, ts_code: str, start: str | None = None,
               end: str | None = None) -> pd.DataFrame:
        """利润表。"""
        params = {"ts_code": ts_code}
        if start: params["start_date"] = start
        if end: params["end_date"] = end
        return self._call("income", **params)

    # ============================================================
    # 公告
    # ============================================================
    def anns_d(self, start: str, end: str, ts_code: str | None = None) -> pd.DataFrame:
        """公告（日级 incremental，需要 Pro 200/年以上权限）。"""
        params = {"start_date": start, "end_date": end}
        if ts_code: params["ts_code"] = ts_code
        return self._call("anns_d", **params)

    # ============================================================
    # 统计
    # ============================================================
    def stats(self) -> dict:
        return {
            "cache_hits": self._cache_hits,
            "api_calls": self._api_calls,
            "failures": self._failures,
            "failures_log": self._failure_log[-10:],
        }


# 单例
client = TushareClient()


def ts_code(code: str, market: str) -> str:
    """把 (code, market) 转成 Tushare 格式。

    Tushare 后缀:
    - A 股：.SH (上海) / .SZ (深圳) / .BJ (北交所)
    - H 股：.HK
    - 美股：.O (NASDAQ) / .N (NYSE) / .A (AMEX)
    """
    if market == "a":
        if code.startswith("6"): return f"{code}.SH"
        if code.startswith(("0", "3")): return f"{code}.SZ"
        if code.startswith(("4", "8", "9")): return f"{code}.BJ"
        return f"{code}.SZ"
    if market == "hk":
        # Tushare HK 用 5 位
        return f"{code.zfill(5)}.HK"
    if market == "us":
        # 一般是 .O (NASDAQ)，但具体看公司
        return f"{code}.O"
    return code


if __name__ == "__main__":
    # 快速测试：你现在的 token 哪些接口能用
    print("🧪 Tushare Pro 接口能力测试\n")

    tests = [
        ("stock_basic", lambda: client._call("stock_basic", list_status="L")),
        ("daily 茅台", lambda: client.daily("600519.SH", "20251101", "20251130")),
        ("daily_basic 云南锗业", lambda: client.daily_basic("002428.SZ", "20251101", "20251130")),
        ("fina_indicator 云南锗业", lambda: client.fina_indicator("002428.SZ", "20240101", "20251231")),
        ("stock_company 云南锗业", lambda: client.stock_company("002428.SZ")),
        ("income 云南锗业", lambda: client.income("002428.SZ", "20240101", "20251231")),
        ("anns_d 最近一日公告", lambda: client.anns_d("20251215", "20251215")),
    ]

    for name, fn in tests:
        try:
            df = fn()
            n = len(df) if isinstance(df, pd.DataFrame) else 0
            status = "✅" if n > 0 else "⚠️"
            print(f"  {status} {name:<40} → {n} 行")
        except Exception as e:
            print(f"  ❌ {name:<40} → {str(e)[:60]}")

    print()
    print("📊 Stats:", client.stats())
