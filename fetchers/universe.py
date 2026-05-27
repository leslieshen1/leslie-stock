"""股票池缓存：拉全 A + 全港股的代码/名称/行业/市值/估值快照。

每天跑一次，写到 data/universe.parquet。
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from .east_money import fetch_market_list

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)
UNIVERSE_PATH = DATA_DIR / "universe.parquet"


def fetch_universe(save: bool = True, verbose: bool = True) -> pd.DataFrame:
    """拉全 A + 全港股的股票池快照。"""
    if verbose:
        print("拉 A 股全量 …")
    df_a = fetch_market_list("a", page_size=200)
    df_a["market"] = "A"

    if verbose:
        print(f"  A 股: {len(df_a)} 只")
        print("拉港股全量 …")
    df_hk = fetch_market_list("hk_all", page_size=200)
    df_hk["market"] = "HK"
    if verbose:
        print(f"  港股: {len(df_hk)} 只")

    df = pd.concat([df_a, df_hk], ignore_index=True)
    df = _clean(df)

    if save:
        df.to_parquet(UNIVERSE_PATH, index=False)
        # 同时导出 lite JSON 给 Next.js 搜索用
        json_path = DATA_DIR / "universe.json"
        cols = ["code", "name", "market", "market_cap"]
        if "industry" in df.columns:
            cols.append("industry")
        df[cols].to_json(json_path, orient="records", force_ascii=False)
        if verbose:
            print(f"已保存 {len(df)} 只股票到 {UNIVERSE_PATH}")
            print(f"  搜索用 JSON: {json_path}")
    return df


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    # 所有非字符串列尝试转 numeric（东财对没数据的字段返回字符串 "-"）
    text_cols = {"code", "name", "industry", "market"}
    for col in df.columns:
        if col in text_cols:
            df[col] = df[col].astype(str)
        else:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    # 过滤掉无价无市值的（停牌、退市、可转债等噪音）
    df = df[df["price"].notna() & (df["price"] > 0)]
    df = df[df["market_cap"].notna() & (df["market_cap"] > 0)]
    return df.reset_index(drop=True)


def load_universe() -> pd.DataFrame:
    if not UNIVERSE_PATH.exists():
        raise FileNotFoundError(
            f"universe.parquet 不存在，请先跑：uv run python -m fetchers.universe"
        )
    return pd.read_parquet(UNIVERSE_PATH)


if __name__ == "__main__":
    df = fetch_universe()
    print()
    print("=== 按市场统计 ===")
    print(df.groupby("market").size())
    print()
    print("=== 各市场样本 ===")
    print(df[df["market"] == "A"].head(3)[["code", "name", "price", "pe_ttm", "pb", "market_cap"]])
    print()
    print(df[df["market"] == "HK"].head(3)[["code", "name", "price", "pe_ttm", "pb", "market_cap"]])
