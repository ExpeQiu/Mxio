#!/usr/bin/env bash
# 3Dm 视口：本地 Vite
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT/logs"
PID_FILE="$LOG_DIR/3dm.pid"
PORT="${VELXIO_3DM_PORT:-5174}"
export COPYFILE_DISABLE=1

mkdir -p "$LOG_DIR"

if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "[3dm] npm install…"
  (cd "$ROOT" && npm install --ignore-scripts)
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[3dm] 已在 $PORT 运行"
else
  echo "[3dm] 启动 http://127.0.0.1:$PORT"
  cd "$ROOT"
  nohup "$ROOT/node_modules/.bin/vite" --host 127.0.0.1 --port "$PORT" \
    >"$LOG_DIR/3dm.log" 2>&1 &
  echo $! >"$PID_FILE"
  disown $! 2>/dev/null || true
fi

for i in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:$PORT/" >/dev/null; then
    echo "[3dm] 就绪  http://127.0.0.1:$PORT"
    echo "  embed: http://127.0.0.1:$PORT/?embed=1&mech=4dof-arm"
    exit 0
  fi
  sleep 0.25
done

echo "[3dm] 超时，见 $LOG_DIR/3dm.log"
exit 1
