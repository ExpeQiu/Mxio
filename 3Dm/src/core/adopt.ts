import { registerAssembly } from './assembly-catalog.js';
import { registerMechanism } from './catalog.js';
import type { GeneratedKit } from './generate.js';
import { registerKit } from './kit.js';

export function adoptGenerated(g: GeneratedKit): void {
  registerMechanism(g.mechanism);
  registerAssembly(g.assembly);
  registerKit(g.kit);
}
