"""Seed 聪明钱数据（MVP）:
- A 股: Tushare fund_portfolio 拉顶流基金最新季度重仓（张坤 / 葛兰 / 刘彦春）
- 美股: 手录段永平 H&H Q1 2026 真实 13F

仓位占比(pct_of_portfolio)是一等公民 —— 区分重仓 vs 试探仓。

用法: uv run python -m scripts.seed_investors
"""
from __future__ import annotations

import re
from datetime import datetime

import akshare as ak
import pandas as pd

from db import connect

NOW = datetime.now().isoformat()

# ============================================================
# A 股顶流基金（akshare 6 位基金代码 → 基金经理）
# ============================================================
A_FUNDS = [
    {"symbol": "005827", "fund": "易方达蓝筹精选", "manager": "张坤",
     "slug": "zhang-kun", "notable": "易方达顶流,白酒 + 互联网长持,千亿规模"},
    {"symbol": "163406", "fund": "兴全合润", "manager": "谢治宇",
     "slug": "xie-zhiyu", "notable": "兴证全球均衡派,长跑名将,自下而上选股不押单一赛道"},
    {"symbol": "161005", "fund": "富国天惠精选成长", "manager": "朱少醒",
     "slug": "zhu-shaoxing", "notable": "富国天惠一拖到底十余年,公募长跑标杆,成长里找价值"},
    {"symbol": "110022", "fund": "易方达消费行业", "manager": "萧楠",
     "slug": "xiao-nan", "notable": "易方达消费旗手,白酒家电白马,深研生意模式"},
    {"symbol": "006567", "fund": "中泰星元价值优选", "manager": "姜诚",
     "slug": "jiang-cheng", "notable": "中泰深度价值,只在低估时买好公司,极重安全边际"},
    {"symbol": "260112", "fund": "景顺长城能源基建", "manager": "鲍无可",
     "slug": "bao-wuke", "notable": "景顺长城价值派,偏好低估值 + 高股息 + 资源垄断,重下行保护"},
    {"symbol": "519697", "fund": "交银优势行业", "manager": "何帅",
     "slug": "he-shuai", "notable": "交银成长价值,精选个股 + 严控回撤,长期低波取胜"},
    {"symbol": "166005", "fund": "中欧价值发现", "manager": "曹名长",
     "slug": "cao-mingchang", "notable": "中欧深度价值老将,极致分散 + 低估值,逆向布局冷门"},
    {"symbol": "005233", "fund": "广发睿毅领先", "manager": "林英睿",
     "slug": "lin-yingrui", "notable": "广发逆向价值,专挑周期底部困境反转,赔率思维"},
    {"symbol": "519069", "fund": "汇添富价值精选", "manager": "劳杰男",
     "slug": "lao-jieman", "notable": "汇添富均衡价值,自下而上,制造 + 消费 + 金融多元配置"},
    {"symbol": "260108", "fund": "景顺长城新兴成长", "manager": "刘彦春",
     "slug": "liu-yanchun", "notable": "景顺长城,消费 + 医药白马成长"},
    {"symbol": "003095", "fund": "中欧医疗健康", "manager": "葛兰",
     "slug": "ge-lan", "notable": "中欧医药女神,CXO + 创新药 + 医疗服务"},
]


def upsert_investor(conn, **kw) -> int:
    existing = conn.execute("SELECT id FROM investors WHERE slug=?", (kw["slug"],)).fetchone()
    cols = ["slug", "name", "name_en", "entity", "type", "archetype", "country",
            "aum_usd", "holdings_count", "notable_for", "latest_period", "updated_at"]
    vals = [kw.get(c) for c in cols]
    if existing:
        conn.execute(f"UPDATE investors SET {', '.join(c+'=?' for c in cols)} WHERE id=?",
                     (*vals, existing["id"]))
        # 清掉旧 holdings 重灌
        conn.execute("DELETE FROM holdings WHERE investor_id=?", (existing["id"],))
        return existing["id"]
    cur = conn.execute(
        f"INSERT INTO investors ({', '.join(cols)}) VALUES ({', '.join('?'*len(cols))})", vals)
    return cur.lastrowid


def insert_holding(conn, investor_id, **kw):
    cols = ["investor_id", "ticker", "market", "stock_name", "period", "shares",
            "market_value", "pct_of_portfolio", "rank_in_portfolio", "change_type",
            "change_pct", "source", "disclosed_at"]
    kw["investor_id"] = investor_id
    vals = [kw.get(c) for c in cols]
    conn.execute(
        f"INSERT INTO holdings ({', '.join(cols)}) VALUES ({', '.join('?'*len(cols))})", vals)


# ============================================================
# A 股: 从 akshare 拉基金重仓（东财，数据较新）
# ============================================================
def _parse_period(q_label: str) -> str:
    """'2026年1季度股票投资明细' → '2026Q1'。"""
    m = re.search(r"(\d{4})年(\d)季度", q_label)
    return f"{m.group(1)}Q{m.group(2)}" if m else q_label


def _yq(label: str) -> tuple[int, int]:
    """'2025年4季度…' → (2025, 4)。无法解析 → (0,0)。"""
    m = re.search(r"(\d{4})年(\d)季度", label)
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


# 每基金展示的持仓上限（全披露报告可能上百只，尾部都是 <0.3% 的微仓，截断保留前 N 大）
MAX_HOLD = 40


def seed_a_fund(conn, fund: dict):
    # A 股公募披露规则:一/三季报只披露【前十大重仓】,中报(Q2)/年报(Q4)披露【全部持仓】。
    # 要展示完整组合 → 优先取最近一期全披露报告(中报/年报),而非最新季报的前十大。
    frames = []
    for y in (datetime.now().year, datetime.now().year - 1):
        try:
            d = ak.fund_portfolio_hold_em(symbol=fund["symbol"], date=str(y))
            if d is not None and not d.empty:
                frames.append(d)
        except Exception:
            pass
    if not frames:
        print(f"  ⚠ {fund['manager']}: 空")
        return
    df = pd.concat(frames, ignore_index=True).drop_duplicates(subset=["季度", "股票代码"])
    quarters = sorted(df["季度"].unique(), key=_yq, reverse=True)
    full = [q for q in quarters if _yq(q)[1] in (2, 4)]   # 中报/年报 = 全披露
    chosen_q = full[0] if full else quarters[0]            # 无全披露报告才退回最新季报
    cur = df[df["季度"] == chosen_q].copy()
    cur = cur.sort_values("占净值比例", ascending=False).head(MAX_HOLD).reset_index(drop=True)
    period_label = _parse_period(chosen_q)

    inv_id = upsert_investor(
        conn, slug=fund["slug"], name=fund["manager"], name_en=None,
        entity=fund["fund"], type="fund", archetype="meme", country="CN",
        aum_usd=None, holdings_count=len(cur), notable_for=fund["notable"],
        latest_period=period_label, updated_at=NOW,
    )

    for rank, r in cur.iterrows():
        sym = str(r["股票代码"]).split(".")[0].zfill(6)
        insert_holding(
            conn, inv_id, ticker=sym, market="a", stock_name=str(r["股票名称"]),
            period=period_label,
            shares=float(r["持股数"]) if pd.notna(r["持股数"]) else None,        # 万股
            market_value=float(r["持仓市值"]) if pd.notna(r["持仓市值"]) else None,  # 万元
            pct_of_portfolio=round(float(r["占净值比例"]), 2) if pd.notna(r["占净值比例"]) else None,
            rank_in_portfolio=rank + 1, change_type="hold", change_pct=None,
            source="fund_report", disclosed_at=period_label,
        )
    print(f"  ✓ {fund['manager']}（{fund['fund']}）{period_label}: top {len(cur)} 重仓")


# ============================================================
# 美股: 段永平 H&H Q1 2026（真实 13F）
# ============================================================
DUAN_HOLDINGS = [
    # ticker, name, pct, rank, change_type, shares(约), mktval(约,美元)
    ("AAPL", "苹果",      36.72, 1, "trim", None, None),
    ("BRK.B", "伯克希尔", 21.91, 2, "hold", None, None),
    ("NVDA", "英伟达",    12.07, 3, "add",  None, None),
    ("PDD",  "拼多多",    10.09, 4, "hold", None, None),
    ("TSLA", "特斯拉",     6.34, 5, "new",  None, None),
    ("GOOG", "谷歌",       4.50, 6, "hold", None, None),
    ("OXY",  "西方石油",   2.80, 7, "hold", None, None),
    ("UNH",  "联合健康",   0.80, 8, "new",  None, None),
    ("PLTR", "Palantir",   0.40, 9, "new",  None, None),
    ("CRCL", "Circle",     0.10, 10, "new", 200000, 19080000),
    ("SNPS", "新思科技",   0.10, 11, "new", None, None),
    ("CRWD", "CrowdStrike",0.10, 12, "new", None, None),
    ("SNOW", "Snowflake",  0.10, 13, "new", None, None),
    ("INOD", "Innodata",   0.05, 14, "new", None, None),
]


def seed_duan(conn):
    inv_id = upsert_investor(
        conn, slug="duan-yongping", name="段永平", name_en="Duan Yongping",
        entity="H&H International Investment", type="superinvestor", archetype="contract",
        country="US", aum_usd=20_004_000_000, holdings_count=len(DUAN_HOLDINGS),
        notable_for="步步高 / OPPO / vivo 创始人;价投教父,长持苹果伯克希尔;Q1 首度建仓 Circle",
        latest_period="2026Q1", updated_at=NOW,
    )
    for ticker, name, pct, rank, ctype, shares, mktval in DUAN_HOLDINGS:
        insert_holding(
            conn, inv_id, ticker=ticker, market="us", stock_name=name, period="2026Q1",
            shares=shares, market_value=mktval, pct_of_portfolio=pct,
            rank_in_portfolio=rank, change_type=ctype, change_pct=None,
            source="13F", disclosed_at="20260331",
        )
    print(f"  ✓ 段永平 H&H 2026Q1: {len(DUAN_HOLDINGS)} 持仓（含 CRCL 0.1% 试探仓）")


def main():
    print("🐋 Seed 聪明钱数据\n")
    with connect(readonly=False) as conn:
        print("美股 superinvestor:")
        seed_duan(conn)
        print("\nA 股顶流基金（Tushare）:")
        for fund in A_FUNDS:
            try:
                seed_a_fund(conn, fund)
            except Exception as e:
                print(f"  ❌ {fund['manager']}: {str(e)[:80]}")
        conn.commit()

        # 统计
        n_inv = conn.execute("SELECT COUNT(*) c FROM investors").fetchone()["c"]
        n_hold = conn.execute("SELECT COUNT(*) c FROM holdings").fetchone()["c"]
        print(f"\n✅ {n_inv} investors · {n_hold} holdings")
        # 谁持有 CRCL / 002428
        for t in ["CRCL", "002428"]:
            rows = conn.execute("""
                SELECT i.name, h.pct_of_portfolio, h.change_type
                FROM holdings h JOIN investors i ON h.investor_id=i.id
                WHERE h.ticker=?
            """, (t,)).fetchall()
            who = ", ".join(f"{r['name']}({r['pct_of_portfolio']}%·{r['change_type']})" for r in rows) or "—"
            print(f"   谁持有 {t}: {who}")


if __name__ == "__main__":
    main()
