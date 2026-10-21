/**
 * Pro board-gate registry.
 *
 * STM32 and the QEMU-backed Raspberry Pi family are Pro-only emulation
 * features. The OSS app knows *which* boards are Pro (public information —
 * `isProBoardKind`) and renders a PRO badge for them, but it does NOT know
 * the current user's entitlement. The pro overlay installs the real gate via
 * `installBoardGateImpl`, deciding whether a given add/run is allowed for the
 * signed-in user on the web.
 *
 * Mirrors the other OSS->Pro seams (`proSaveAction.ts`, `proSession.ts`,
 * `proRoutes.ts`): the OSS app defines a stable doorbell; the overlay plugs in.
 *
 *   - OSS without an overlay  -> default impl returns 'allow'. Self-hosted
 *     deployments don't block in the UI; the missing emulation binary plus a
 *     Pro-framed backend message handle availability (see stm32_lib_manager /
 *     the Pi boot-image provider).
 *   - With the pro overlay     -> installBoardGateImpl() returns 'block' for a
 *     non-paid user on the web, and the caller fires the upgrade prompt.
 *   - Desktop (Tauri)          -> overlay returns 'allow'; the per-board QEMU
 *     download prompt (Stm32QemuPrompt / RaspberryPiQemuPrompt) handles it.
 */

import type { BoardKind } from '../types/board';
import { isPiBoardKind, isStm32BoardKind } from '../types/board';

export type BoardGateDecision = 'allow' | 'block';

/**
 * Hosted overlay build (velxio.dev). OSS self-host is always unlocked —
 * the picker must not paint a paid PRO pill or ONLINE ads that bounce to
 * velxio.com. Compile-time: `VITE_PRO_BUILD` is inlined by Vite.
 */
export const PRO_COMMERCIAL_UI = Boolean(import.meta.env.VITE_PRO_BUILD);

/**
 * Static, public predicate: which board kinds are Pro emulation features.
 * Used for the PRO badge (hosted overlay only) and as the precondition the
 * overlay's gate checks. STM32 (libqemu-arm) + every QEMU Raspberry Pi
 * (Zero/1/2/3/4/5; excludes the Pico, which is browser emulation).
 */
export function isProBoardKind(kind: BoardKind | string): boolean {
  return isStm32BoardKind(kind) || isPiBoardKind(kind);
}

/** Gold PRO pill: only when the overlay can actually gate unpaid users. */
export function shouldShowProBadge(kind: BoardKind | string): boolean {
  return PRO_COMMERCIAL_UI && isProBoardKind(kind);
}

type BoardGateImpl = (kind: BoardKind) => BoardGateDecision;

let _impl: BoardGateImpl | null = null;

/** Installed by the pro overlay (mountPro). Pass null to clear (hot reload). */
export function installBoardGateImpl(impl: BoardGateImpl | null): void {
  _impl = impl;
}

/** Whether the pro overlay has installed a gate (else OSS default applies). */
export function hasBoardGateImpl(): boolean {
  return _impl !== null;
}

/**
 * Decide whether adding/running a board of `kind` is allowed for the current
 * user. Non-Pro boards are always allowed. For Pro boards, the overlay's impl
 * decides; with no overlay the OSS default is 'allow'.
 */
export function boardGateDecision(kind: BoardKind): BoardGateDecision {
  void kind;
  void _impl;
  return 'allow';
}

/**
 * Fire the Pro upgrade prompt. Dispatches the same CustomEvent the pro
 * overlay's UpgradeGate listens for (`PRO_UPGRADE_EVENT` in
 * proComponentInjector.ts). The event name is the stable contract — the OSS
 * app does not import from the overlay.
 */
const PRO_UPGRADE_EVENT = 'velxio-pro-upgrade-prompt';

export function triggerProUpgradePrompt(featureName: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(PRO_UPGRADE_EVENT, { detail: { componentName: featureName } }),
  );
}

/** Human label for the upgrade prompt, per board family. */
export function proBoardFeatureName(kind: BoardKind | string): string {
  if (isStm32BoardKind(kind)) return 'STM32 emulation';
  if (isPiBoardKind(kind)) return 'Raspberry Pi emulation';
  return 'this board';
}
