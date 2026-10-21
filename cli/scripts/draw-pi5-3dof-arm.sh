#!/usr/bin/env bash
# 导出 Pi 5 三轴机械摆臂（图库示例 pi5-3dof-arm → .vlx）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VX="$ROOT/bin/velxio"
chmod +x "$VX"

OUT="${1:-$ROOT/fixtures/pi5-3dof-arm.vlx}"
LOG_DIR="$ROOT/logs"
mkdir -p "$(dirname "$OUT")" "$LOG_DIR"
LOG="$LOG_DIR/draw-pi5-3dof-arm.log"

log() {
  local line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$line" | tee -a "$LOG" >&2
}

: >"$LOG"
log "start export pi5-3dof-arm → $OUT"
"$VX" --format json example export pi5-3dof-arm -o "$OUT" --force | tee -a "$LOG"
"$VX" --format json circuit validate -p "$OUT" | tee -a "$LOG"
"$VX" --demo --format json compile -p "$OUT" | tee -a "$LOG"
log "done vlx=$OUT"
echo "$OUT"
