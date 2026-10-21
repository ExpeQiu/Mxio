#!/usr/bin/env bash
# Velxio 本地开发启动（非 Docker）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT/logs"
BACKEND_VENV="${VELXIO_BACKEND_VENV:-$HOME/.cache/velxio/backend-venv}"
BACKEND_PID="$LOG_DIR/backend.pid"
FRONTEND_PID="$LOG_DIR/frontend.pid"
export COPYFILE_DISABLE=1
export FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"
export VELXIO_NEWS="${VELXIO_NEWS:-off}"

mkdir -p "$LOG_DIR"

if [[ ! -x "$BACKEND_VENV/bin/uvicorn" ]]; then
  echo "[start] 后端 venv 不存在，请先运行: python3.11 -m venv $BACKEND_VENV && $BACKEND_VENV/bin/pip install -r backend/requirements.txt"
  exit 1
fi

if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
  echo "[start] 前端依赖未安装，请先运行: cd frontend && npm install --ignore-scripts"
  exit 1
fi

ensure_esp32_core() {
  if ! command -v arduino-cli >/dev/null 2>&1; then
    echo "[start] 未找到 arduino-cli，ESP32 编译会失败"
    return 0
  fi
  local ver=""
  ver="$(arduino-cli core list 2>/dev/null | awk '$1=="esp32:esp32"{print $2; exit}')"
  if [[ "$ver" == "2.0.17" ]]; then
    echo "[start] esp32:esp32@2.0.17 已安装"
    return 0
  fi
  echo "[start] 正在安装 esp32:esp32@2.0.17（首次需数分钟，日志: $LOG_DIR/arduino-esp32-core-install.log）"
  if [[ -n "$ver" ]]; then
    echo "[start] 当前版本为 ${ver}，仿真需要 2.0.17"
  fi
  arduino-cli core update-index >>"$LOG_DIR/arduino-esp32-core-install.log" 2>&1 || true
  python3 - <<'PY' >>"$LOG_DIR/arduino-esp32-core-install.log" 2>&1
from pathlib import Path
import os, subprocess
data = os.environ.get("ARDUINO_DIRECTORIES_DATA", "").strip()
if not data:
    r = subprocess.run(["arduino-cli", "config", "get", "directories.data"], capture_output=True, text=True)
    data = (r.stdout or "").strip() or str(Path.home() / "Library" / "Arduino15")
esp = "https://github.com/espressif/"
cdn = "https://dl.espressif.com/github_assets/espressif/"
proxy = os.environ.get("VELXIO_GITHUB_PROXY", "https://gh-proxy.com/https://github.com/")
for p in Path(data).glob("package_*index.json"):
    if (p.parent / f"{p.name}.sig").exists():
        continue
    t = p.read_text(encoding="utf-8")
    n = t.replace(esp, cdn)
    if proxy and proxy.lower() not in ("off", "0", "false"):
        if not proxy.endswith("/"):
            proxy = proxy + "/"
        n = n.replace('"url": "https://github.com/', f'"url": "{proxy}')
        n = n.replace('"url":"https://github.com/', f'"url":"{proxy}')
    if n != t:
        p.write_text(n, encoding="utf-8")
        print(f"rewrote {p}")
PY
  if arduino-cli core install esp32:esp32@2.0.17 >>"$LOG_DIR/arduino-esp32-core-install.log" 2>&1; then
    echo "[start] esp32:esp32@2.0.17 安装完成"
  else
    echo "[start] ESP32 核心安装失败，请查看 $LOG_DIR/arduino-esp32-core-install.log"
  fi
}

ensure_libqemu() {
  local dest="$ROOT/backend/app/services/libqemu-xtensa.dylib"
  if [[ -f "$dest" ]]; then
    echo "[start] libqemu-xtensa.dylib 已存在"
    return 0
  fi
  if [[ "$(uname -m)" != "arm64" ]]; then
    echo "[start] 本机非 Apple Silicon，请按 docs/BUILD-QEMU.md 自行放置 libqemu"
    return 0
  fi
  local base="https://github.com/davidmonterocrespo24/velxio/releases/download/qemu-prebuilt"
  echo "[start] 下载 ESP32 仿真库 libqemu-xtensa.dylib（约 24MB）"
  mkdir -p "$ROOT/backend/app/services"
  if curl -L --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 180 \
      -o "$dest.part" "$base/libqemu-xtensa-macos-arm64.dylib" \
      && mv "$dest.part" "$dest"; then
    echo "[start] libqemu-xtensa.dylib 就绪"
  else
    rm -f "$dest.part"
    echo "[start] libqemu 下载失败：运行 ESP32 会提示 qemu-system-xtensa not found"
  fi
}

ensure_esp32_core
ensure_libqemu

if lsof -nP -iTCP:8001 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[start] 后端已在 8001 端口运行"
  lsof -ti tcp:8001 | head -1 >"$BACKEND_PID" || true
else
  echo "[start] 启动后端 http://127.0.0.1:8001"
  (
    cd "$ROOT/backend"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] start uvicorn pid-pending" >>"$LOG_DIR/backend.log"
    nohup "$BACKEND_VENV/bin/uvicorn" app.main:app \
      --host 127.0.0.1 --port 8001 \
      >>"$LOG_DIR/backend.log" 2>&1 &
    echo $! >"$BACKEND_PID"
    disown $! 2>/dev/null || true
  )
fi

if lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[start] 前端已在 5173 端口运行"
else
  echo "[start] 启动前端 http://127.0.0.1:5173"
  (
    cd "$ROOT/frontend"
    if [[ ! -d public/monaco/vs ]]; then
      node scripts/copy-monaco.mjs
    fi
    nohup npx vite --host 127.0.0.1 --port 5173 \
      >"$LOG_DIR/frontend.log" 2>&1 &
    echo $! >"$FRONTEND_PID"
    disown $! 2>/dev/null || true
  )
fi

echo "[start] 启动 3Dm 视口 http://127.0.0.1:5174"
"$ROOT/3Dm/start.sh"

for i in $(seq 1 45); do
  if curl -sf http://127.0.0.1:8001/health >/dev/null && curl -sf http://127.0.0.1:5173/ >/dev/null && curl -sf http://127.0.0.1:5174/ >/dev/null; then
    echo "[start] 就绪"
    echo "  前端: http://127.0.0.1:5173"
    echo "  后端: http://127.0.0.1:8001"
    echo "  3Dm:  http://127.0.0.1:5174"
    echo "  API:  http://127.0.0.1:8001/api/docs"
    exit 0
  fi
  sleep 1
done

echo "[start] 超时，请查看 $LOG_DIR/*.log 与 3Dm/logs/3dm.log"
exit 1
