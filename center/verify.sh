#!/usr/bin/env bash
# 综合窗口 P0–P3 单测
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FE="$(cd "$ROOT/../frontend" && pwd)"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"
export COPYFILE_DISABLE=1

if [[ ! -x "$FE/node_modules/.bin/vitest" ]]; then
  echo "[center] 缺少 frontend/node_modules，请先: cd frontend && npm install --ignore-scripts"
  exit 1
fi

fail=0
check() {
  local name="$1"
  shift
  if "$@" >>"$LOG_DIR/verify.log" 2>&1; then
    echo "[ok] $name"
  else
    echo "[fail] $name （见 center/logs/verify.log）"
    fail=1
  fi
}

: >"$LOG_DIR/verify.log"
cd "$FE"
check "layout" "$FE/node_modules/.bin/vitest" run --config "$FE/vitest.config.ts" ../center/web/layout.test.ts
check "hops" "$FE/node_modules/.bin/vitest" run --config "$FE/vitest.config.ts" ../center/web/hopLayers.test.ts
check "auto studio" "$FE/node_modules/.bin/vitest" run --config "$FE/vitest.config.ts" ../center/web/applyStudio.test.ts
check "selector" "$FE/node_modules/.bin/vitest" run --config "$FE/vitest.config.ts" ../center/web/studio-selector.test.ts
check "motion kit" "$FE/node_modules/.bin/vitest" run --config "$FE/vitest.config.ts" ../center/web/motionKit.test.ts
check "apply bom" "$FE/node_modules/.bin/vitest" run --config "$FE/vitest.config.ts" ../center/web/applyBom.test.ts
check "remote keys" "$FE/node_modules/.bin/vitest" run --config "$FE/vitest.config.ts" ../AppS/web/remoteKeys.test.ts
check "peripherals" "$FE/node_modules/.bin/vitest" run --config "$FE/vitest.config.ts" ../AppS/web/peripherals.test.ts

if [[ "$fail" -eq 0 ]]; then
  echo "[verify] center P0–P3 通过"
else
  echo "[verify] center 失败"
  exit 1
fi
