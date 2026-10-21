#!/usr/bin/env bash
# Velxio 本地开发验收
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FAIL=0

check() {
  local name="$1" cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    echo "[ok] $name"
  else
    echo "[fail] $name"
    FAIL=1
  fi
}

check "frontend 5173" "curl -sf http://127.0.0.1:5173/"
check "backend health" "curl -sf http://127.0.0.1:8001/health"
check "vap llm mock health" "curl -sf http://127.0.0.1:8001/api/vap/health | grep -q '\"mock\"'"
check "vap llm mock complete" "curl -sf -X POST http://127.0.0.1:8001/api/vap/v1/chat/completions -H 'Content-Type: application/json' -d '{\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}]}' | grep -q '\"content\"'"
check "backend docs" "curl -sf http://127.0.0.1:8001/api/docs"
check "arduino-cli" "command -v arduino-cli"

if command -v arduino-cli >/dev/null; then
  if arduino-cli core list 2>/dev/null | grep -q 'arduino:avr'; then
    echo "[ok] arduino:avr core"
  else
    echo "[warn] arduino:avr core 未安装（编译 Arduino 板卡需要）"
  fi
  if arduino-cli core list 2>/dev/null | awk '$1=="esp32:esp32"{found=1} END{exit !found}'; then
    echo "[ok] esp32:esp32 core"
  else
    echo "[fail] esp32:esp32 core 未安装（编译 ESP32-CAM 需要）"
    FAIL=1
  fi
fi

if [[ -x "$ROOT/cli/scripts/verify.sh" ]]; then
  if [[ -x "$ROOT/cli/node_modules/.bin/tsx" || -x "$ROOT/node_modules/.bin/tsx" ]]; then
    if bash "$ROOT/cli/scripts/verify.sh"; then
      echo "[ok] cli verify"
    else
      echo "[fail] cli verify"
      FAIL=1
    fi
  else
    echo "[warn] 跳过 CLI verify（先 cd cli && npm install）"
  fi
fi

boards="$(curl -sf http://127.0.0.1:8001/api/compile/boards 2>/dev/null || echo '{}')"
if echo "$boards" | grep -q '"boards":\[[^]]'; then
  echo "[ok] compile boards API"
else
  echo "[warn] compile boards 为空（AVR core 装完后重启后端）"
fi

if [[ -x "$ROOT/3Dm/verify.sh" ]]; then
  if bash "$ROOT/3Dm/verify.sh"; then
    echo "[ok] 3Dm verify"
  else
    echo "[fail] 3Dm verify"
    FAIL=1
  fi
fi

BACKEND_VENV="${VELXIO_BACKEND_VENV:-$HOME/.cache/velxio/backend-venv}"
if [[ -x "$BACKEND_VENV/bin/python" ]]; then
  if (cd "$ROOT" && PYTHONPATH="$ROOT/backend:$ROOT/AppS/server" "$BACKEND_VENV/bin/python" AppS/tests/test_vap_llm.py); then
    echo "[ok] vap llm unit"
  else
    echo "[fail] vap llm unit"
    FAIL=1
  fi
else
  echo "[warn] 跳过 vap llm unit（无 backend venv）"
fi

if [[ -x "$ROOT/frontend/node_modules/.bin/vitest" ]]; then
  if (cd "$ROOT/frontend" && npx vitest run src/__tests__/vap-protocol.test.ts src/__tests__/vap-registry.test.ts src/__tests__/ai-chat-bot.test.ts ../AppS/web/drive.test.ts ../AppS/web/remoteKeys.test.ts ../AppS/web/peripherals.test.ts); then
    echo "[ok] vap unit"
  else
    echo "[fail] vap unit"
    FAIL=1
  fi
else
  echo "[warn] 跳过 vap unit（先 cd frontend && npm install）"
fi

if [[ -x "$ROOT/center/verify.sh" ]]; then
  if bash "$ROOT/center/verify.sh"; then
    echo "[ok] center verify"
  else
    echo "[fail] center verify"
    FAIL=1
  fi
fi

if [[ "$FAIL" -eq 0 ]]; then
  echo "[verify] 通过"
else
  echo "[verify] 失败"
  exit 1
fi
