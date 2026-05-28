"""公告拉取 + PDF 下载 + 文本提取。

数据流：
  Tushare anns_d → 公告标题 + 巨潮 URL
                → 下载 PDF（巨潮 static）
                → 提取文本（pypdf）
                → 写入 events 表

用法：
    # 列出某只票的 alpha 公告
    uv run python -m fetchers.announcements 002428

    # 下载某一条公告（按 announcement_id 或日期+标题关键词）
    uv run python -m fetchers.announcements 002428 --download "鑫耀"

    # 拉取最近 7 天所有 watchlist 标的公告 → events 表
    uv run python -m fetchers.announcements --refresh --days 7
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd
import requests

from fetchers.tushare_client import client, ts_code as to_ts_code

ROOT = Path(__file__).parent.parent
PDF_CACHE = ROOT / "data" / "_cache" / "pdfs"
TXT_CACHE = ROOT / "data" / "_cache" / "pdf_texts"
PDF_CACHE.mkdir(parents=True, exist_ok=True)
TXT_CACHE.mkdir(parents=True, exist_ok=True)

# alpha 关键词（按重要度排）
ALPHA_KEYWORDS = {
    # Tier 1：业绩 + 资本运作
    "tier1": [
        "业绩预告", "业绩快报", "年度报告", "半年度报告", "三季度报告",
        "增资", "扩股", "股权激励", "重大资产重组", "收购", "出售资产",
        "重大合同", "中标", "签订",
    ],
    # Tier 2：产能 + 客户披露
    "tier2": [
        "产能", "扩产", "投产", "产线", "新产品",
        "战略合作", "战略协议", "重大客户",
    ],
    # Tier 3：股东动作
    "tier3": [
        "股东减持", "股东增持", "股东大会", "回购",
        "股权转让", "实际控制人",
    ],
    # Tier 4：风险
    "tier4": [
        "诉讼", "仲裁", "处罚", "立案", "风险", "退市", "停牌",
    ],
    # Tier 5：投资者关系 / 调研记录（IR Q&A — 经常藏着 alpha）
    "tier5": [
        "投资者关系活动记录", "调研活动", "调研纪要", "业绩说明会",
    ],
}

NOISE_KEYWORDS = [
    "律师事务所", "意见书", "保荐机构", "审计意见", "信息披露管理制度",
    "议事规则", "授权", "议案", "签字", "修订对照表",
]


def fetch_announcements(code: str, market: str = "a",
                       start: str | None = None,
                       end: str | None = None) -> pd.DataFrame:
    """通过 Tushare anns_d 拉公告（标题 + URL）。"""
    if start is None:
        start = (datetime.now() - timedelta(days=365)).strftime("%Y%m%d")
    if end is None:
        end = datetime.now().strftime("%Y%m%d")

    ts = to_ts_code(code, market)
    df = client.anns_d(start, end, ts_code=ts)
    if df.empty:
        return df

    # 去重（同一公告标题 + 日期）
    df = df.drop_duplicates(subset=["ann_date", "title"])

    # 按日期降序
    df = df.sort_values("ann_date", ascending=False).reset_index(drop=True)
    return df


def classify_alpha(title: str) -> tuple[int, str]:
    """给公告标题分级（0-4，越高越重要）。返回 (tier, 命中关键词)。"""
    # 先看 noise
    for nk in NOISE_KEYWORDS:
        if nk in title:
            return (0, nk)
    # 再按 tier
    for tier_num in [1, 2, 3, 4, 5]:
        for kw in ALPHA_KEYWORDS[f"tier{tier_num}"]:
            if kw in title:
                return (tier_num, kw)
    return (0, "")


def filter_alpha(df: pd.DataFrame, min_tier: int = 1) -> pd.DataFrame:
    """过滤 alpha 公告。min_tier=1 = 业绩/资本运作；4 = 风险。"""
    if df.empty: return df
    df = df.copy()
    df[["_tier", "_keyword"]] = df["title"].apply(
        lambda t: pd.Series(classify_alpha(t))
    )
    return df[df["_tier"] >= min_tier].sort_values(
        ["_tier", "ann_date"], ascending=[True, False]
    )


def page_to_pdf_url(url: str) -> str | None:
    """巨潮 detail page URL → static PDF URL。

    Page: http://www.cninfo.com.cn/new/disclosure/detail?stockCode=002428&announcementId=1225333739&...&announcementTime=2026-05-27
    PDF:  http://static.cninfo.com.cn/finalpage/2026-05-27/1225333739.PDF
    """
    # 已经是 PDF
    if url.lower().endswith(".pdf") or "finalpage" in url:
        return url
    m_id = re.search(r"announcementId=(\d+)", url)
    m_dt = re.search(r"announcementTime=(\d{4}-\d{2}-\d{2})", url)
    if m_id and m_dt:
        return f"http://static.cninfo.com.cn/finalpage/{m_dt.group(1)}/{m_id.group(1)}.PDF"
    return None


def download_pdf(url: str) -> Path | None:
    """下载巨潮 PDF 到缓存。

    支持两种输入：
    - 直接 PDF URL（finalpage/.../*.PDF）
    - 巨潮 detail page URL（带 announcementId 参数）→ 自动转 PDF URL
    """
    # 1. 解析 announcement_id（用作缓存文件名）
    m = re.search(r"(\d{10,})\.PDF", url)
    if m:
        ann_id = m.group(1)
    else:
        m = re.search(r"announcementId=(\d+)", url)
        ann_id = m.group(1) if m else url.split("/")[-1].replace(".PDF", "")

    out = PDF_CACHE / f"{ann_id}.pdf"
    if out.exists() and out.stat().st_size > 100:
        return out

    # 2. page URL → 真正的 PDF URL
    pdf_url = page_to_pdf_url(url)
    if not pdf_url:
        print(f"  ⚠ 无法解析 PDF URL: {url}")
        return None

    # 3. 下载
    try:
        r = requests.get(pdf_url, timeout=30,
                        headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        # 巨潮有时对老公告 404，但返回 200 + HTML
        if not r.content.startswith(b"%PDF"):
            print(f"  ⚠ 非 PDF 内容（可能已下架）: {pdf_url}")
            return None
        out.write_bytes(r.content)
        return out
    except Exception as e:
        print(f"  ⚠ download fail {pdf_url}: {e}")
        return None


def pdf_to_text(pdf_path: Path) -> str:
    """PDF → 纯文本（缓存）。"""
    txt_path = TXT_CACHE / f"{pdf_path.stem}.txt"
    if txt_path.exists():
        return txt_path.read_text(encoding="utf-8")

    try:
        from pypdf import PdfReader
        reader = PdfReader(str(pdf_path))
        text = "\n".join(p.extract_text() or "" for p in reader.pages)
    except Exception as e:
        text = f"[PDF 解析失败: {e}]"

    txt_path.write_text(text, encoding="utf-8")
    return text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("code", nargs="?", help="股票代码（如 002428）")
    ap.add_argument("--market", default="a", choices=["a", "hk", "us"])
    ap.add_argument("--days", type=int, default=730, help="回看天数（默认 2 年）")
    ap.add_argument("--min-tier", type=int, default=1, choices=[1, 2, 3, 4],
                    help="最低 alpha 级别（1 业绩/资本 → 4 风险）")
    ap.add_argument("--download", help="下载公告（按标题包含的关键词，如 '鑫耀'）")
    ap.add_argument("--show-text", action="store_true", help="展示提取的文本片段")
    ap.add_argument("--limit", type=int, default=30)
    args = ap.parse_args()

    if not args.code:
        ap.print_help()
        sys.exit(0)

    end = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=args.days)).strftime("%Y%m%d")

    print(f"📢 拉取 {args.code} 公告（{start} - {end}）...")
    df = fetch_announcements(args.code, args.market, start, end)
    if df.empty:
        print("没有公告")
        return

    print(f"  原始 {len(df)} 条 → ", end="")
    alpha = filter_alpha(df, min_tier=args.min_tier)
    print(f"alpha {len(alpha)} 条（min_tier={args.min_tier}）")
    print()

    # 列表展示
    for _, r in alpha.head(args.limit).iterrows():
        tier = r["_tier"]
        marker = ["", "🔥", "📊", "👥", "⚠️", "💬"][tier]
        print(f"  {marker} T{tier}  {r['ann_date']}  [{r['_keyword']}] {r['title']}")
        if args.download or args.show_text:
            print(f"      {r['url']}")
    print()

    # 下载模式（走原始 df 不被 alpha-filter 限制）
    if args.download:
        print(f"📥 下载含 '{args.download}' 的公告 PDF：")
        targets = df[
            df["title"].str.contains(args.download, na=False, regex=False)
        ]
        for _, r in targets.iterrows():
            url = r["url"]
            print(f"  → {r['title']}")
            pdf = download_pdf(url)  # 内部自动 page URL → PDF URL
            if pdf:
                text = pdf_to_text(pdf)
                print(f"    ✓ {pdf.name} ({len(text)} chars)")
                if args.show_text:
                    print(f"    {text[:500]}…\n")


if __name__ == "__main__":
    main()
