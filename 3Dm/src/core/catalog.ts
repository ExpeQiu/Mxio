import type { MechanismDef } from './types.js';
import { detectKitId } from './kit.js';
import { builtinGenerated } from './generate.js';
import servoSweep from '../../mechanisms/servo-sweep.json';
import arm3dof from '../../mechanisms/arm-3dof.json';
import arm4dof from '../../mechanisms/4dof-arm.json';
import car2wd from '../../mechanisms/car-2wd.json';
import chassis4wd from '../../mechanisms/4wd-chassis.json';

const CATALOG: Record<string, MechanismDef> = {
  'servo-sweep': servoSweep as MechanismDef,
  'arm-3dof': arm3dof as MechanismDef,
  '4dof-arm': arm4dof as MechanismDef,
  'car-2wd': car2wd as MechanismDef,
  '4wd-chassis': chassis4wd as MechanismDef,
};

const RUNTIME: Record<string, MechanismDef> = {};

for (const g of builtinGenerated()) {
  CATALOG[g.mechanism.id] = g.mechanism;
}

export function registerMechanism(mech: MechanismDef): void {
  RUNTIME[mech.id] = mech;
}

export function listMechanismIds(): string[] {
  return [...new Set([...Object.keys(CATALOG), ...Object.keys(RUNTIME)])];
}

export function loadMechanism(id: string): MechanismDef {
  const mech = RUNTIME[id] ?? CATALOG[id];
  if (!mech) throw new Error(`未知机构: ${id}`);
  return mech;
}

export function detectMechanismId(componentIds: string[]): string {
  return detectKitId(componentIds);
}

export { CATALOG };
