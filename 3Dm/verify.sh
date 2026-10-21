#!/usr/bin/env bash
# 3Dm P0–P3 离线验收（不依赖 MCU / QEMU）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -x node_modules/.bin/tsx ]]; then
  echo "[3dm] npm install…"
  npm install --ignore-scripts
fi

chmod +x bin/3dm
VX="$ROOT/bin/3dm"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
check() {
  local name="$1"
  shift
  if "$@"; then
    echo "[ok] $name"
  else
    echo "[fail] $name"
    fail=1
  fi
}

check "unit" bash -c "\"$ROOT/node_modules/.bin/vitest\" run --config \"$ROOT/vitest.config.ts\""
check "mechs" bash -c "\"$VX\" mechs | grep -q arm-3dof"
check "kits" bash -c "\"$VX\" kits | grep -q car-2wd"
check "kits quad" bash -c "\"$VX\" kits | grep -q quad-4dof"
check "kits humanoid" bash -c "\"$VX\" kits | grep -q humanoid-lite"
check "dump servo P0" bash -c "\"$VX\" dump --mech servo-sweep --duration 2000 | grep -q '\"qMax\"'"
check "dump arm P0" bash -c "\"$VX\" dump --mech 4dof-arm -o \"$TMP/traj.json\" | grep -q sv_base"
check "dump 3dof" bash -c "\"$VX\" dump --mech arm-3dof | grep -q sv_elbw"
check "traj file" test -s "$TMP/traj.json"
check "fk mid P2" bash -c "\"$VX\" fk --mech 4dof-arm --q 'sv_base=90,sv_shld=90,sv_elbw=90,sv_grip=70' | grep -q 0.22"
check "fk yaw P2" bash -c "\"$VX\" fk --mech 4dof-arm --q 'sv_base=180,sv_shld=90,sv_elbw=90,sv_grip=70' | grep -q 0.22"
check "fk 3dof" bash -c "\"$VX\" fk --mech arm-3dof --q 'sv_base=90,sv_shld=90,sv_elbw=90' | grep -q 0.12"
check "fk 2wd" bash -c "\"$VX\" fk --mech car-2wd --q 'm_l=90,m_r=0' | grep -q j_l"
check "detect arm" bash -c "\"$VX\" detect --ids sv_base,sv_shld | grep -q 4dof-arm"
check "detect 4wd" bash -c "\"$VX\" detect --ids m_fl,m_rr | grep -q 4wd-chassis"
check "detect 2wd" bash -c "\"$VX\" detect --ids m_l,m_r | grep -q car-2wd"
check "suggest missing" bash -c "\"$VX\" suggest --kit arm-3dof --ids sv_base,sv_shld | grep -q missing"
check "assemblies" bash -c "\"$VX\" assemblies --mech 4dof-arm | grep -q arm-swap-base-elbw"
check "assemble swap" bash -c "\"$VX\" assemble --mech 4dof-arm --assembly arm-swap-base-elbw | grep -q j_elbw"
check "fk swap 装配改运动" bash -c "\"$VX\" fk --mech 4dof-arm --assembly arm-swap-base-elbw --q 'sv_base=180,sv_shld=90,sv_elbw=90,sv_grip=70' | grep -q -- '-0.04'"
check "fk invert 装配改运动" bash -c "\"$VX\" fk --mech 4dof-arm --assembly arm-invert-base --q 'sv_base=180,sv_shld=90,sv_elbw=90,sv_grip=70' | grep -q -- '-0.22'"
check "bind inline" bash -c "\"$VX\" assemble --mech 4dof-arm --bind 'sv_base=j_elbw,sv_elbw=j_base,sv_shld=j_shld,sv_grip=j_grip' | grep -q sv_base"
check "fk quad" bash -c "\"$VX\" fk --mech quad-4dof --q 'sv_lf=0,sv_rf=0,sv_lr=0,sv_rr=0' | grep -q thigh_lf"
check "gen serial" bash -c "\"$VX\" generate --kind serial --n 5 | grep -q sv_j5"
check "gen quad8" bash -c "\"$VX\" generate --kind quadruped --legs 4 --dof 2 | grep -q j_knee_lf"
check "bom dog" bash -c "\"$VX\" bom --kit quad-4dof | grep -q sv_lf"

if [[ "$fail" -eq 0 ]]; then
  echo "[verify] 3Dm P0–P3 通过"
else
  echo "[verify] 3Dm 失败"
  exit 1
fi
