#!/usr/bin/env bash
# Velxio 本地开发停止
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT/logs"

stop_pid_file() {
  local file="$1" label="$2"
  if [[ -f "$file" ]]; then
    local pid
    pid="$(cat "$file")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "[stop] 停止 $label (pid $pid)"
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$file"
  fi
}

stop_pid_file "$LOG_DIR/frontend.pid" "frontend"
stop_pid_file "$LOG_DIR/backend.pid" "backend"
"$ROOT/3Dm/stop.sh"

for port in 5173 5174 8001; do
  pids="$(lsof -ti tcp:$port 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "[stop] 释放端口 $port"
    kill $pids 2>/dev/null || true
  fi
done

echo "[stop] 完成"
