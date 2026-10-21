#!/usr/bin/env bash
# 综合窗口随 Velxio 前端一起提供，无独立端口。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
VELXIO="$(cd "$ROOT/.." && pwd)"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"
export COPYFILE_DISABLE=1

{
  echo "ts=$(date -Iseconds) msg=center_start frontend=http://127.0.0.1:5173/example/esp32cam-ai-arm"
} >>"$LOG_DIR/center.log"

if curl -sf http://127.0.0.1:5173/ >/dev/null 2>&1; then
  echo "[center] 前端已在 5173。视觉臂会自动进综合视图："
  echo "  http://127.0.0.1:5173/example/esp32cam-ai-arm"
  exit 0
fi

echo "[center] 前端未运行。请先执行: $VELXIO/start.sh"
echo "[center] 或手动打开 /example/esp32cam-ai-arm 后点工具栏「综合」"
exit 0
