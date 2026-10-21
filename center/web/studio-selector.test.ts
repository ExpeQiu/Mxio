import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('StudioHost zustand snapshots', () => {
  it('does not map arrays inside useSimulatorStore selectors (getSnapshot must be stable)', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'StudioHost.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/useSimulatorStore\(\(s\) => s\.components\.map/);
    expect(src).toMatch(/useSimulatorStore\(\(s\) => s\.components\)/);
    expect(src).toMatch(/VirtualRemote/);
    expect(src).toMatch(/MotionKitBar/);
    expect(src).toMatch(/Motion3dPanel kitId/);
  });
});
