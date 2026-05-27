"""观察列表管理器 — Claude（对话）和 Web Dashboard 的共享数据层。

Claude 通过对话直接调用本模块的 add/remove/update 写入 watchlist.csv；
Web 端 /watchlist 页面读取 watchlist.csv + data/analyses/ 渲染。

CLI：
    uv run python -m monitor.watchlist list
    uv run python -m monitor.watchlist add MU us "美光科技" --score-pro 79.75 ...
    uv run python -m monitor.watchlist remove 002389 a
    uv run python -m monitor.watchlist status   # 输出 watchlist 总览
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent.parent
WATCHLIST_PATH = ROOT / "core" / "watchlist.csv"
WATCHLIST_JSON_PATH = ROOT / "data" / "watchlist.json"


@dataclass
class WatchItem:
    code: str
    market: str          # "a" / "hk" / "us"
    name: str
    added_date: str
    score_pro: float = 0.0
    score_alpha: float = 0.0
    grade: str = "tracking"   # 重点候选 / 学习池 / 过滤
    my_view: str = ""
    key_thesis: str = ""
    key_risks: str = ""
    target_buy_price: str = ""
    status: str = "tracking"  # tracking / ready_to_buy / hold_off
    notes: str = ""


def load() -> list[WatchItem]:
    if not WATCHLIST_PATH.exists():
        return []
    items: list[WatchItem] = []
    with open(WATCHLIST_PATH, encoding="utf-8") as f:
        reader = csv.DictReader(
            (line for line in f if not line.strip().startswith("#") and line.strip())
        )
        for row in reader:
            try:
                items.append(WatchItem(
                    code=str(row["code"]).strip().strip('"'),
                    market=str(row["market"]).strip().lower(),
                    name=str(row.get("name", "")).strip(),
                    added_date=str(row.get("added_date", "")).strip(),
                    score_pro=_safe_float(row.get("score_pro")),
                    score_alpha=_safe_float(row.get("score_alpha")),
                    grade=str(row.get("grade", "tracking")).strip(),
                    my_view=str(row.get("my_view", "")).strip(),
                    key_thesis=str(row.get("key_thesis", "")).strip(),
                    key_risks=str(row.get("key_risks", "")).strip(),
                    target_buy_price=str(row.get("target_buy_price", "")).strip(),
                    status=str(row.get("status", "tracking")).strip(),
                    notes=str(row.get("notes", "")).strip(),
                ))
            except Exception as e:
                print(f"⚠️ 跳过无效行 {row.get('code')}: {e}", file=sys.stderr)
    return items


def save(items: list[WatchItem]) -> None:
    """重写整个 watchlist.csv（保留头部注释 + 数据行）."""
    # 读取现有注释 header
    header_lines: list[str] = []
    if WATCHLIST_PATH.exists():
        with open(WATCHLIST_PATH, encoding="utf-8") as f:
            for line in f:
                if line.strip().startswith("#") or not line.strip().split(",")[0].strip().startswith('"'):
                    if line.strip() and line.startswith("#"):
                        header_lines.append(line.rstrip())
                    elif not line.strip():
                        header_lines.append("")
                    else:
                        break
                else:
                    break

    cols = ["code", "market", "name", "added_date", "score_pro", "score_alpha",
            "grade", "my_view", "key_thesis", "key_risks", "target_buy_price",
            "status", "notes"]

    with open(WATCHLIST_PATH, "w", encoding="utf-8", newline="") as f:
        # 列头
        f.write(",".join(cols) + "\n")
        # 注释 header
        for line in header_lines:
            if line.startswith("#"):
                f.write(line + "\n")
            elif not line:
                f.write("\n")
        # 数据行
        writer = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
        for it in items:
            writer.writerow([
                f'"{it.code}"' if it.market in ("hk", "a") else it.code,
                it.market, it.name, it.added_date,
                it.score_pro, it.score_alpha, it.grade, it.my_view,
                it.key_thesis, it.key_risks, it.target_buy_price,
                it.status, it.notes,
            ])

    # 同时写 JSON 给 Web Dashboard 用
    export_json(items)


def export_json(items: list[WatchItem]) -> None:
    WATCHLIST_JSON_PATH.parent.mkdir(exist_ok=True)
    with open(WATCHLIST_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump([asdict(it) for it in items], f, ensure_ascii=False, indent=2)


def add(item: WatchItem) -> None:
    items = load()
    # 检查是否已存在（code + market 匹配）
    for i, existing in enumerate(items):
        if existing.code == item.code and existing.market == item.market:
            items[i] = item
            print(f"✏️ 更新 {item.name} ({item.code}/{item.market.upper()})")
            save(items)
            return
    items.append(item)
    print(f"✅ 加入 watchlist: {item.name} ({item.code}/{item.market.upper()}) — {item.grade}")
    save(items)


def remove(code: str, market: str) -> None:
    items = load()
    market = market.lower()
    new_items = [it for it in items if not (it.code == code and it.market == market)]
    if len(new_items) == len(items):
        print(f"⚠️ 没找到 {code}/{market.upper()}")
        return
    save(new_items)
    print(f"🗑️ 已从 watchlist 移除 {code}/{market.upper()}")


def status() -> None:
    items = load()
    if not items:
        print("（观察列表为空）")
        return

    by_status = {}
    for it in items:
        by_status.setdefault(it.status, []).append(it)

    print(f"📋 观察列表 — {len(items)} 只股票\n")
    for st, lst in sorted(by_status.items()):
        emoji = {"ready_to_buy": "🟢", "tracking": "🟡", "hold_off": "🔴"}.get(st, "⚪")
        print(f"{emoji} {st} ({len(lst)})：")
        lst.sort(key=lambda x: -x.score_pro)
        for it in lst:
            star = "🏆" if it.score_pro >= 80 else ("⭐" if it.score_pro >= 75 else "")
            print(f"   {it.score_pro:>5.1f} | {it.name:<8} ({it.code:<7}/{it.market.upper():<3}) {star}")
            if it.my_view:
                print(f"          └─ {it.my_view[:80]}")
        print()


def _safe_float(v) -> float:
    try:
        return float(v) if v else 0.0
    except (TypeError, ValueError):
        return 0.0


def cli():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", help="列出全部")
    p_list = sub.add_parser("status", help="按状态分组显示")

    p_add = sub.add_parser("add", help="加入 watchlist")
    p_add.add_argument("code")
    p_add.add_argument("market", choices=["a", "hk", "us"])
    p_add.add_argument("name")
    p_add.add_argument("--score-pro", type=float, default=0)
    p_add.add_argument("--score-alpha", type=float, default=0)
    p_add.add_argument("--grade", default="tracking")
    p_add.add_argument("--view", default="")
    p_add.add_argument("--thesis", default="")
    p_add.add_argument("--risks", default="")
    p_add.add_argument("--target", default="")
    p_add.add_argument("--status", default="tracking",
                       choices=["tracking", "ready_to_buy", "hold_off"])
    p_add.add_argument("--notes", default="")

    p_rm = sub.add_parser("remove", help="移除")
    p_rm.add_argument("code")
    p_rm.add_argument("market", choices=["a", "hk", "us"])

    p_export = sub.add_parser("export-json", help="重新导出 watchlist.json")

    args = ap.parse_args()

    if args.cmd in ("list", "status"):
        status()
    elif args.cmd == "add":
        item = WatchItem(
            code=args.code, market=args.market, name=args.name,
            added_date=date.today().isoformat(),
            score_pro=args.score_pro, score_alpha=args.score_alpha,
            grade=args.grade, my_view=args.view,
            key_thesis=args.thesis, key_risks=args.risks,
            target_buy_price=args.target, status=args.status,
            notes=args.notes,
        )
        add(item)
    elif args.cmd == "remove":
        remove(args.code, args.market)
    elif args.cmd == "export-json":
        items = load()
        export_json(items)
        print(f"✅ 导出 {len(items)} 条到 {WATCHLIST_JSON_PATH}")


if __name__ == "__main__":
    cli()
