#!/usr/bin/env bash
# Recreate the gallery project and verify its Python + real electrical behavior.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export TSX_TSCONFIG_PATH="$ROOT/tsconfig.json"
OUT="${1:-$ROOT/fixtures/pi5-button-led.vlx}"
mkdir -p "$(dirname "$OUT")" "$ROOT/logs"
node --import "$ROOT/src/register-vite-raw.mjs" \
  --import "$ROOT/node_modules/tsx/dist/loader.mjs" "$ROOT/src/cli.ts" \
  example export pi5-button-led -o "$OUT" --force
node --import "$ROOT/src/register-vite-raw.mjs" \
  --import "$ROOT/node_modules/tsx/dist/loader.mjs" "$ROOT/src/cli.ts" \
  --demo compile -p "$OUT"
"${VELXIO_PYTHON:-python3}" "$ROOT/scripts/verify-pi5-button-led.py" "$OUT"
