import { missingBom, type CanvasActuator } from '../../3Dm/src/core/kit.ts';
import type { KitDef } from '../../3Dm/src/core/kit.ts';

export interface CanvasPartDraft {
  id: string;
  metadataId: string;
  x: number;
  y: number;
  properties: Record<string, unknown>;
}

/** 把 Kit 缺件编成画布元件草稿，只使用目录内 servo / dc-motor / stepper。 */
export function draftsForMissing(
  kit: KitDef,
  actuators: CanvasActuator[],
  existing: readonly { id: string; x: number; y: number }[],
): CanvasPartDraft[] {
  const parts = missingBom(
    kit,
    actuators,
    existing.map((e) => e.id),
  );
  const maxX = existing.reduce((m, c) => Math.max(m, c.x), 360);
  const minY = existing.reduce((m, c) => Math.min(m, c.y), 80);
  return parts.map((p, i) => ({
    id: p.id,
    metadataId: p.metadataId,
    x: maxX + 40 + (i % 4) * 48,
    y: minY + Math.floor(i / 4) * 56,
    properties:
      p.kind === 'servo'
        ? { horn: 'single', label: p.name }
        : p.kind === 'dc-motor'
          ? { value: '5', label: p.name }
          : { label: p.name },
  }));
}
