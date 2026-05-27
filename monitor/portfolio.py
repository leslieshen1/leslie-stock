"""持仓加载与跟踪。"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent.parent
PORTFOLIO_PATH = ROOT / "core" / "portfolio.csv"


@dataclass
class Position:
    code: str
    market: str          # "a" / "hk"
    name: str
    buy_date: date
    buy_price: float
    shares: int
    position_pct: float  # 0-100
    thesis: str
    sell_conditions: list[str]
    notes: str = ""

    def days_held(self) -> int:
        return (date.today() - self.buy_date).days

    def cost(self) -> float:
        return self.buy_price * self.shares

    def pnl(self, current_price: float) -> tuple[float, float]:
        """返回 (绝对盈亏, 收益率%)."""
        gain = (current_price - self.buy_price) * self.shares
        pct = (current_price / self.buy_price - 1) * 100
        return gain, pct


def load_portfolio(path: Path | str | None = None) -> list[Position]:
    """加载持仓 CSV → Position 列表。"""
    path = Path(path or PORTFOLIO_PATH)
    if not path.exists():
        return []

    # 跳过 # 开头的注释行
    df = pd.read_csv(path, comment="#", dtype={"code": str})
    if len(df) == 0:
        return []

    positions: list[Position] = []
    for _, row in df.iterrows():
        try:
            sell_conds = [s.strip() for s in str(row.get("sell_conditions", "")).split(";") if s.strip()]
            positions.append(Position(
                code=str(row["code"]).strip(),
                market=str(row["market"]).strip().lower(),
                name=str(row["name"]).strip(),
                buy_date=pd.to_datetime(row["buy_date"]).date(),
                buy_price=float(row["buy_price"]),
                shares=int(row["shares"]),
                position_pct=float(row.get("position_pct", 0)),
                thesis=str(row.get("thesis", "")).strip(),
                sell_conditions=sell_conds,
                notes=str(row.get("notes", "")).strip(),
            ))
        except Exception as e:
            print(f"⚠️ 跳过无效行: {row.to_dict()} 原因: {e}")
    return positions


if __name__ == "__main__":
    positions = load_portfolio()
    print(f"已加载 {len(positions)} 个持仓:")
    for p in positions:
        print(f"  {p.name} ({p.code}/{p.market.upper()}) — 持有 {p.days_held()} 天，仓位 {p.position_pct}%")
