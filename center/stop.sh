#!/usr/bin/env bash
# 综合窗口无独立进程；不停止 Velxio 前端。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$ROOT/logs"
echo "ts=$(date -Iseconds) msg=center_stop" >>"$ROOT/logs/center.log"
echo "[center] 无独立进程。停止整个编辑器请用 ../stop.sh"
