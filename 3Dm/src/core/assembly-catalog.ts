import type { AssemblyDef } from './types.js';
import { builtinGenerated } from './generate.js';
import armDefault from '../../assemblies/arm-default.json';
import armSwap from '../../assemblies/arm-swap-base-elbw.json';
import armInvert from '../../assemblies/arm-invert-base.json';
import arm3dofDefault from '../../assemblies/arm-3dof-default.json';
import chassisDefault from '../../assemblies/4wd-default.json';
import car2wdDefault from '../../assemblies/car-2wd-default.json';

const ASSEMBLIES: Record<string, AssemblyDef> = {
  'arm-default': armDefault as AssemblyDef,
  'arm-swap-base-elbw': armSwap as AssemblyDef,
  'arm-invert-base': armInvert as AssemblyDef,
  'arm-3dof-default': arm3dofDefault as AssemblyDef,
  '4wd-default': chassisDefault as AssemblyDef,
  'car-2wd-default': car2wdDefault as AssemblyDef,
};

for (const g of builtinGenerated()) {
  ASSEMBLIES[g.assembly.id] = g.assembly;
}

export function registerAssembly(a: AssemblyDef): void {
  ASSEMBLIES[a.id] = a;
}

export function listAssemblyIds(mechId?: string): string[] {
  const ids = Object.keys(ASSEMBLIES);
  if (!mechId) return ids;
  return ids.filter((id) => ASSEMBLIES[id].mechanismId === mechId);
}

export function loadAssembly(id: string): AssemblyDef {
  const a = ASSEMBLIES[id];
  if (!a) throw new Error(`未知装配: ${id}`);
  return a;
}

export { ASSEMBLIES };
