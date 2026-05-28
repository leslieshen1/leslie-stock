"""Deep Dive Brief — 给一只票一站式 brief（公告 + 财务 + 现有评分）。

用法：
    uv run python -m research.brief 002428
    uv run python -m research.brief 002428 --download

输出：
    📋 [公司] · Deep Dive Brief

    💰 财务面（Tushare）
       2025 Q3: 营收 X 亿 (+Y% YoY) / 净利率 Z% / ROE W%
       8 季度走势...

    📢 Alpha 公告（最近 365 天，分级）
       🔥 业绩预告 / 资本运作 / 客户披露
       📊 产能 / 战略合作
       👥 股东动作
       ⚠️ 风险

    🎯 Serenity 评分历史（v_N 演化）

    📌 待 verify 的关键问题
       1. 业务拆分 → 看年报 P.X
       2. InP 营收占比 → 看半年报
       3. 客户披露 → 看公告
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

from db import connect
from fetchers.tushare_client import client, ts_code as to_ts_code
from fetchers.announcements import (
    fetch_announcements, filter_alpha, download_pdf, pdf_to_text, page_to_pdf_url,
)


def stock_basic_info(code: str, market: str = "a") -> dict | None:
    """从 SQLite 拿基础信息 + 现有评分历史。"""
    with connect(readonly=True) as conn:
        s = conn.execute("""
            SELECT id, code, market, name, sector, market_cap, pe_ttm, pb,
                   industries
            FROM stocks WHERE code=? AND market=?
        """, (code, market)).fetchone()
        if not s:
            return None

        stock_id = s["id"]
        analyses = conn.execute("""
            SELECT framework, version, score, verdict_label, layer_label,
                   signals_hit, thesis, created_at, pre_labeled
            FROM analyses WHERE stock_id=?
            ORDER BY framework, created_at
        """, (stock_id,)).fetchall()

        return {
            "info": dict(s),
            "analyses": [dict(a) for a in analyses],
        }


def financials(code: str, market: str = "a", quarters: int = 8) -> pd.DataFrame:
    """Tushare 财务指标（8 季）。"""
    ts = to_ts_code(code, market)
    end = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=quarters * 90 + 90)).strftime("%Y%m%d")
    df = client.fina_indicator(ts, start, end)
    if df.empty:
        return df
    # 同一 end_date 可能多次披露/修订 → 保留最新公告日的那条
    if "ann_date" in df.columns:
        df = df.sort_values(["end_date", "ann_date"], ascending=[False, False])
    else:
        df = df.sort_values("end_date", ascending=False)
    df = df.drop_duplicates(subset=["end_date"], keep="first").head(quarters)
    return df


def income_statement(code: str, market: str = "a", quarters: int = 8) -> pd.DataFrame:
    """Tushare 利润表（8 季）。"""
    ts = to_ts_code(code, market)
    end = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=quarters * 90 + 90)).strftime("%Y%m%d")
    df = client.income(ts, start, end)
    if df.empty:
        return df
    if "ann_date" in df.columns:
        df = df.sort_values(["end_date", "ann_date"], ascending=[False, False])
    else:
        df = df.sort_values("end_date", ascending=False)
    df = df.drop_duplicates(subset=["end_date"], keep="first").head(quarters)
    return df


def format_yi(n: float | None) -> str:
    if n is None or pd.isna(n): return "—"
    if abs(n) >= 1e8: return f"{n/1e8:.2f} 亿"
    if abs(n) >= 1e4: return f"{n/1e4:.1f} 万"
    return str(int(n))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("code", help="股票代码（如 002428）")
    ap.add_argument("--market", default="a", choices=["a", "hk", "us"])
    ap.add_argument("--days", type=int, default=365)
    ap.add_argument("--ann-limit", type=int, default=20)
    ap.add_argument("--download", action="store_true",
                    help="自动下载 Tier 1 公告 PDF")
    args = ap.parse_args()

    code, market = args.code, args.market

    print()
    print("=" * 65)
    print(f"📋 {code} ({market.upper()}) · Deep Dive Brief")
    print("=" * 65)

    # 1. 基础信息 + 评分历史
    info = stock_basic_info(code, market)
    if not info:
        print(f"❌ {code}/{market} 不在 DB")
        sys.exit(1)

    s = info["info"]
    print()
    print(f"📌 {s['name']} · {s['sector'] or '—'}")
    if s["market_cap"]:
        print(f"   市值 {format_yi(s['market_cap'])}", end="")
        if s["pe_ttm"]: print(f"  PE {s['pe_ttm']:.1f}", end="")
        if s["pb"]: print(f"  PB {s['pb']:.1f}", end="")
        print()
    if s["industries"]:
        ind = json.loads(s["industries"])
        print(f"   Industries: {', '.join(ind)}")

    # 2. 现有评分演化（多版本可见）
    print()
    print("🎯 评分历史:")
    analyses = info["analyses"]
    if not analyses:
        print("   （还没有任何评分）")
    else:
        for a in analyses:
            v = a["version"] or "v1"
            # version 字段已含 v 前缀（"v1" / "v2"），别再加
            v_display = v if str(v).startswith("v") else f"v{v}"
            score = a["score"] if a["score"] is not None else "—"
            verdict = a["verdict_label"] or ""
            date = (a["created_at"] or "")[:10]
            pre = " [pre]" if a["pre_labeled"] else ""
            print(f"   {a['framework']:<10} {v_display:<4} {score:>3}  {verdict[:50]}  {date}{pre}")

    # 3. 财务面（Tushare）
    print()
    print("💰 财务面（Tushare 8 季）:")
    fin = financials(code, market, 8)
    inc = income_statement(code, market, 8)
    if fin.empty:
        print("   （Tushare 拉不到数据 — 可能权限不足或代码不对）")
    else:
        # join income + fin
        df = pd.merge(
            fin[["end_date", "roe", "netprofit_margin", "grossprofit_margin",
                 "debt_to_assets", "or_yoy"]],
            inc[["end_date", "revenue", "n_income"]] if not inc.empty else fin[["end_date"]],
            on="end_date", how="left"
        )
        print(f"   {'Period':<10} {'营收':<10} {'YoY%':>7} {'净利率':>7} {'毛利率':>7} {'ROE':>6} {'负债率':>7}")
        for _, r in df.head(8).iterrows():
            rev = format_yi(r.get("revenue")) if pd.notna(r.get("revenue")) else "—"
            yoy = f"{r['or_yoy']:.1f}" if pd.notna(r.get("or_yoy")) else "—"
            npm = f"{r['netprofit_margin']:.1f}" if pd.notna(r.get("netprofit_margin")) else "—"
            gpm = f"{r['grossprofit_margin']:.1f}" if pd.notna(r.get("grossprofit_margin")) else "—"
            roe = f"{r['roe']:.1f}" if pd.notna(r.get("roe")) else "—"
            debt = f"{r['debt_to_assets']:.1f}" if pd.notna(r.get("debt_to_assets")) else "—"
            print(f"   {r['end_date']:<10} {rev:<10} {yoy:>7} {npm:>7} {gpm:>7} {roe:>6} {debt:>7}")

    # 4. Alpha 公告
    print()
    end = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=args.days)).strftime("%Y%m%d")
    ann_df = fetch_announcements(code, market, start, end)
    print(f"📢 公告（最近 {args.days} 天 · {len(ann_df)} 条原始）:")
    if ann_df.empty:
        print("   （无）")
    else:
        alpha = filter_alpha(ann_df, min_tier=1).drop_duplicates(subset=["ann_date", "title"])
        # 只保留 finalpage url（PDF 链接）
        # 按 tier 分组
        for tier_label, tier_num, marker in [
            ("业绩 / 资本运作", 1, "🔥"),
            ("产能 / 战略合作", 2, "📊"),
            ("股东动作", 3, "👥"),
            ("风险", 4, "⚠️"),
            ("IR / 调研记录", 5, "💬"),
        ]:
            sub = alpha[alpha["_tier"] == tier_num]
            if sub.empty: continue
            print(f"\n   {marker} Tier {tier_num} — {tier_label}（{len(sub)} 条）")
            for _, r in sub.head(args.ann_limit // 2).iterrows():
                pdf_url = page_to_pdf_url(r["url"])
                pdf_mark = "📄" if pdf_url else "🌐"
                print(f"      {pdf_mark} {r['ann_date']}  {r['title']}")
                if args.download and pdf_url:
                    pdf = download_pdf(r["url"])
                    if pdf:
                        text = pdf_to_text(pdf)
                        print(f"         ✓ {pdf.name} ({len(text)} chars) — {pdf_url}")

    # 5. Deep dive 起点 (针对当前 token 限制)
    print()
    print("💡 deep dive 起点建议:")
    print("   1. 看最新年报 / 半年报（业务拆分 + 客户披露）")
    print("   2. 看最近业绩预告（提前知道下季业绩）")
    print("   3. 看股权激励 / 增资 / 资本运作（管理层意图）")
    print("   4. 看雪球 / 同花顺股吧（散户 / 机构观点）")
    print("   5. 看东方财富 F10 → 业务构成（手动看）")
    print()
    print(f"   巨潮 F10: http://www.cninfo.com.cn/new/disclosure/stock?stockCode={code}")
    print(f"   雪球:    https://xueqiu.com/S/SZ{code}")
    print(f"   东财:    https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/Index?type=web&code={'SZ' if market=='a' and not code.startswith('6') else 'SH'}{code}")
    print()


if __name__ == "__main__":
    main()
