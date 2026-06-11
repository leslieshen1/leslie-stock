#!/bin/bash
# 每日数据刷新 + 上线(launchd 每天 05:00 北京 = 美东 ~17:00 收盘后调用)。
# refresh.py --deploy = 抓全部数据源 → leslie.db → 派生 JSON → git 提交 → Vercel 部署。
# 周日 05:00(美东周六)市场没新数据,跑了也无害(幂等),不特判。
export PATH="/Users/leslie/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd /Users/leslie/Workspace/ainvest/Leslie-stock || exit 1
mkdir -p logs

echo "===== 每日刷新 $(date) =====" >> logs/refresh.log
# 闭市时刻先定格四指数昨收(BIG EVENTS 卡 17:00 只读这个文件,不再临场调 Nasdaq)
uv run python scripts/capture_yclose.py >> logs/refresh.log 2>&1
uv run python scripts/refresh.py --deploy >> logs/refresh.log 2>&1
# 收盘卡不在这里出 —— 05:00 北京 = 17:00 ET 盘后还在交易(ORCL 那种盘后雷没爆完),
# 卡片挪到 close_card_job.sh(08:05 北京 = 20:05 ET,盘后定格)。
echo "----- done $(date) -----" >> logs/refresh.log
