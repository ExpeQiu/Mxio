/**
 * 遥控器按键 → 画布 pushbutton（与 useButtonKeyBindings 同一套 DOM 事件）。
 */
import { buildKeyBindingMap, normalizeKey } from '@velxio/utils/keyButtonBindings';
import { primaryKey, type RemoteActionId } from './remoteKeys';

interface Bindable {
  id: string;
  metadataId: string;
  properties: Record<string, unknown>;
}

function componentElement(componentId: string): Element | null {
  return document.querySelector(
    `[data-component-id="${componentId}"] .web-component-container > *`,
  );
}

export function dispatchRemoteToCanvas(
  action: RemoteActionId,
  type: 'button-press' | 'button-release',
  components: Bindable[],
): number {
  if (typeof document === 'undefined') return 0;
  const map = buildKeyBindingMap(components);
  const ids = map.get(normalizeKey(primaryKey(action))) ?? [];
  for (const id of ids) {
    componentElement(id)?.dispatchEvent(new Event(type));
  }
  return ids.length;
}
