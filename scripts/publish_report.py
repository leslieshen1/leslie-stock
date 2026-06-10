"""把一份盘报(markdown)发布到 /reports tab —— 追加进 web/public/data/reports.json。

用法:
  uv run python scripts/publish_report.py \
    --type close --time "16:00 ET" --title "收盘总结 · 06-09(周二)" \
    --file data/reports/_draft.md [--tone "一句话本质"] [--date 2026-06-09]

type ∈ {premarket, intraday, close}。最新在前,保留最近 80 条。同 id 覆盖。
之后 `cd web && vercel --prod --yes --archive=tgz` 部署即上线。
"""
from __future__ import annotations
import argparse
import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT = ROOT / "web" / "public" / "data" / "reports.json"
TYPES = {"premarket": "盘前", "intraday": "盘中", "close": "收盘"}
MAX_KEEP = 80


def auto_tone(body: str) -> str:
    """没给 tone 时,取正文里第一处 **加粗** 或第一句非标题文字。"""
    m = re.search(r"\*\*(.+?)\*\*", body)
    if m:
        return m.group(1).strip().rstrip("。.")
    for line in body.splitlines():
        s = line.strip()
        if s and not s.startswith(("#", ">", "|", "-", "·", "_")):
            return s[:60]
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", required=True, choices=list(TYPES))
    ap.add_argument("--title", required=True)
    ap.add_argument("--file", required=True, help="markdown 正文文件")
    ap.add_argument("--time", default="", help='快照时间,如 "16:00 ET"')
    ap.add_argument("--tone", default="", help="一句话本质(列表页摘要);留空自动提取")
    ap.add_argument("--date", default="", help="YYYY-MM-DD,默认今天(美东)")
    args = ap.parse_args()

    body = Path(args.file).read_text(encoding="utf-8").strip()
    et = datetime.now(timezone(timedelta(hours=-4)))
    date = args.date or et.strftime("%Y-%m-%d")
    rid = f"{date.replace('-', '')}-{args.type}"

    reports = []
    if OUT.exists():
        try:
            reports = json.loads(OUT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            reports = []
    # 同 id 视为覆盖(同日同类型重发,如盘中多版 → 用 -2 -3 区分)
    same_day = [r for r in reports if r.get("id", "").startswith(rid)]
    if any(r["id"] == rid for r in same_day):
        rid = f"{rid}-{len(same_day) + 1}"

    rec = {
        "id": rid,
        "type": args.type,
        "typeLabel": TYPES[args.type],
        "date": date,
        "timeET": args.time,
        "title": args.title,
        "tone": args.tone or auto_tone(body),
        "body": body,
        "publishedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    }
    reports = [r for r in reports if r.get("id") != rid]
    reports.insert(0, rec)
    # 最新在前:按 publishedAt 降序(insert 已在前,这里兜底排序)
    reports.sort(key=lambda r: r.get("publishedAt", ""), reverse=True)
    reports = reports[:MAX_KEEP]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(reports, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"✓ 已发布 [{TYPES[args.type]}] {args.title}")
    print(f"  id={rid} · tone={rec['tone'][:40]}")
    print(f"  → {OUT}  (共 {len(reports)} 篇)")
    print("  部署: cd web && vercel --prod --yes --archive=tgz")


if __name__ == "__main__":
    main()
