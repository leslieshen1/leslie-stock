#!/bin/bash
# 收盘分享卡 —— launchd 每天 08:05 北京 = 20:05 ET。
# 为什么是这个点:美股盘后 16:00–20:00 ET(北京 04:00–08:00),
# 盘后财报雷(ORCL -12% 这种)要到 20:00 ET 才定格;早出 = 数字会变 = 不诚实。
# 铁则「图随报告」:当天有报告派生 spec 就用 spec,否则机械模式。
export PATH="/Users/leslie/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd /Users/leslie/Workspace/ainvest/Leslie-stock || exit 1
mkdir -p logs

# 美东周六/周日没有收盘可言(北京周日/周一 08:05 对应 ET 周六/周日 20:05)
ET_DOW=$(TZ=America/New_York date +%u)
[ "$ET_DOW" -ge 6 ] && exit 0

ET_DATE=$(TZ=America/New_York date +%Y%m%d)
SPEC="data/cards/close-${ET_DATE}.spec.json"
echo "===== 收盘卡 $(date) · ET ${ET_DATE} =====" >> logs/cards.log
if [ -f "$SPEC" ]; then
  echo "spec 模式: $SPEC" >> logs/cards.log
  uv run python scripts/share_card.py --type close --spec "$SPEC" >> logs/cards.log 2>&1
else
  echo "机械模式(当天没有报告 spec)" >> logs/cards.log
  uv run python scripts/share_card.py --type close >> logs/cards.log 2>&1
fi
# 云端引擎兜底触发(cron 20:20 ET 不可靠时由此保底;幂等)
gh workflow run arena-engine.yml --ref main >> logs/cards.log 2>&1 || true
echo "----- done $(date) -----" >> logs/cards.log
