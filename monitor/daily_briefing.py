"""每日盘后简报生成器。

流程：
1. 读持仓
2. 每只持仓跑 snapshot → 拿当前价 + 财务 + 估值
3. 计算 PnL + 持有期回报
4. 检查 BG_DNA 信号系统的 🟢🟡🔴
5. 检查用户设的卖出条件是否触发（关键词匹配）
6. 渲染 markdown 简报
7. 保存到 deliverables/briefing_YYYY-MM-DD.md
8. (可选) 发邮件

CLI:
    uv run python -m monitor.daily_briefing            # 只生成 markdown
    uv run python -m monitor.daily_briefing --email    # 同时发邮件
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

from fetchers.snapshot import snapshot
from monitor.portfolio import Position, load_portfolio
from screener.bg_evaluate import evaluate

ROOT = Path(__file__).parent.parent
DELIVERABLES = ROOT / "deliverables"
DELIVERABLES.mkdir(exist_ok=True)


def generate_briefing() -> tuple[str, str]:
    """生成简报。返回 (subject, markdown_body)."""
    positions = load_portfolio()
    today = date.today().isoformat()

    if not positions:
        return (
            f"【Leslie-stock 简报 {today}】无持仓",
            f"# {today} 简报\n\n持仓表为空，跳过。\n",
        )

    rows: list[dict] = []
    bg_reports = []

    for p in positions:
        try:
            snap = snapshot(p.code, p.market)
            quote = snap["quote"]
            price = quote.get("price")
            if price is None or price == "-":
                continue
            gain, pct = p.pnl(float(price))
            report = evaluate(snap)
            bg_reports.append((p, snap, report))
            rows.append({
                "name": p.name,
                "code": p.code,
                "market": p.market.upper(),
                "current": price,
                "change_today_pct": quote.get("change_pct"),
                "cost_price": p.buy_price,
                "shares": p.shares,
                "pos_pct": p.position_pct,
                "days_held": p.days_held(),
                "pnl_abs": gain,
                "pnl_pct": pct,
                "report": report,
            })
        except Exception as e:
            rows.append({
                "name": p.name,
                "code": p.code,
                "error": str(e)[:120],
            })

    total_cost = sum(r["cost_price"] * r["shares"] for r in rows if "cost_price" in r)
    total_value = sum(r["current"] * r["shares"] for r in rows if "current" in r)
    total_gain = total_value - total_cost
    total_pct = (total_value / total_cost - 1) * 100 if total_cost > 0 else 0

    # 渲染 markdown
    md = _render_briefing(today, rows, total_cost, total_value, total_gain, total_pct, bg_reports)
    subject = f"【Leslie-stock {today}】持仓 {total_pct:+.2f}% — {_subject_tail(rows, bg_reports)}"
    return subject, md


def _subject_tail(rows: list[dict], bg_reports: list) -> str:
    """根据是否有重要异动 / 告警决定 subject 尾巴。"""
    red_flags = 0
    for _, _, report in bg_reports:
        for d in report.dimensions.values():
            red_flags += sum(1 for f in d.flags if "🔴" in f)
    if red_flags >= 2:
        return "⚠️ 多项红色信号"
    elif red_flags == 1:
        return "🔴 1 项红色信号"
    return "持仓稳健"


def _render_briefing(today, rows, total_cost, total_value, total_gain, total_pct, bg_reports) -> str:
    L = []
    L.append(f"# {today} 盘后简报")
    L.append("")
    L.append(f"**当前总市值：¥/HK${total_value:,.0f}** ({total_pct:+.2f}%，累计盈亏 {total_gain:+,.0f})")
    L.append("")

    L.append("## 持仓快照")
    L.append("")
    L.append("| 股票 | 市场 | 现价 | 今涨幅 | 持仓盈亏 | 仓位 | 持有 |")
    L.append("|---|---|---:|---:|---:|---:|---:|")
    for r in rows:
        if "error" in r:
            L.append(f"| {r['name']} ({r['code']}) | — | — | — | ❌ {r['error']} | — | — |")
            continue
        ch_pct = r.get("change_today_pct")
        ch_str = f"{ch_pct:+.2f}%" if isinstance(ch_pct, (int, float)) else "—"
        ch_icon = "🟢" if isinstance(ch_pct, (int, float)) and ch_pct > 0 else ("🔴" if isinstance(ch_pct, (int, float)) and ch_pct < 0 else "")
        L.append(
            f"| {r['name']} ({r['code']}) | {r['market']} | "
            f"{r['current']:.2f} | {ch_icon} {ch_str} | "
            f"{r['pnl_pct']:+.2f}% ({r['pnl_abs']:+,.0f}) | "
            f"{r['pos_pct']:.0f}% | {r['days_held']} 天 |"
        )
    L.append("")

    L.append("## BG 框架信号检查")
    L.append("")
    for p, snap, report in bg_reports:
        L.append(f"### {p.name} ({p.code}/{p.market.upper()})")
        L.append("")
        L.append(f"- **买入逻辑**：{p.thesis}")
        L.append(f"- **综合评分**：{report.overall_score:.1f}/100 — {report.overall_grade}")
        # 列出所有红色 / 黄色信号
        all_flags = []
        for k, d in report.dimensions.items():
            for f in d.flags:
                all_flags.append(f)
        red = [f for f in all_flags if "🔴" in f]
        yellow = [f for f in all_flags if "🟡" in f]
        green = [f for f in all_flags if "🟢" in f]
        if red:
            L.append(f"- **🔴 红色信号**：")
            for f in red:
                L.append(f"  - {f}")
        if yellow:
            L.append(f"- **🟡 警告信号**：")
            for f in yellow:
                L.append(f"  - {f}")
        if green and not red:
            L.append(f"- **🟢 加分信号**：{len(green)} 项（{', '.join(green[:3])}{'...' if len(green) > 3 else ''}）")

        # 卖出条件人工检查（关键词匹配 — 比较粗糙，仅提示）
        if p.sell_conditions:
            L.append(f"- **卖出条件检查**（{len(p.sell_conditions)} 条）：人工复核 / 待 Claude 在对话中详查")
            for c in p.sell_conditions:
                L.append(f"  - [ ] {c}")
        L.append("")

    L.append("## 今日新闻摘要")
    L.append("")
    L.append("> ⚠️ TODO: 接入 akshare 新闻接口 + 巨潮公告，按持仓自动过滤。")
    L.append("")

    L.append("## 复盘提醒")
    L.append("")
    L.append("- [ ] 本月已做月度持仓复盘？（BG_DNA 第八部分 B）")
    L.append("- [ ] 持仓股有财报披露？")
    L.append("- [ ] 持仓股管理层有大动作？（减持/离职/并购）")
    L.append("")

    L.append("---")
    L.append("> 由 Leslie-stock 自动生成 · BG_DNA 框架 · 段永平 + 巴菲特方法论")

    return "\n".join(L)


def save_briefing(markdown: str, day: str | None = None) -> Path:
    day = day or date.today().isoformat()
    path = DELIVERABLES / f"briefing_{day}.md"
    path.write_text(markdown, encoding="utf-8")
    return path


def main(send_email: bool = False) -> None:
    subject, md = generate_briefing()
    path = save_briefing(md)
    print(f"📝 简报已保存：{path}")
    print(f"\n{md[:1000]}\n...")
    if send_email:
        try:
            from alerts.email_sender import send_briefing as send
            send(subject, md)
            print(f"✉️ 邮件已发送")
        except Exception as e:
            print(f"❌ 邮件发送失败：{e}")


if __name__ == "__main__":
    send = "--email" in sys.argv
    main(send_email=send)
