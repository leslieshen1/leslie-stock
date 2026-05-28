#!/usr/bin/env bash
# daily_pulse.sh — 日常 cron / launchd 调度入口
# 1. 跑 fetch_pulse.py 拉数据
# 2. SQLite 备份到 ~/Backups/leslie-stock/
# 3. 保留最近 30 天备份，删更老的

set -euo pipefail

PROJECT_ROOT="/Users/leslie/Workspace/ainvest/Leslie-stock"
DB_PATH="${PROJECT_ROOT}/data/pulse.db"
BACKUP_DIR="${HOME}/Backups/leslie-stock"
LOG_DIR="${PROJECT_ROOT}/data/logs"
TS=$(date +%Y%m%d-%H%M%S)
LOG_FILE="${LOG_DIR}/pulse-${TS}.log"

mkdir -p "$BACKUP_DIR" "$LOG_DIR"

{
  echo "===== $(date -u +%Y-%m-%dT%H:%M:%SZ) ====="
  echo "[fetch] starting"
  cd "$PROJECT_ROOT"
  /usr/bin/python3 data/fetch_pulse.py
  echo
  echo "[backup] sqlite -> ${BACKUP_DIR}/pulse-$(date +%Y%m%d).db"
  /usr/bin/sqlite3 "$DB_PATH" ".backup '${BACKUP_DIR}/pulse-$(date +%Y%m%d).db'"
  echo
  echo "[cleanup] removing backups older than 30 days"
  find "$BACKUP_DIR" -name "pulse-*.db" -type f -mtime +30 -print -delete || true
  find "$LOG_DIR" -name "pulse-*.log" -type f -mtime +30 -print -delete || true
  echo
  echo "[done] $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} 2>&1 | tee -a "$LOG_FILE"
