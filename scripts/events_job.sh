#!/bin/bash
# TODAY'S BIG EVENTS 卡 —— 每天 17:00 北京(= 美东凌晨)自动出图,落 ~/Downloads。周末跳过。
export PATH="/Users/leslie/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd /Users/leslie/Workspace/ainvest/Leslie-stock || exit 1
mkdir -p logs
DOW=$(date +%u)
if [ "$DOW" -eq 6 ] || [ "$DOW" -eq 7 ]; then
  echo "$(date) 周末,跳过 BIG EVENTS 卡" >> logs/events.log; exit 0
fi
echo "===== BIG EVENTS 卡 $(date) =====" >> logs/events.log
uv run python scripts/big_events_card.py >> logs/events.log 2>&1
