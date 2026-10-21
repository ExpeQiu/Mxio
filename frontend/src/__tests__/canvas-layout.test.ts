import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('simulator canvas fill', () => {
  it('canvas 容器在横向 flex 里占满宽度', () => {
    const css = readFileSync(
      join(root, 'components/simulator/SimulatorCanvas.css'),
      'utf8',
    );
    const block = css.slice(
      css.indexOf('.simulator-canvas-container'),
      css.indexOf('.simulator-canvas {'),
    );
    expect(block).toMatch(/flex:\s*1/);
    expect(block).toMatch(/width:\s*100%/);
    expect(block).toMatch(/min-width:\s*0/);
  });

  it('EditorPage 给画布包一层 flex 填充', () => {
    const src = readFileSync(join(root, 'pages/EditorPage.tsx'), 'utf8');
    expect(src).toMatch(/flex:\s*'1 1 0%'/);
    expect(src).toMatch(/<SimulatorCanvas /);
  });
});
