#!/bin/bash
# 盘前报告定时入口(launchd 每天 20:30 北京 = 美东 08:30 = 开盘前 1h 调用)。
# 设好 PATH 让 uv / claude / node 都可见。周末不跑(美股休市)。
export PATH="/Users/leslie/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd /Users/leslie/Workspace/ainvest/Leslie-stock || exit 1
mkdir -p logs

# 周末(美东周六=本地周日, 周日=本地周一上午前)休市 —— 本地周六/周日 20:30 对应美东周六/周日,跳过
DOW=$(date +%u)   # 1=Mon .. 7=Sun(本地/北京)
if [ "$DOW" -eq 6 ] || [ "$DOW" -eq 7 ]; then
  echo "$(date) 周末休市,跳过盘前报告" >> logs/premarket.log
  exit 0
fi

echo "===== 盘前报告 $(date) =====" >> logs/premarket.log
uv run python scripts/premarket_report.py >> logs/premarket.log 2>&1
# 盘前分享卡 → ~/Downloads(AInvest 品牌,拿了就发)
uv run python scripts/share_card.py --type premarket >> logs/premarket.log 2>&1
# 盘前 AI 卡(16:9,自动 spec + gpt-image-2 + 自检)→ ~/Downloads
uv run python scripts/premarket_ai_cards.py >> logs/premarket.log 2>&1
echo "----- done $(date) -----" >> logs/premarket.log
