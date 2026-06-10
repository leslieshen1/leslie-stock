#!/bin/bash
# 今日事(纯文本)定时入口 —— 每天 17:00 北京(= 美东凌晨)生成,落 ~/Downloads。
# 周末美股无日历,跳过。
export PATH="/Users/leslie/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd /Users/leslie/Workspace/ainvest/Leslie-stock || exit 1
mkdir -p logs
DOW=$(date +%u)
if [ "$DOW" -eq 6 ] || [ "$DOW" -eq 7 ]; then
  echo "$(date) 周末,跳过今日事" >> logs/events.log; exit 0
fi
echo "===== 今日事 $(date) =====" >> logs/events.log
uv run python scripts/today_events.py >> logs/events.log 2>&1
