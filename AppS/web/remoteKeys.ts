/**
 * 虚拟遥控器键位：方向键 / A·B / 1·2·3 外设。
 * 与画布 pushbutton 的 `key` 绑定共用 normalizeKey，点击遥控也能打到电路按钮。
 */
import { formatKeyLabel, isModifierKey, normalizeKey } from '@velxio/utils/keyButtonBindings';

export type RemotePadId = 'up' | 'down' | 'left' | 'right' | 'a' | 'b';
export type RemotePeriphId = 'camera' | 'mic' | 'speaker';
export type RemoteActionId = RemotePadId | RemotePeriphId;

export const PAD_KEYS: Record<RemotePadId, readonly string[]> = {
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  a: ['z', 'Enter'],
  b: ['x', ' '],
};

export const PERIPH_KEYS: Record<RemotePeriphId, readonly string[]> = {
  camera: ['1'],
  mic: ['2'],
  speaker: ['3'],
};

const ALL: Record<RemoteActionId, readonly string[]> = { ...PAD_KEYS, ...PERIPH_KEYS };

export function isPad(id: RemoteActionId): id is RemotePadId {
  return id in PAD_KEYS;
}

export function isPeriph(id: RemoteActionId): id is RemotePeriphId {
  return id in PERIPH_KEYS;
}

export function actionForKey(key: string): RemoteActionId | null {
  const n = normalizeKey(key);
  for (const [id, keys] of Object.entries(ALL) as [RemoteActionId, readonly string[]][]) {
    if (keys.includes(n)) return id;
  }
  return null;
}

/** 画布按键绑定用的主键（ArrowUp / z / 1 …）。 */
export function primaryKey(id: RemoteActionId): string {
  return ALL[id][0];
}

export function keyCaption(id: RemoteActionId): string {
  return formatKeyLabel(primaryKey(id));
}

export { formatKeyLabel, isModifierKey, normalizeKey };

export function isRemoteTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) {
    return true;
  }
  return typeof el.closest === 'function' && el.closest('.monaco-editor') !== null;
}
