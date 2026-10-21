import type { McuChatState } from './types';

export type DriveHopId =
  | 'window'
  | 'stt'
  | 'bridge'
  | 'uart'
  | 'idle'
  | 'listen'
  | 'think'
  | 'speak'
  | 'oled'
  | 'buzzer'
  | 'led'
  | 'speaker';

export interface VapBusEvent {
  dir: 'tx' | 'rx';
  text: string;
  ts: number;
}

export interface DriveSnapshot {
  listening: boolean;
  state: McuChatState;
  lastBus: VapBusEvent | null;
  now?: number;
}

const BUS_FRESH_MS = 4000;

function busFresh(bus: VapBusEvent | null, now: number): boolean {
  return Boolean(bus && now - bus.ts < BUS_FRESH_MS);
}

/** 根据窗口/固件状态标出软件→UART→固件→外设当前 hop。 */
export function activeHops(snap: DriveSnapshot): Set<DriveHopId> {
  const now = snap.now ?? Date.now();
  const hops = new Set<DriveHopId>();
  const busOn = busFresh(snap.lastBus, now);

  hops.add('window');
  if (snap.listening) {
    hops.add('stt');
    hops.add('listen');
  }
  if (busOn && snap.lastBus?.dir === 'tx') {
    hops.add('bridge');
    hops.add('uart');
  }
  if (busOn && snap.lastBus?.dir === 'rx') {
    hops.add('uart');
  }

  if (snap.state === 'LISTEN') {
    hops.add('listen');
  } else if (snap.state === 'THINK') {
    hops.add('bridge');
    hops.add('uart');
    hops.add('think');
    hops.add('led');
  } else if (snap.state === 'SPEAK') {
    hops.add('speak');
    hops.add('oled');
    hops.add('buzzer');
    hops.add('speaker');
    hops.add('uart');
  } else {
    hops.add('idle');
  }

  return hops;
}
