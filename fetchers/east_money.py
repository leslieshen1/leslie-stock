"""东方财富数据客户端。

绕过 TLS-fingerprint 反爬：用 curl_cffi 模拟 Chrome 浏览器调用
push2.eastmoney.com 系列 endpoint。akshare 默认用 requests 会被
反爬识别，这里直接走原始 API + curl_cffi。
"""
from __future__ import annotations

import time
from typing import Iterator

import pandas as pd
from curl_cffi import requests as cffi_requests

EM_FIELDS = {
    "f2": "price",
    "f3": "change_pct",
    "f4": "change",
    "f5": "volume",
    "f6": "amount",
    "f7": "amplitude",
    "f8": "turnover",
    "f9": "pe_dynamic",
    "f10": "volume_ratio",
    "f12": "code",
    "f14": "name",
    "f15": "high",
    "f16": "low",
    "f17": "open",
    "f18": "prev_close",
    "f20": "market_cap",
    "f21": "circ_market_cap",
    "f22": "speed",
    "f23": "pb",
    "f24": "change_5d",
    "f25": "change_20d",
    "f62": "main_net_inflow",
    "f115": "pe_static",
    "f128": "industry",
    "f136": "pe_ttm",
    "f152": "decimal",
}

MARKET_FILTERS = {
    "a": "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048",
    "hk_all": "m:128+t:1,m:128+t:2,m:128+t:3,m:128+t:4",
    "hk_main": "m:128+t:3,m:128+t:4",
}

PUSH_HOSTS_A = ["72.push2", "82.push2", "92.push2", "27.push2"]
PUSH_HOSTS_HK = ["81.push2", "71.push2", "91.push2"]

# 已验证可绕过反爬的浏览器指纹。反爬规则会动态变化，需要多指纹轮换。
IMPERSONATES = ["edge101", "safari17_0", "chrome120", "chrome116", "edge99"]


def _fields_string(fields: list[str]) -> str:
    return ",".join(fields)


def _request_em(host: str, params: dict, impersonate: str = "edge101", timeout: int = 8) -> dict:
    url = f"https://{host}.eastmoney.com/api/qt/clist/get"
    r = cffi_requests.get(url, params=params, impersonate=impersonate, timeout=timeout)
    r.raise_for_status()
    return r.json()


def _request_em_robust(host: str, params: dict, hosts_alt: list[str] | None = None) -> dict:
    """对单页做最佳努力请求 — 多 fingerprint × 多 host 轮换，附 sleep 退避。"""
    all_hosts = [host] + (hosts_alt or [])
    last_err: Exception | None = None
    for attempt in range(2):
        for imp in IMPERSONATES:
            for h in all_hosts:
                try:
                    return _request_em(h, params, impersonate=imp, timeout=8)
                except Exception as e:
                    last_err = e
                    continue
        if attempt == 0:
            time.sleep(3)  # 第一轮失败完整一遍后退避
    raise RuntimeError(f"all retries failed: {last_err}") from last_err


def fetch_market_list(
    market: str = "a",
    fields: list[str] | None = None,
    page_size: int = 200,
    sleep_between: float = 0.5,
    verbose: bool = True,
) -> pd.DataFrame:
    """拉某个市场全部股票的实时行情快照。

    Args:
        market: "a" / "hk_all" / "hk_main"
        fields: 要拿的 f-codes，默认拿一组常用字段
        page_size: 每页大小
        sleep_between: 翻页之间睡眠时间（防止请求太密）
        verbose: 是否打印翻页进度
    """
    if fields is None:
        fields = [
            "f12", "f14", "f2", "f3", "f5", "f6", "f9", "f23",
            "f20", "f21", "f136", "f115", "f128",
        ]

    hosts = PUSH_HOSTS_A if market == "a" else PUSH_HOSTS_HK
    fs = MARKET_FILTERS[market]

    base_params = {
        "po": 1, "np": 1, "fltt": 2, "invt": 2, "fid": "f12",
        "fs": fs,
        "fields": _fields_string(fields),
    }

    all_rows: list[dict] = []
    page = 1
    total: int | None = None

    while True:
        params = {**base_params, "pn": page, "pz": page_size}
        data = _request_em_robust(hosts[0], params, hosts_alt=hosts[1:])

        if data.get("data") is None:
            break
        items = data["data"].get("diff") or []
        if not items:
            break

        if total is None:
            total = data["data"].get("total", len(items))

        all_rows.extend(items)
        if verbose and (page == 1 or page % 5 == 0):
            print(f"  [{market}] 翻页 {page}: 已拉 {len(all_rows)}/{total}", flush=True)
        if len(all_rows) >= total:
            break
        page += 1
        time.sleep(sleep_between)

    if verbose:
        print(f"  [{market}] 完成: {len(all_rows)} 只", flush=True)

    df = pd.DataFrame(all_rows)
    # rename f-codes to readable
    rename = {f: EM_FIELDS[f] for f in df.columns if f in EM_FIELDS}
    df = df.rename(columns=rename)
    return df


def fetch_single_quote(code: str, market: str = "a") -> dict:
    """拿单只股票最新行情快照。

    code: A 股 6 位代码 / 港股 5 位代码
    """
    secid = _to_secid(code, market)
    fields = ",".join([
        "f43", "f44", "f45", "f46", "f47", "f48",
        "f57", "f58", "f60", "f116", "f117", "f127",
        "f162", "f164", "f167", "f168", "f169", "f170", "f171",
    ])
    url = "https://push2.eastmoney.com/api/qt/stock/get"
    params = {"secid": secid, "fields": fields, "invt": 2, "fltt": 2}
    data = None
    last_err: Exception | None = None
    for attempt in range(2):
        for imp in IMPERSONATES:
            try:
                r = cffi_requests.get(url, params=params, impersonate=imp, timeout=8)
                r.raise_for_status()
                data = r.json().get("data") or {}
                break
            except Exception as e:
                last_err = e
                continue
        if data is not None:
            break
        if attempt == 0:
            time.sleep(2)
    if data is None:
        raise RuntimeError(f"single quote failed for {code}: {last_err}") from last_err
    return {
        "code": code,
        "name": data.get("f58"),
        "price": data.get("f43"),
        "change_pct": data.get("f170"),
        "change": data.get("f169"),
        "high": data.get("f44"),
        "low": data.get("f45"),
        "open": data.get("f46"),
        "prev_close": data.get("f60"),
        "volume": data.get("f47"),
        "amount": data.get("f48"),
        "market_cap": data.get("f116"),
        "circ_market_cap": data.get("f117"),
        "pe_ttm": data.get("f164"),
        "pe_static": data.get("f162"),
        "pb": data.get("f167"),
        "industry": data.get("f127"),
        "turnover": data.get("f168"),
        "amplitude": data.get("f171"),
    }


def _to_secid(code: str, market: str) -> str:
    """东财 secid 格式：market.code，market 0=深 1=沪 116=港 105=美."""
    if market == "a":
        if code.startswith(("60", "68", "9", "5")):
            return f"1.{code}"
        return f"0.{code}"
    if market in ("hk", "hk_all", "hk_main"):
        return f"116.{code.zfill(5)}"
    raise ValueError(f"unknown market: {market}")


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "single":
        code = sys.argv[2] if len(sys.argv) > 2 else "600519"
        mkt = sys.argv[3] if len(sys.argv) > 3 else "a"
        print(fetch_single_quote(code, mkt))
    else:
        df = fetch_market_list("a", page_size=100)
        print(f"A股: {len(df)} 只")
        print(df.head())
