#!/bin/bash
# 每日数据刷新 + 上线(launchd 每天 05:00 北京 = 美东 ~17:00 收盘后调用)。
# refresh.py --deploy = 抓全部数据源 → leslie.db → 派生 JSON → git 提交 → Vercel 部署。
# 周日 05:00(美东周六)市场没新数据,跑了也无害(幂等),不特判。
export PATH="/Users/leslie/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd /Users/leslie/Workspace/ainvest/Leslie-stock || exit 1
mkdir -p logs

echo "===== 每日刷新 $(date) =====" >> logs/refresh.log
uv run python scripts/refresh.py --deploy >> logs/refresh.log 2>&1
# 收盘分享卡 → ~/Downloads
uv run python scripts/share_card.py --type close >> logs/refresh.log 2>&1
echo "----- done $(date) -----" >> logs/refresh.log
