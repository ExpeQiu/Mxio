#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT/logs"
PORT="${VELXIO_3DM_PORT:-5174}"

if [[ -f "$LOG_DIR/3dm.pid" ]]; then
  pid="$(cat "$LOG_DIR/3dm.pid")"
  if kill -0 "$pid" 2>/dev/null; then
    echo "[3dm] 停止 pid $pid"
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$LOG_DIR/3dm.pid"
fi

pids="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
if [[ -n "$pids" ]]; then
  echo "[3dm] 释放端口 $PORT"
  kill $pids 2>/dev/null || true
fi

echo "[3dm] 已停止"
