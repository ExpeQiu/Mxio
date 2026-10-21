import { describe, expect, it } from 'vitest';
import { detectKitId, listKits, loadKit, suggestBinds } from '@3dm/core/kit';
import { canvasActuators } from './layout';

describe('Studio Kit 接线', () => {
  it('目录含三轴臂、两驱、机器狗、人形', () => {
    const ids = listKits().map((k) => k.id);
    expect(ids).toContain('arm-3dof');
    expect(ids).toContain('car-2wd');
    expect(ids).toContain('quad-4dof');
    expect(ids).toContain('humanoid-lite');
  });

  it('画布两个舵机选三轴臂会提示缺肘', () => {
    const actuators = canvasActuators([
      { id: 'sv_base', metadataId: 'velxio-servo' },
      { id: 'sv_shld', metadataId: 'velxio-servo' },
    ]);
    const r = suggestBinds(loadKit('arm-3dof'), actuators);
    expect(r.suggestions.find((s) => s.role === 'elbow')?.status).toBe('missing');
  });

  it('无名舵机按种类填入三轴臂', () => {
    expect(detectKitId(['servo-1', 'servo-2', 'servo-3'])).toBe('arm-3dof');
  });
  it('基座肩肘无夹爪识别为三轴臂', () => {
    expect(detectKitId(['sv_base', 'sv_shld', 'sv_elbw'])).toBe('arm-3dof');
  });
});
