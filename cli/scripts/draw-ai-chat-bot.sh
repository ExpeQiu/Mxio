#!/usr/bin/env bash
# 导出 ESP32 AI 对话机器人电路（图库示例 esp32-ai-chat → .vlx）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VX="$ROOT/bin/velxio"
chmod +x "$VX"

OUT="${1:-$ROOT/fixtures/ai-chat-bot.vlx}"
LOG_DIR="$ROOT/logs"
mkdir -p "$(dirname "$OUT")" "$LOG_DIR"
LOG="$LOG_DIR/draw-ai-chat-bot.log"

log() {
  local line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$line" | tee -a "$LOG" >&2
}

: >"$LOG"
log "start export esp32-ai-chat → $OUT"
"$VX" --format json example export esp32-ai-chat -o "$OUT" --force | tee -a "$LOG"
"$VX" --format json circuit validate -p "$OUT" | tee -a "$LOG"
"$VX" --demo --format json compile -p "$OUT" | tee -a "$LOG"
log "done vlx=$OUT"
echo "$OUT"
