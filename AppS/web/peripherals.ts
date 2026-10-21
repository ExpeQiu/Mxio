/** 虚拟遥控器外设绑定：本机摄像头 / 麦克风 / 喇叭。 */

export type PeripheralKind = 'camera' | 'mic' | 'speaker';
export type PeripheralStatus = 'idle' | 'requesting' | 'on' | 'denied' | 'error';

export interface PeripheralBind {
  bound: boolean;
  deviceId: string | null;
  label: string;
  status: PeripheralStatus;
  error?: string;
}

export interface MediaDeviceLite {
  deviceId: string;
  kind: 'videoinput' | 'audioinput' | 'audiooutput';
  label: string;
}

export function emptyBind(): PeripheralBind {
  return { bound: false, deviceId: null, label: '', status: 'idle' };
}

export function defaultPeripherals(opts?: { camera?: boolean }): Record<PeripheralKind, PeripheralBind> {
  return {
    camera: opts?.camera ? { bound: true, deviceId: null, label: '', status: 'idle' } : emptyBind(),
    mic: { bound: true, deviceId: null, label: '', status: 'idle' },
    speaker: { bound: true, deviceId: null, label: '', status: 'idle' },
  };
}

export function applyGrant(
  deviceId: string,
  label: string,
): PeripheralBind {
  return { bound: true, deviceId: deviceId || null, label, status: 'on' };
}

export function applyDeny(error: string, denied: boolean): PeripheralBind {
  return {
    bound: false,
    deviceId: null,
    label: '',
    status: denied ? 'denied' : 'error',
    error,
  };
}

export function applyOff(prev: PeripheralBind): PeripheralBind {
  return {
    bound: false,
    deviceId: prev.deviceId,
    label: prev.label,
    status: 'idle',
  };
}

const KIND_TO_MEDIA: Record<PeripheralKind, MediaDeviceLite['kind']> = {
  camera: 'videoinput',
  mic: 'audioinput',
  speaker: 'audiooutput',
};

export function devicesOfKind(list: MediaDeviceLite[], kind: PeripheralKind): MediaDeviceLite[] {
  const want = KIND_TO_MEDIA[kind];
  return list.filter((d) => d.kind === want && d.deviceId);
}

export function shouldSpeak(speakerBound: boolean, text: string): boolean {
  return speakerBound && Boolean(text.trim());
}

export function deviceErrorName(err: unknown): { denied: boolean; message: string } {
  const name = err instanceof Error ? err.name : 'error';
  const message = err instanceof Error ? err.message : String(err);
  return { denied: name === 'NotAllowedError' || name === 'PermissionDeniedError', message };
}
