#!/usr/bin/env bash
# 导出 AI 视觉机械臂电路（图库示例 esp32cam-ai-arm → .vlx）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VX="$ROOT/bin/velxio"
chmod +x "$VX"

OUT="${1:-$ROOT/fixtures/ai-vision-arm.vlx}"
LOG_DIR="$ROOT/logs"
mkdir -p "$(dirname "$OUT")" "$LOG_DIR"
LOG="$LOG_DIR/draw-ai-vision-arm.log"

log() {
  local line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$line" | tee -a "$LOG" >&2
}

: >"$LOG"
log "start export esp32cam-ai-arm → $OUT"
"$VX" --format json example export esp32cam-ai-arm -o "$OUT" --force | tee -a "$LOG"
"$VX" --format json circuit validate -p "$OUT" | tee -a "$LOG"
"$VX" --demo --format json compile -p "$OUT" | tee -a "$LOG"
log "done vlx=$OUT"
echo "$OUT"
