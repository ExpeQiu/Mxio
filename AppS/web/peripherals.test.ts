import { describe, expect, it } from 'vitest';
import {
  applyDeny,
  applyGrant,
  applyOff,
  defaultPeripherals,
  devicesOfKind,
  emptyBind,
  shouldSpeak,
} from './peripherals';

describe('peripheral bind', () => {
  it('defaults mic+speaker on, camera optional', () => {
    const chat = defaultPeripherals();
    expect(chat.camera.bound).toBe(false);
    expect(chat.mic.bound).toBe(true);
    expect(chat.speaker.bound).toBe(true);
    expect(defaultPeripherals({ camera: true }).camera.bound).toBe(true);
  });

  it('grants, denies, and turns off without dropping the last label on off', () => {
    const on = applyGrant('dev-1', 'FaceTime HD');
    expect(on).toMatchObject({ bound: true, status: 'on', deviceId: 'dev-1' });
    const off = applyOff(on);
    expect(off.bound).toBe(false);
    expect(off.label).toBe('FaceTime HD');
    expect(applyDeny('Permission denied', true).status).toBe('denied');
    expect(emptyBind().status).toBe('idle');
  });

  it('filters device lists and gates TTS', () => {
    const list = [
      { deviceId: 'c1', kind: 'videoinput' as const, label: 'Cam' },
      { deviceId: 'm1', kind: 'audioinput' as const, label: 'Mic' },
      { deviceId: 's1', kind: 'audiooutput' as const, label: 'Spk' },
      { deviceId: '', kind: 'audioinput' as const, label: 'ghost' },
    ];
    expect(devicesOfKind(list, 'camera').map((d) => d.deviceId)).toEqual(['c1']);
    expect(devicesOfKind(list, 'mic')).toHaveLength(1);
    expect(shouldSpeak(true, '你好')).toBe(true);
    expect(shouldSpeak(false, '你好')).toBe(false);
    expect(shouldSpeak(true, '  ')).toBe(false);
  });
});
