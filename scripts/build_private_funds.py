"""私募大佬 → 聪明钱「私募大佬」镜头(type=private_fund)。

数据:akshare stock_gdfx_free_holding_analyse_em(全市场十大流通股东,季度全披露)。
口径:按管理公司名匹配知名价值私募(用「关键词 + 名称长度≥8」剔除同名个人股东),
      跨同一私募的多只产品按个股聚合流通市值;pct = 该股市值÷该私募披露总市值(占披露持仓比)。
      持股变动(新进/增/减)→ change_type。注:仅覆盖进入个股前十大流通股东的【集中大仓】,
      非该私募全部持仓(分散/小仓不披露)。

慢(全市场抓取 ~10min,带 4 次重试 + 本地缓存)。用法: uv run python -m scripts.build_private_funds
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from datetime import datetime

import akshare as ak
import pandas as pd

from db import connect
from scripts.seed_investors import upsert_investor, insert_holding

NOW = datetime.now().isoformat()
DATE = "20260331"          # 2026Q1(十大流通股东每季全披露)
PERIOD = "2026Q1"
CACHE = f"/tmp/gdfx_{DATE}.json"


def p(*a):
    print(*a); sys.stdout.flush()


# (slug, 显示名, 机构, 简介, 关键词列表, 子串过滤[高毅拆分用])
PRIVATE = [
    ("gaoyi-dengxiaofeng", "邓晓峰", "高毅资产", "高毅资产首席投资官,管理百亿级;制造业 + 周期成长深度研究,集中持有", ["高毅"], "晓峰"),
    ("gaoyi-fengliu",       "冯柳", "高毅资产", "高毅资产,草根派逆向高手,邻山系列;弱者体系、左侧重仓冷门", ["高毅"], "邻山"),
    ("chongyang",           "裘国根", "重阳投资", "老牌价值私募,绝对收益思维,安全边际优先", ["重阳战略", "重阳投资", "重阳目标"], None),
    ("jinglin",             "蒋锦志", "景林资产", "中国最大股票私募之一,全球视野选好公司、长期持有", ["景林资产"], None),
    ("ruijun",              "董承非·杜昌勇", "睿郡资产", "公募老将奔私(原兴全/睿远),均衡价值、控回撤", ["睿郡资产"], None),
    ("ningquan",            "杨东", "宁泉资产", "杨东(原兴全总经理)创立,逆向 + 绝对收益、敢空仓", ["宁泉资产"], None),
    ("renqiao",             "夏俊杰", "仁桥资产", "深度价值 + 逆向,绝对收益、低估分散", ["仁桥泽源", "仁桥金选", "仁桥(北京)"], None),
    ("shenzhi",             "余海丰", "慎知资产", "慎知资产,绝对收益、行知系列", ["慎知"], None),
    ("chongji",             "—", "冲积资产", "冲积资产,积极成长私募", ["冲积资产"], None),
    ("qinchen",             "—", "勤辰资产", "勤辰资产,公募派奔私、均衡成长", ["勤辰"], None),
]


def _change(v: str) -> str:
    s = str(v or "")
    if "新" in s: return "new"
    if "增" in s: return "add"
    if "减" in s: return "trim"
    return "hold"


def load_df() -> pd.DataFrame:
    if os.path.exists(CACHE):
        p(f"用缓存 {CACHE}")
        return pd.read_json(CACHE)
    p(f"抓 stock_gdfx_free_holding_analyse_em(date={DATE}) …(最多重试 4 次)")
    for attempt in range(1, 5):
        try:
            df = ak.stock_gdfx_free_holding_analyse_em(date=DATE)
            df.to_json(CACHE, orient="records", force_ascii=False)
            return df
        except Exception as ex:
            p(f"  尝试 {attempt} 失败: {str(ex)[:80]}")
    raise RuntimeError("全市场十大流通股东抓取失败")


def build(min_holds: int = 3, max_hold: int = 30):
    df = load_df()
    name_col = "股东名称"
    val_col = "期末持股-流通市值"     # 元
    chg_col = "期末持股-持股变动"
    names = df[name_col].astype(str)
    nlen = names.str.len()

    with connect(readonly=False) as conn:
        # 整批重建 private_fund
        old = conn.execute("SELECT id FROM investors WHERE type='private_fund'").fetchall()
        for o in old:
            conn.execute("DELETE FROM holdings WHERE investor_id=?", (o["id"],))
        conn.execute("DELETE FROM investors WHERE type='private_fund'")

        built = 0
        for slug, disp, entity, notable, kws, sub in PRIVATE:
            # 关键词命中 + 名称≥8字(剔同名个人) + 子串(高毅拆分)
            mask = names.str.contains("|".join(kws), na=False, regex=True) & (nlen >= 8)
            if sub:
                mask &= names.str.contains(sub, na=False)
            rows = df[mask]
            if rows.empty:
                p(f"  · {disp}({entity}): 无")
                continue
            # 按个股聚合市值(同私募多产品合并)
            agg: dict[str, dict] = defaultdict(lambda: {"name": "", "val": 0.0, "chg": "hold"})
            for _, r in rows.iterrows():
                code = str(r["股票代码"]).split(".")[0].zfill(6)
                a = agg[code]
                a["name"] = str(r["股票简称"])
                a["val"] += float(r[val_col]) if pd.notna(r[val_col]) else 0.0
                if a["chg"] == "hold":
                    a["chg"] = _change(r.get(chg_col))
            if len(agg) < min_holds:
                p(f"  · {disp}({entity}): 仅 {len(agg)} 只,跳过")
                continue
            total = sum(a["val"] for a in agg.values()) or 1
            items = sorted(agg.items(), key=lambda kv: kv[1]["val"], reverse=True)[:max_hold]

            inv_id = upsert_investor(
                conn, slug=slug, name=disp, name_en=None, entity=entity,
                type="private_fund", archetype=None, country="CN", aum_usd=None,
                holdings_count=len(items), notable_for=notable,
                latest_period=PERIOD, updated_at=NOW,
            )
            for rank, (code, a) in enumerate(items, 1):
                insert_holding(
                    conn, inv_id, ticker=code, market="a", stock_name=a["name"],
                    period=PERIOD, shares=None,
                    market_value=round(a["val"] / 1e4, 1),                 # 万元
                    pct_of_portfolio=round(a["val"] / total * 100, 1),     # 占其披露持仓比
                    rank_in_portfolio=rank, change_type=a["chg"], change_pct=None,
                    source="十大流通股东", disclosed_at=PERIOD,
                )
            built += 1
            top = items[0][1]
            p(f"  ✓ {disp:9}({entity}) {len(items)}只 e.g.{top['name']}({top['val']/1e8:.1f}亿)")
        conn.commit()
        p(f"\n✅ 私募 {built} 家入库")


if __name__ == "__main__":
    build()
