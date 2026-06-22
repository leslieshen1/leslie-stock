"""龙虎榜游资席位 → 聪明钱「游资席位」镜头(type=hot_money)。

数据:akshare stock_lhb_hyyyb_em(每日活跃营业部 + 买入个股)。
口径:近 ~45 天,按累计买入金额取最活跃的游资营业部(剔除北向/机构/量化散户席位),
      每个席位的近期买入个股作为 holdings(change_type=买入 + 上榜日,走 TradeRow 渲染)。

用法: uv run python -m scripts.build_lhb_hotmoney
"""
from __future__ import annotations

import hashlib
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta

import akshare as ak
import pandas as pd

from db import connect
from scripts.seed_investors import upsert_investor, insert_holding

NOW = datetime.now().isoformat()


def p(*a):
    print(*a)
    sys.stdout.flush()


# 非游资席位——剔除:北向(专用)、机构自营(总部)、外资投行、量化散户通道(拉萨/山南/互联网/网络金融)
EXCLUDE = (
    "专用", "总部",                                          # 北向/QFII/机构专用、券商总部自营
    "拉萨", "山南",                                          # 东方财富西藏量化散户席位
    "互联网", "网络金融",                                    # 散户聚合通道
    "高盛", "摩根", "瑞银", "瑞信", "汇丰", "野村", "中金",  # 外资/合资投行(机构盘)
    "中国国际金融", "大和", "星展", "花旗", "法国巴黎",
    "麦格理", "巴克莱", "德意志", "瑞士",
)


def short_seat(name: str) -> str:
    """'华鑫证券有限责任公司上海宛平南路证券营业部' → '华鑫·上海宛平南路'。"""
    brk = re.match(r"^(.{2,6}?证券)", name)
    broker = brk.group(1).replace("证券", "") if brk else name[:3]
    loc = name
    loc = re.sub(r"^.{2,6}?证券", "", loc)
    loc = re.sub(r"(股份有限公司|有限责任公司|有限公司|证券营业部|营业部|分公司|第[一二三四五六七八九十\d]+)", "", loc)
    loc = loc.strip("（）() ") or "总部"
    return f"{broker}·{loc}"[:18]


def slugify(seat: str) -> str:
    # 用席位全名的稳定哈希,保证唯一(避免两席位 top 股相同时 slug 撞车互相覆盖)
    return "lhb-" + hashlib.md5(seat.encode("utf-8")).hexdigest()[:8]


def build(top_n: int = 12, window_days: int = 45, max_hold: int = 25):
    end = datetime.now()
    start = end - timedelta(days=window_days)
    s, e = start.strftime("%Y%m%d"), end.strftime("%Y%m%d")
    p(f"🔥 龙虎榜游资席位  窗口 {s}~{e}")

    # 1) 名称→代码 映射:用龙虎榜个股明细本身(只含本窗口上榜股,正好覆盖席位买入股;避开易挂的全市场 spot 接口)
    det = ak.stock_lhb_detail_em(start_date=s, end_date=e)
    name2code = dict(zip(det["名称"].astype(str), det["代码"].astype(str).str.zfill(6)))
    p(f"  名称→代码(龙虎榜股): {len(name2code)} 只")

    # 2) 活跃营业部
    df = ak.stock_lhb_hyyyb_em(start_date=s, end_date=e)
    p(f"  hyyyb: {df.shape}")

    # 3) 按营业部聚合
    agg: dict[str, dict] = defaultdict(lambda: {"buy": 0.0, "days": 0, "stocks": {}, "last": ""})
    for _, r in df.iterrows():
        seat = str(r["营业部名称"]).strip()
        if any(x in seat for x in EXCLUDE):
            continue
        a = agg[seat]
        v = r.get("买入总金额")
        a["buy"] += float(v) if pd.notna(v) else 0.0
        a["days"] += 1
        d = str(r.get("上榜日") or "")
        a["last"] = max(a["last"], d)
        for nm in str(r.get("买入股票") or "").split():
            code = name2code.get(nm)
            if code:
                # 同股取最近上榜日
                if nm not in a["stocks"] or d > a["stocks"][nm][1]:
                    a["stocks"][nm] = (code, d)

    ranked = sorted(agg.items(), key=lambda kv: kv[1]["buy"], reverse=True)
    ranked = [(n, a) for n, a in ranked if len(a["stocks"]) >= 3]   # 至少 3 只可映射个股,过滤薄卡
    # 每券商最多 2 席,避免国泰海通这种多分支大券商刷屏,席位更多样
    seats, per_broker = [], defaultdict(int)
    for n, a in ranked:
        bk = short_seat(n).split("·")[0]
        if per_broker[bk] >= 2:
            continue
        per_broker[bk] += 1
        seats.append((n, a))
        if len(seats) >= top_n:
            break
    p(f"  入选游资席位: {len(seats)}")

    with connect(readonly=False) as conn:
        # 清掉旧 hot_money(整批重建)
        old = conn.execute("SELECT id FROM investors WHERE type='hot_money'").fetchall()
        for o in old:
            conn.execute("DELETE FROM holdings WHERE investor_id=?", (o["id"],))
        conn.execute("DELETE FROM investors WHERE type='hot_money'")

        for seat, a in seats:
            short = short_seat(seat)
            stocks = sorted(a["stocks"].items(), key=lambda kv: kv[1][1], reverse=True)[:max_hold]
            yi = a["buy"] / 1e8
            inv_id = upsert_investor(
                conn, slug=slugify(seat), name=short, name_en=None,
                entity="龙虎榜游资席位", type="hot_money", archetype=None, country="CN",
                aum_usd=None, holdings_count=len(stocks),
                notable_for=f"近 {window_days} 天上榜 {a['days']} 次,累计买入约 {yi:.1f} 亿;游资短线席位(非长期持仓)",
                latest_period=a["last"][:10], updated_at=NOW,
            )
            for rank, (nm, (code, d)) in enumerate(stocks, 1):
                insert_holding(
                    conn, inv_id, ticker=code, market="a", stock_name=nm,
                    period=d[:10], shares=None, market_value=None,
                    pct_of_portfolio=None, rank_in_portfolio=rank,
                    change_type="new", change_pct=None, source="龙虎榜",
                    disclosed_at=d[:10],
                )
            p(f"  ✓ {short:18} {a['days']}次 {yi:.1f}亿 {len(stocks)}只 e.g.{stocks[0][0]}")
        conn.commit()
    p("DONE")


if __name__ == "__main__":
    build()
