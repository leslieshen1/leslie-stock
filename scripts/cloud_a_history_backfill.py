"""一次性补齐 A 股 30 天历史收盘 → a-price-history-30d.json。

背景:a-price-history 是"从零每天攒一根"(cloud_a_history_refresh),没有现成历史,
攒到 <21 天时 arena 德鲁肯米勒的 20 日动量算不出(need_momo 全筛掉 → 0 候选 → 空仓),
情绪资金面的当日涨幅也不准。本脚本从腾讯日线一次性回填,让窗口立刻满 30 天。

口径:腾讯 day = **不复权**,与实时 /api/a-market(不复权)一致 —— 绝不用 qfq,否则
动量/盈亏和实时价打架。排除"今天"那根(盘中价),保留现有 today(云端收盘会更新)。

用法: python scripts/cloud_a_history_backfill.py [--dry]
"""
from __future__ import annotations
import concurrent.futures as cf
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

PUB = Path(__file__).parent.parent / "web" / "public" / "data"
OUT = PUB / "a-price-history-30d.json"
KEEP = 30
H = {"referer": "https://gu.qq.com/", "user-agent": "Mozilla/5.0"}


def tencent_sym(code: str) -> str | None:
    if code.startswith("6"):
        return "sh" + code
    if code[0] in "03":
        return "sz" + code
    if code.startswith("92") or code[0] in "48":
        return "bj" + code
    return None


def fetch_hist(code: str) -> tuple[str, dict]:
    sym = tencent_sym(code)
    if not sym:
        return code, {}
    try:
        r = requests.get("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get",
                         params={"param": f"{sym},day,,,40,"}, headers=H, timeout=15)
        node = (r.json().get("data") or {}).get(sym, {})
        kl = node.get("day") or node.get("qfqday") or []
        out = {}
        for row in kl:
            try:
                out[row[0]] = round(float(row[2]), 4)  # [0]日期 [2]收盘
            except (TypeError, ValueError, IndexError):
                continue
        return code, out
    except Exception:
        return code, {}


def main() -> None:
    dry = "--dry" in sys.argv
    hist = json.loads(OUT.read_text(encoding="utf-8"))
    closes = hist["closes"]
    codes = list(closes.keys())
    today = datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d")
    print(f"补 {len(codes)} 只 × 40 天历史(排除今天 {today} 盘中)…")

    all_dates = set(hist.get("dates", []))
    done = ok = 0
    with cf.ThreadPoolExecutor(max_workers=10) as ex:
        for code, hd in ex.map(fetch_hist, codes):
            if hd:
                ok += 1
            for d, px in hd.items():
                if d >= today:            # 今天那根是盘中价 → 跳过,保留现有 today
                    continue
                closes.setdefault(code, {})[d] = px
                all_dates.add(d)
            done += 1
            if done % 800 == 0:
                print(f"  {done}/{len(codes)} · 有效 {ok}")

    dates = sorted(all_dates)[-KEEP:]
    keep = set(dates)
    for code in list(closes):
        closes[code] = {d: v for d, v in closes[code].items() if d in keep}
        if not closes[code]:
            del closes[code]

    # 诊断:窗口内 ≥21 天的票占比(德鲁肯动量能算的比例)
    enough = sum(1 for c in closes.values() if len(c) >= 21)
    print(f"✓ 补齐:{len(dates)} 天  {dates[0]}→{dates[-1]}  ·  {len(closes)} 只  ·  ≥21天 {enough} 只({enough*100//max(1,len(closes))}%)")
    if dry:
        print("  [dry] 不写文件")
        return
    OUT.write_text(json.dumps({"dates": dates, "closes": closes}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
