import { detectKitId, listKits, loadKit } from '../../../3Dm/src/core/kit.ts';
import { detectMechanismId } from '../../../3Dm/src/core/catalog.ts';
import { draftsForMissing } from '../../../center/web/applyBom.ts';
import { canvasActuators } from '../../../center/web/layout.ts';
import { findPart } from '../catalog/index.js';
import { logInfo } from '../output.js';
import type { VlxPayload } from '../../../frontend/src/utils/vlxCore.ts';

export function kitListItems(): Array<{
  id: string;
  name: string;
  mechanismId: string;
  assemblyId: string;
  roles: string[];
}> {
  return listKits().map((k) => ({
    id: k.id,
    name: k.name,
    mechanismId: k.mechanismId,
    assemblyId: k.assemblyId,
    roles: k.roles.map((r) => r.role),
  }));
}

export function detectFromVlx(payload: VlxPayload): { id: string; kit: string; ids: string[] } {
  const ids = payload.components.map((c) => c.id);
  return { id: detectMechanismId(ids), kit: detectKitId(ids), ids };
}

export function applyKitToVlx(payload: VlxPayload, kitId: string): { added: string[]; kit: string } {
  const kit = loadKit(kitId);
  const actuators = canvasActuators(payload.components);
  const drafts = draftsForMissing(kit, actuators, payload.components);
  const existing = new Set([
    ...payload.components.map((c) => c.id),
    ...payload.boards.map((b) => b.id),
  ]);
  const added: string[] = [];
  for (const d of drafts) {
    if (existing.has(d.id) || d.id.includes('-')) continue;
    const part = findPart(d.metadataId);
    payload.components.push({
      id: d.id,
      metadataId: d.metadataId,
      x: d.x,
      y: d.y,
      properties: { ...(part?.defaultValues ?? {}), ...d.properties },
    });
    existing.add(d.id);
    added.push(d.id);
  }
  logInfo('kit.apply', { kit: kit.id, added, count: added.length });
  return { added, kit: kit.id };
}
