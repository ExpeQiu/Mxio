import { appsForExample } from '../../AppS/web/registry.ts';

/** 元件 type / metadataId 是否为执行器（舵机、电机）。 */
export function isMotionPart(typeOrMeta: string): boolean {
  const t = typeOrMeta.replace(/^(velxio-|wokwi-)/, '');
  return /^(servo|dc-motor|stepper)\b/.test(t) || t.includes('motor-driver');
}

export type CanvasActuatorKind = 'servo' | 'stepper' | 'dc-motor';

export interface CanvasActuator {
  id: string;
  kind: CanvasActuatorKind;
}

/** 可绑到关节的执行器；电机驱动板只用来展开运动栏，不参与装配。 */
export function kindFromPart(typeOrMeta: string): CanvasActuatorKind | null {
  const t = typeOrMeta.replace(/^(velxio-|wokwi-)/, '');
  if (/^servo\b/.test(t)) return 'servo';
  if (t.includes('stepper')) return 'stepper';
  if (/^dc-motor\b/.test(t)) return 'dc-motor';
  return null;
}

export function canvasActuators(
  components: readonly { id: string; metadataId: string }[],
): CanvasActuator[] {
  const out: CanvasActuator[] = [];
  for (const c of components) {
    const kind = kindFromPart(c.metadataId);
    if (kind) out.push({ id: c.id, kind });
  }
  return out;
}

export function hasMotionParts(partTypes: readonly string[]): boolean {
  return partTypes.some(isMotionPart);
}

export function hasAppLayer(exampleId: string | null | undefined): boolean {
  return appsForExample(exampleId).length > 0;
}

export interface StudioColumns {
  hardware: true;
  app: boolean;
  motion: boolean;
}

export function resolveStudioColumns(input: {
  exampleId: string | null | undefined;
  partTypes: readonly string[];
}): StudioColumns {
  return {
    hardware: true,
    app: hasAppLayer(input.exampleId),
    motion: hasMotionParts(input.partTypes),
  };
}

/** P2：同时有应用层与运动层才自动进综合视图。 */
export function shouldAutoStudio(
  exampleId: string | null | undefined,
  partTypes: readonly string[],
): boolean {
  const cols = resolveStudioColumns({ exampleId, partTypes });
  return cols.app && cols.motion;
}

export interface ColumnPercents {
  hw: number;
  app: number;
  motion: number;
}

export function columnPercents(cols: StudioColumns): ColumnPercents {
  if (cols.app && cols.motion) return { hw: 40, app: 30, motion: 30 };
  if (cols.app) return { hw: 58, app: 42, motion: 0 };
  if (cols.motion) return { hw: 58, app: 0, motion: 42 };
  return { hw: 100, app: 0, motion: 0 };
}

export function visibleColumnCount(cols: StudioColumns): number {
  return 1 + Number(cols.app) + Number(cols.motion);
}
