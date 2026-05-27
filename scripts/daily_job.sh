#!/bin/bash
# Leslie-stock 每日自动任务
# 每天 16:30（A 股收盘后 30 分钟）由 launchd 触发
#
# 任务顺序：
# 1. 更新 universe（拉最新股票池）
# 2. 跑 BG 排名（量化 + GLM 深度分析 TOP 30）
# 3. 拉持仓股新闻 + GLM 解读
# 4. 生成每日盘后简报
# 5. 发送邮件（如已配置）
#
# 日志：logs/daily_YYYY-MM-DD.log

set -e

PROJECT_ROOT="/Users/leslie/Workspace/ainvest/Leslie-stock"
cd "$PROJECT_ROOT"

# 确保 PATH 能找到 uv
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOG_DIR"

TODAY=$(date +%Y-%m-%d)
LOG="$LOG_DIR/daily_$TODAY.log"

echo "===== Leslie-stock 每日任务开始：$(date) =====" | tee -a "$LOG"

# 1. 更新股票池（约 10 分钟）
echo "" | tee -a "$LOG"
echo "[1/4] 更新股票池 universe …" | tee -a "$LOG"
uv run python -m fetchers.universe >> "$LOG" 2>&1 || echo "⚠️ universe 失败，跳过" | tee -a "$LOG"

# 2. BG 量化排名 + GLM TOP 30 深度分析（约 20-30 分钟）
echo "" | tee -a "$LOG"
echo "[2/4] BG 排名 + GLM-5.1 深度分析 TOP 30 …" | tee -a "$LOG"
uv run python -m screener.rank_universe --limit 50 --with-llm --llm-top 30 --parallel 3 >> "$LOG" 2>&1 || echo "⚠️ rank 部分失败" | tee -a "$LOG"

# 3. 拉持仓股新闻 + GLM 解读
echo "" | tee -a "$LOG"
echo "[3/4] 拉持仓股新闻 + GLM 解读 …" | tee -a "$LOG"
# 读 portfolio.csv 提取所有 code,market 然后分别跑
while IFS=, read -r code market name buy_date buy_price shares rest; do
    code=$(echo "$code" | tr -d '"' | xargs)
    market=$(echo "$market" | tr -d '"' | xargs)
    # 跳过注释行和表头
    [[ "$code" == "code" || "$code" == \#* || -z "$code" ]] && continue
    echo "  → 拉 $code/$market 新闻 + 分析" | tee -a "$LOG"
    uv run python -m news.fetch "$code" "$market" 7 >> "$LOG" 2>&1 || true
    uv run python -m news.analyze "$code" "$market" >> "$LOG" 2>&1 || true
done < "$PROJECT_ROOT/core/portfolio.csv"

# 4. 生成 + 发送每日简报
echo "" | tee -a "$LOG"
echo "[4/4] 生成每日简报 …" | tee -a "$LOG"
if [ -f "$PROJECT_ROOT/.env" ] && grep -q "^EMAIL_PASSWORD=." "$PROJECT_ROOT/.env"; then
    uv run python -m monitor.daily_briefing --email >> "$LOG" 2>&1
else
    uv run python -m monitor.daily_briefing >> "$LOG" 2>&1
fi

echo "" | tee -a "$LOG"
echo "===== 完成：$(date) =====" | tee -a "$LOG"
