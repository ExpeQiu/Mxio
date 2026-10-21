import { describe, expect, it } from 'vitest';
import { loadKit } from '@3dm/core/kit';
import { draftsForMissing } from './applyBom';

describe('draftsForMissing', () => {
  it('三轴臂缺肘时落到画布草稿', () => {
    const drafts = draftsForMissing(
      loadKit('arm-3dof'),
      [
        { id: 'sv_base', kind: 'servo' },
        { id: 'sv_shld', kind: 'servo' },
      ],
      [
        { id: 'sv_base', x: 100, y: 80 },
        { id: 'sv_shld', x: 140, y: 80 },
      ],
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe('sv_elbw');
    expect(drafts[0].metadataId).toBe('servo');
    expect(drafts[0].x).toBeGreaterThan(140);
  });

  it('机器狗空画布补 4 个舵机', () => {
    const drafts = draftsForMissing(loadKit('quad-4dof'), [], []);
    expect(drafts.map((d) => d.id)).toEqual(['sv_lf', 'sv_rf', 'sv_lr', 'sv_rr']);
  });
});
