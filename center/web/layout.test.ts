import { describe, expect, it } from 'vitest';
import {
  canvasActuators,
  columnPercents,
  hasAppLayer,
  isMotionPart,
  kindFromPart,
  resolveStudioColumns,
  shouldAutoStudio,
  visibleColumnCount,
} from './layout';

describe('center layout', () => {
  it('detects servos and motors as motion parts', () => {
    expect(isMotionPart('velxio-servo')).toBe(true);
    expect(isMotionPart('wokwi-servo')).toBe(true);
    expect(isMotionPart('velxio-dc-motor')).toBe(true);
    expect(isMotionPart('velxio-motor-driver-l293d')).toBe(true);
    expect(isMotionPart('wokwi-led')).toBe(false);
    expect(isMotionPart('velxio-ssd1306')).toBe(false);
  });

  it('binds VAP examples to the app column', () => {
    expect(hasAppLayer('esp32-ai-chat')).toBe(true);
    expect(hasAppLayer('esp32cam-ai-arm')).toBe(true);
    expect(hasAppLayer('uno-blink')).toBe(false);
    expect(hasAppLayer(null)).toBe(false);
  });

  it('auto-opens studio only when app and motion coexist', () => {
    expect(shouldAutoStudio('esp32cam-ai-arm', ['velxio-servo', 'wokwi-led'])).toBe(true);
    expect(shouldAutoStudio('esp32-ai-chat', ['wokwi-ssd1306', 'wokwi-led'])).toBe(false);
    expect(shouldAutoStudio(null, ['velxio-servo'])).toBe(false);
    expect(shouldAutoStudio('esp32cam-ai-arm', ['wokwi-led'])).toBe(false);
  });

  it('extracts bindable actuators and skips motor drivers', () => {
    expect(kindFromPart('velxio-servo')).toBe('servo');
    expect(kindFromPart('velxio-dc-motor')).toBe('dc-motor');
    expect(kindFromPart('velxio-motor-driver-l293d')).toBe(null);
    expect(
      canvasActuators([
        { id: 'sv_base', metadataId: 'velxio-servo' },
        { id: 'drv', metadataId: 'velxio-motor-driver-l293d' },
        { id: 'led', metadataId: 'wokwi-led' },
      ]),
    ).toEqual([{ id: 'sv_base', kind: 'servo' }]);
  });

  it('collapses empty columns and sizes the rest', () => {
    const arm = resolveStudioColumns({
      exampleId: 'esp32cam-ai-arm',
      partTypes: ['velxio-servo'],
    });
    expect(arm).toEqual({ hardware: true, app: true, motion: true });
    expect(visibleColumnCount(arm)).toBe(3);
    expect(columnPercents(arm)).toEqual({ hw: 40, app: 30, motion: 30 });

    const chat = resolveStudioColumns({
      exampleId: 'esp32-ai-chat',
      partTypes: ['wokwi-led'],
    });
    expect(chat).toEqual({ hardware: true, app: true, motion: false });
    expect(columnPercents(chat)).toEqual({ hw: 58, app: 42, motion: 0 });

    const blink = resolveStudioColumns({ exampleId: null, partTypes: ['wokwi-led'] });
    expect(blink).toEqual({ hardware: true, app: false, motion: false });
    expect(columnPercents(blink)).toEqual({ hw: 100, app: 0, motion: 0 });
  });
});
