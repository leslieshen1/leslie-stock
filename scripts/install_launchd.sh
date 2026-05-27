#!/bin/bash
# 安装 launchd 定时任务
# 跑这个脚本一次，之后每天 16:30 自动执行 daily_job.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_SRC="$SCRIPT_DIR/com.leslie.stock.daily.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.leslie.stock.daily.plist"

if [ ! -f "$PLIST_SRC" ]; then
    echo "❌ 找不到 $PLIST_SRC"
    exit 1
fi

# 确保 daily_job.sh 可执行
chmod +x "$SCRIPT_DIR/daily_job.sh"

# 拷到 ~/Library/LaunchAgents
mkdir -p "$HOME/Library/LaunchAgents"
cp "$PLIST_SRC" "$PLIST_DST"

# 卸载旧的（如有），再加载
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load -w "$PLIST_DST"

echo "✅ 已安装 launchd 任务：com.leslie.stock.daily"
echo "   每天 16:30 自动跑 scripts/daily_job.sh"
echo ""
echo "卸载："
echo "   launchctl unload $PLIST_DST"
echo ""
echo "立即跑一次："
echo "   launchctl start com.leslie.stock.daily"
echo ""
echo "看下次触发时间："
echo "   launchctl list | grep leslie.stock"
