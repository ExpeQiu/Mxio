#!/usr/bin/env bash
# Velxio CLI 验收：收集退出码 + JSON 字段；分层 offline / spice-live / compile-live / run-live
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -x node_modules/.bin/tsx && ! -x ../node_modules/.bin/tsx ]]; then
  echo "[cli] npm install…"
  npm install --ignore-scripts
fi

VX="$ROOT/bin/velxio"
chmod +x "$VX"
TMP="$(mktemp -d)"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/verify.log"
: >"$LOG"
trap 'rm -rf "$TMP"' EXIT

PASSED=0
FAILED=0
SKIPPED=0
LAYER=offline

log() {
  echo "$*" | tee -a "$LOG"
}

json_field() {
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const j = JSON.parse(readFileSync(process.argv[1], "utf8"));
    let v = j;
    for (const p of process.argv[2].split(".")) {
      if (v == null || !(p in v)) process.exit(2);
      v = v[p];
    }
    process.stdout.write(typeof v === "string" ? v : String(v));
  ' "$1" "$2"
}

raw_expect() {
  local exp="$1"
  shift
  local checks=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do
    checks+=("$1")
    shift
  done
  [[ "${1:-}" == "--" ]] || return 1
  shift
  local out err
  out=$(mktemp)
  err=$(mktemp)
  set +e
  "$@" >"$out" 2>"$err"
  local ec=$?
  set -e
  if [[ $ec -ne $exp ]]; then
    rm -f "$out" "$err"
    return 1
  fi
  if [[ ${#checks[@]} -gt 0 ]]; then
    if ! node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$out" >/dev/null 2>&1; then
      rm -f "$out" "$err"
      return 1
    fi
    local c key want got
    for c in "${checks[@]}"; do
      key="${c%%=*}"
      want="${c#*=}"
      got=$(json_field "$out" "$key" 2>/dev/null) || {
        rm -f "$out" "$err"
        return 1
      }
      if [[ "$got" != "$want" ]]; then
        rm -f "$out" "$err"
        return 1
      fi
    done
  fi
  rm -f "$out" "$err"
  return 0
}

expect() {
  local name="$1" exp="$2"
  shift 2
  local checks=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do
    checks+=("$1")
    shift
  done
  if [[ "${1:-}" != "--" ]]; then
    log "[fail][$LAYER] $name (harness: missing --)"
    FAILED=$((FAILED + 1))
    return
  fi
  shift
  local out err
  out=$(mktemp)
  err=$(mktemp)
  set +e
  "$@" >"$out" 2>"$err"
  local ec=$?
  set -e
  {
    echo "---- $name (exit $ec want $exp) ----"
    echo "[stdout]"
    cat "$out"
    echo "[stderr]"
    cat "$err"
    echo
  } >>"$LOG"
  if [[ $ec -ne $exp ]]; then
    log "[fail][$LAYER] $name (exit $ec want $exp)"
    FAILED=$((FAILED + 1))
    rm -f "$out" "$err"
    return
  fi
  if [[ ${#checks[@]} -gt 0 ]]; then
    if ! node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$out" >/dev/null 2>&1; then
      log "[fail][$LAYER] $name (stdout is not JSON)"
      FAILED=$((FAILED + 1))
      rm -f "$out" "$err"
      return
    fi
    local c key want got
    for c in "${checks[@]}"; do
      key="${c%%=*}"
      want="${c#*=}"
      got=$(json_field "$out" "$key" 2>>"$LOG") || {
        log "[fail][$LAYER] $name (missing $key)"
        FAILED=$((FAILED + 1))
        rm -f "$out" "$err"
        return
      }
      if [[ "$got" != "$want" ]]; then
        log "[fail][$LAYER] $name ($key=$got want $want)"
        FAILED=$((FAILED + 1))
        rm -f "$out" "$err"
        return
      fi
    done
  fi
  log "[pass][$LAYER] $name"
  PASSED=$((PASSED + 1))
  rm -f "$out" "$err"
}

skip() {
  log "[skip][$LAYER] $1"
  SKIPPED=$((SKIPPED + 1))
}

file_sha() {
  shasum -a 256 "$1" | awk '{print $1}'
}

# 假命令退出 1 但打印成功字符串：旧 grep 会误判，驱动必须拒绝。
if raw_expect 0 ok=true -- bash -c 'printf "%s\n" "{\"ok\": true}"; exit 1'; then
  log "[fail][offline] harness self-test accepted fake ok string"
  FAILED=$((FAILED + 1))
else
  log "[pass][offline] harness rejects nonzero despite ok string"
  PASSED=$((PASSED + 1))
fi

expect "unit parse-drive" 0 -- "$ROOT/node_modules/.bin/tsx" --tsconfig "$ROOT/tsconfig.json" "$ROOT/tests/parse-drive.ts"
expect "unit m1" 0 -- "$ROOT/node_modules/.bin/tsx" --tsconfig "$ROOT/tsconfig.json" "$ROOT/tests/m1-unit.ts"
expect "help" 0 -- "$VX" --help
expect "version envelope" 0 module=version protocol=1 -- "$VX" --format json version
expect "invalid format" 1 error_code=INVALID_FORMAT -- "$VX" --format xml version
expect "unknown command" 1 error_code=UNKNOWN_COMMAND -- "$VX" --format json nosuchcmd
expect "doctor demo offline" 0 module=doctor mode=offline ok=true data_source=demo -- "$VX" --demo --format json doctor
expect "parts list demo" 0 module=parts.list -- "$VX" --demo --format json parts list
expect "parts show dc-motor" 0 -- "$VX" --format json parts show dc-motor
expect "boards list" 0 -- "$VX" --format json boards list
expect "example catalog" 0 -- "$VX" --format json example list
expect "example list analog" 0 -- "$VX" --format json example list --board analog

expect "example export 4wd" 0 ok=true -- "$VX" --format json example export pi5-4wd-car -o "$TMP/car.vlx"
expect "circuit validate 4wd" 0 ok=true -- "$VX" --format json circuit validate -p "$TMP/car.vlx"
expect "example export blink" 0 ok=true -- "$VX" --format json example export blink-led -o "$TMP/blink.vlx"
expect "compile blink demo" 0 status=ok data_source=demo -- "$VX" --demo --format json compile -p "$TMP/blink.vlx"
expect "example export analog" 0 ok=true -- "$VX" --format json example export an-voltage-divider -o "$TMP/div.vlx"
expect "circuit validate analog" 0 ok=true -- "$VX" --format json circuit validate -p "$TMP/div.vlx"
expect "project show analog" 0 -- "$VX" --format json project show -p "$TMP/div.vlx"

expect "missing file" 1 error_code=FILE_NOT_FOUND -- "$VX" --format json project show -p "$TMP/missing.vlx"
printf '%s\n' '{' >"$TMP/bad.vlx"
expect "bad json" 1 error_code=INVALID_JSON -- "$VX" --format json project show -p "$TMP/bad.vlx"
expect "unknown board kind" 1 error_code=UNKNOWN_BOARD_KIND -- "$VX" --format json project init --board not-a-board -o "$TMP/nope.vlx"
expect "project init dry-run" 0 dry_run=true written=false -- "$VX" --format json project init --board arduino-uno -o "$TMP/dry.vlx" --dry-run
if [[ -e "$TMP/dry.vlx" ]]; then
  log "[fail][$LAYER] dry-run left a file"
  FAILED=$((FAILED + 1))
else
  log "[pass][$LAYER] dry-run does not write"
  PASSED=$((PASSED + 1))
fi

expect "project init uno" 0 ok=true -- "$VX" --format json project init --board arduino-uno -o "$TMP/uno.vlx"
expect "project init exists" 1 error_code=FILE_EXISTS -- "$VX" --format json project init --board arduino-uno -o "$TMP/uno.vlx"
expect "code set" 0 ok=true -- "$VX" --format json code set -p "$TMP/uno.vlx" --file sketch.ino --content 'void setup(){} void loop(){}'
expect "compile uno demo" 0 status=ok -- "$VX" --demo --format json compile -p "$TMP/uno.vlx"
expect "code list" 0 -- "$VX" --format json code list -p "$TMP/uno.vlx"
expect "code get" 0 -- "$VX" --format json code get -p "$TMP/uno.vlx" --file sketch.ino
expect "circuit add" 0 ok=true -- "$VX" --format json circuit add -p "$TMP/uno.vlx" --part led --id led1
expect "circuit wire" 0 ok=true -- "$VX" --format json circuit wire -p "$TMP/uno.vlx" --from arduino-uno:D13 --to led1:A
expect "circuit wire exists" 1 error_code=WIRE_EXISTS -- "$VX" --format json circuit wire -p "$TMP/uno.vlx" --from arduino-uno:D13 --to led1:A
expect "circuit add nan" 1 error_code=INVALID_COORDINATE -- "$VX" --format json circuit add -p "$TMP/uno.vlx" --part led --id lednan --x not-a-number
expect "circuit list" 0 -- "$VX" --format json circuit list -p "$TMP/uno.vlx"
expect "circuit unwire" 0 ok=true -- "$VX" --format json circuit unwire -p "$TMP/uno.vlx" --from arduino-uno:D13 --to led1:A
expect "circuit rm" 0 ok=true -- "$VX" --format json circuit rm -p "$TMP/uno.vlx" --id led1

cp "$ROOT/fixtures/two-board.vlx" "$TMP/two.vlx"
BEFORE=$(file_sha "$TMP/two.vlx")
expect "code set missing board" 1 error_code=BOARD_NOT_FOUND -- "$VX" --format json code set -p "$TMP/two.vlx" --board no-such --file sketch.ino --content '// x'
AFTER=$(file_sha "$TMP/two.vlx")
if [[ "$BEFORE" != "$AFTER" ]]; then
  log "[fail][$LAYER] missing board mutated file"
  FAILED=$((FAILED + 1))
else
  log "[pass][$LAYER] missing board leaves file bytes unchanged"
  PASSED=$((PASSED + 1))
fi
expect "code set esp32 only" 0 ok=true -- "$VX" --format json code set -p "$TMP/two.vlx" --board esp32 --file sketch.ino --content '// esp2'
expect "code get esp32" 0 -- "$VX" --format json code get -p "$TMP/two.vlx" --board esp32 --file sketch.ino
expect "code get uno unchanged" 0 -- "$VX" --format json code get -p "$TMP/two.vlx" --board arduino-uno --file sketch.ino

expect "project init kit" 0 -- "$VX" --format json project init --board esp32 -o "$TMP/kit.vlx"
expect "kit list" 0 -- "$VX" --format json kit list
expect "kit apply" 0 -- "$VX" --format json kit apply -p "$TMP/kit.vlx" --kit arm-3dof
expect "kit detect" 0 -- "$VX" --format json kit detect -p "$TMP/kit.vlx"
expect "vap list" 0 -- "$VX" --format json vap list
expect "vap show" 0 -- "$VX" --format json vap show vap-vision
expect "vap health demo" 0 mock=true -- "$VX" --demo --format json vap health
expect "studio columns arm" 0 auto=true -- "$VX" --format json studio columns --example esp32cam-ai-arm
expect "compile pi5 ready" 0 -- "$VX" --format json compile -p "$TMP/car.vlx"

expect "export pi5 button led" 0 ok=true -- "$VX" example export pi5-button-led -o "$TMP/pi5button.vlx"
expect "validate pi5 button led" 0 ok=true -- "$VX" circuit validate -p "$TMP/pi5button.vlx"
expect "compile pi5 button led ready" 0 status=ready -- "$VX" compile -p "$TMP/pi5button.vlx"

"$ROOT/scripts/draw-pi5-3dof-arm.sh" "$TMP/pi5arm.vlx" >/dev/null
expect "draw pi5-3dof-arm exists" 0 -- test -s "$TMP/pi5arm.vlx"
expect "circuit validate pi5-3dof-arm" 0 ok=true -- "$VX" --format json circuit validate -p "$TMP/pi5arm.vlx"
expect "compile pi5-3dof-arm ready" 0 -- "$VX" --format json compile -p "$TMP/pi5arm.vlx"
expect "studio columns pi5 arm" 0 columns.motion=true -- "$VX" --format json studio columns --example pi5-3dof-arm
expect "kit detect pi5 arm" 0 -- "$VX" --format json kit detect -p "$TMP/pi5arm.vlx"

"$ROOT/scripts/draw-ai-vision-arm.sh" "$TMP/arm.vlx" >/dev/null
expect "draw ai-vision-arm exists" 0 -- test -s "$TMP/arm.vlx"
expect "circuit validate arm" 0 ok=true -- "$VX" --format json circuit validate -p "$TMP/arm.vlx"
expect "compile arm demo" 0 status=ok -- "$VX" --demo --format json compile -p "$TMP/arm.vlx"

"$ROOT/scripts/draw-ai-chat-bot.sh" "$TMP/chat.vlx" >/dev/null
expect "draw ai-chat-bot exists" 0 -- test -s "$TMP/chat.vlx"
expect "example list ai-chat" 0 -- "$VX" --format json example list --query ai-chat
expect "circuit validate chat" 0 ok=true -- "$VX" --format json circuit validate -p "$TMP/chat.vlx"
expect "compile chat demo" 0 status=ok -- "$VX" --demo --format json compile -p "$TMP/chat.vlx"

"$ROOT/scripts/draw-speaker-agent.sh" "$TMP/speaker.vlx" >/dev/null
expect "draw speaker-agent exists" 0 -- test -s "$TMP/speaker.vlx"
expect "example list speaker-agent" 0 -- "$VX" --format json example list --query speaker-agent
expect "circuit validate speaker" 0 ok=true -- "$VX" --format json circuit validate -p "$TMP/speaker.vlx"
expect "compile speaker demo" 0 status=ok -- "$VX" --demo --format json compile -p "$TMP/speaker.vlx"

DRIVE='gpio=17:1,23:1,5:1,16:1,27:0,24:0,6:0,13:0'
expect "sim spice 4wd demo" 0 ok=true solved=false mode=fixture data_source=demo -- "$VX" --demo --format json sim spice -p "$TMP/car.vlx" --drive "$DRIVE" --assert 'current:m_fl>5mA' --assert 'current:m_rr>5mA'
expect "sim spice analog demo netlist" 0 ok=true solved=false mode=netlist-only -- "$VX" --demo --format json sim spice -p "$TMP/div.vlx"
expect "env mock skips live spice" 0 solved=false data_source=demo -- env VELXIO_MOCK_MODE=true "$VX" --format json sim spice -p "$TMP/div.vlx"
expect "sim qemu unavailable" 2 error_code=UNAVAILABLE -- "$VX" --demo --format json sim qemu

expect "compile connection refused" 2 error_code=CONNECTION_REFUSED -- env -u VELXIO_MOCK_MODE -u AI_MOCK_MODE "$VX" --api-url http://127.0.0.1:1 --timeout 2s --format json compile -p "$TMP/blink.vlx"

DM="$ROOT/../3Dm/bin/3dm"
if [[ -x "$DM" || -f "$DM" ]]; then
  expect "velxio 3dm kits" 0 -- "$VX" --format json 3dm kits
else
  skip "velxio 3dm 转发（无 3Dm/bin/3dm）"
fi

LAYER=spice-live
set +e
"$VX" --format json sim spice -p "$TMP/div.vlx" --assert 'voltage:vm>2V' >"$TMP/spice-live.json" 2>"$TMP/spice-live.err"
spice_ec=$?
set -e
{
  echo "---- sim spice analog live (exit $spice_ec) ----"
  cat "$TMP/spice-live.json"
  cat "$TMP/spice-live.err"
} >>"$LOG"
if [[ "$spice_ec" -eq 2 ]]; then
  skip "sim spice analog live (solver unavailable)"
elif [[ "$spice_ec" -eq 0 ]] && json_field "$TMP/spice-live.json" ok >/dev/null && [[ "$(json_field "$TMP/spice-live.json" ok)" == "true" ]] && [[ "$(json_field "$TMP/spice-live.json" solved)" == "true" ]]; then
  log "[pass][$LAYER] sim spice analog live"
  PASSED=$((PASSED + 1))
else
  log "[fail][$LAYER] sim spice analog live (exit $spice_ec)"
  FAILED=$((FAILED + 1))
fi

LAYER=compile-live
skip "真实编译未纳入默认无人值守门槛（见 CLI-07）"

LAYER=run-live
skip "sim run 尚未实现（CLI-06）"

log "[verify] passed=$PASSED failed=$FAILED skipped=$SKIPPED"
if [[ "$FAILED" -eq 0 ]]; then
  log "[verify] CLI 通过"
else
  log "[verify] CLI 失败"
  exit 1
fi
