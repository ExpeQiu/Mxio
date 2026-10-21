import { create } from 'zustand';
import { completeChat } from './llm';
import { vapLog } from './log';
import {
  encodeLiveOff,
  encodeLiveOn,
  encodeSay,
  isTransportFail,
  parseArmLine,
  parseChatLine,
  SerialLineParser,
} from './protocol';
import { appsForExample, VAP_CHAT_ID, VAP_VISION_ID } from './registry';
import { defaultPeripherals, shouldSpeak, type PeripheralBind, type PeripheralKind } from './peripherals';
import type { RemoteActionId } from './remoteKeys';
import { speak as speakRaw } from './speech';
import type { VapBusEvent } from './drive';
import type { ArmTelemetry, ChatMessage, McuChatState, VapWindowState } from './types';

function speak(text: string): void {
  if (!shouldSpeak(useVapStore.getState().peripherals.speaker.bound, text)) return;
  speakRaw(text);
}

const parser = new SerialLineParser();
let msgSeq = 0;
let lastSpeakTurn = -1;
let lastUserText = '';

function nextId(): string {
  msgSeq += 1;
  return `vap-${msgSeq}`;
}

function defaultWindow(open: boolean): VapWindowState {
  return { open, userClosed: false, pos: { x: -1, y: 52 } };
}

function emptyArm(): ArmTelemetry {
  return {
    face: false,
    cx: 80,
    cy: 60,
    n: 0,
    errX: 0,
    errY: 0,
    base: 90,
    shld: 90,
    elbw: 90,
    grip: 70,
    lost: 0,
    decode: false,
    bytes: 0,
  };
}

interface VapState {
  windows: Record<string, VapWindowState>;
  messages: ChatMessage[];
  mcuState: McuChatState;
  mock: boolean;
  turnId: number;
  hostListening: boolean;
  draft: string;
  sttHint: string;
  boundExampleId: string | null;
  gatewayMock: boolean | null;
  arm: ArmTelemetry;
  lastBus: VapBusEvent | null;
  docked: boolean;
  pressed: Partial<Record<RemoteActionId, boolean>>;
  peripherals: Record<PeripheralKind, PeripheralBind>;
  isOpen: (id: string) => boolean;
  toggle: (id?: string) => void;
  setOpen: (id: string, open: boolean, reason?: 'user' | 'auto') => void;
  setPos: (id: string, pos: { x: number; y: number }) => void;
  setDraft: (draft: string) => void;
  setHostListening: (v: boolean) => void;
  setSttHint: (hint: string) => void;
  setGatewayMock: (v: boolean | null) => void;
  setDocked: (v: boolean) => void;
  setPressed: (id: RemoteActionId, down: boolean) => void;
  setPeripheral: (kind: PeripheralKind, next: PeripheralBind) => void;
  syncExample: (exampleId: string | null) => void;
  ingestSerial: (output: string) => void;
  sendUtter: (text: string, writeSerial: (line: string) => void) => void;
  setFirmwareLive: (live: boolean, writeSerial: (line: string) => void) => void;
  resetSession: () => void;
}

function resetParserAndSpeak(): void {
  parser.reset();
  lastSpeakTurn = -1;
  lastUserText = '';
}

export const useVapStore = create<VapState>((set, get) => ({
  windows: {},
  messages: [],
  mcuState: 'IDLE',
  mock: true,
  turnId: 0,
  hostListening: false,
  draft: '',
  sttHint: '',
  boundExampleId: null,
  gatewayMock: null,
  arm: emptyArm(),
  lastBus: null,
  docked: false,
  pressed: {},
  peripherals: defaultPeripherals(),

  isOpen: (id) => Boolean(get().windows[id]?.open),

  toggle: (id = VAP_CHAT_ID) => {
    const next = !get().isOpen(id);
    get().setOpen(id, next, 'user');
  },

  setOpen: (id, open, reason = 'user') => {
    set((s) => {
      const prev = s.windows[id] ?? defaultWindow(false);
      return {
        windows: {
          ...s.windows,
          [id]: {
            ...prev,
            open,
            userClosed: reason === 'user' ? !open : prev.userClosed,
          },
        },
      };
    });
    vapLog.info(open ? 'window_open' : 'window_close', {
      app_id: id,
      example_id: get().boundExampleId,
      reason,
    });
  },

  setPos: (id, pos) => {
    set((s) => {
      const prev = s.windows[id] ?? defaultWindow(false);
      return { windows: { ...s.windows, [id]: { ...prev, pos } } };
    });
  },

  setDraft: (draft) => set({ draft }),
  setHostListening: (hostListening) => set({ hostListening }),
  setSttHint: (sttHint) => set({ sttHint }),
  setGatewayMock: (gatewayMock) => set({ gatewayMock }),
  setDocked: (docked) => set({ docked }),
  setPressed: (id, down) =>
    set((s) => ({ pressed: { ...s.pressed, [id]: down } })),
  setPeripheral: (kind, next) =>
    set((s) => ({ peripherals: { ...s.peripherals, [kind]: next } })),

  syncExample: (exampleId) => {
    const prev = get().boundExampleId;
    const apps = appsForExample(exampleId);
    if (prev === exampleId) {
      for (const app of apps) {
        const win = get().windows[app.id];
        if (win && !win.open && !win.userClosed) {
          get().setOpen(app.id, true, 'auto');
        }
      }
      return;
    }
    resetParserAndSpeak();
    const windows: Record<string, VapWindowState> = {};
    for (const app of apps) {
      windows[app.id] = defaultWindow(true);
    }
    const hasVision = apps.some((a) => a.id === VAP_VISION_ID);
    set({
      boundExampleId: exampleId,
      windows,
      messages: [],
      mcuState: 'IDLE',
      mock: true,
      turnId: 0,
      draft: '',
      sttHint: '',
      hostListening: false,
      arm: emptyArm(),
      lastBus: null,
      pressed: {},
      peripherals: defaultPeripherals({ camera: hasVision }),
    });
    for (const app of apps) {
      vapLog.info('auto_open', { app_id: app.id, example_id: exampleId });
    }
  },

  ingestSerial: (output) => {
    const { lines, reset } = parser.push(output);
    if (reset) {
      lastSpeakTurn = -1;
    }
    if (!reset && lines.length === 0) return;
    const fallbacks: { turnId: number; text: string }[] = [];
    set((s) => {
      let { mcuState, mock, turnId, messages, arm, lastBus } = s;
      if (reset) {
        mcuState = 'IDLE';
        messages = [];
        turnId = 0;
        arm = emptyArm();
        lastBus = null;
      }
      const added: ChatMessage[] = [];
      for (const raw of lines) {
        const chat = parseChatLine(raw);
        if (chat) {
          mock = chat.mock;
          turnId = chat.turnId;
          if (chat.state) mcuState = chat.state;
          vapLog.info('serial_rx', {
            app_id: VAP_CHAT_ID,
            turn_id: chat.turnId,
            state: chat.state ?? mcuState,
            mock: chat.mock,
            extra: chat.extra.slice(0, 80),
          });
          lastBus = {
            dir: 'rx',
            text: chat.raw.slice(0, 80),
            ts: Date.now(),
          };
          if (chat.state === 'SPEAK' && chat.extra && chat.turnId !== lastSpeakTurn) {
            lastSpeakTurn = chat.turnId;
            added.push({
              id: nextId(),
              role: 'assistant',
              text: chat.extra,
              turnId: chat.turnId,
              ts: Date.now(),
            });
            if (!chat.mock && isTransportFail(chat.extra) && lastUserText) {
              fallbacks.push({ turnId: chat.turnId, text: lastUserText });
            } else {
              try {
                speak(chat.extra);
              } catch {
                /* TTS 失败不影响对话 */
              }
            }
          }
        }
        const nextArm = parseArmLine(raw);
        if (nextArm) {
          arm = nextArm;
          vapLog.info('serial_rx', {
            app_id: VAP_VISION_ID,
            extra: `face=${nextArm.face ? 1 : 0} base=${nextArm.base} shld=${nextArm.shld}`,
          });
        }
      }
      return {
        mcuState,
        mock,
        turnId,
        arm,
        lastBus,
        messages: added.length ? [...messages, ...added] : messages,
      };
    });
    for (const job of fallbacks) {
      void completeChat(job.text).then((res) => {
        if (!res?.content) return;
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: nextId(),
              role: 'assistant',
              text: res.content,
              turnId: job.turnId,
              ts: Date.now(),
            },
          ],
        }));
        try {
          speak(res.content);
        } catch {
          /* ignore */
        }
      });
    }
  },

  sendUtter: (text, writeSerial) => {
    const utter = text.replace(/\s+/g, ' ').trim();
    if (!utter) return;
    lastUserText = utter;
    const turnId = get().turnId;
    const msg: ChatMessage = {
      id: nextId(),
      role: 'user',
      text: utter,
      turnId,
      ts: Date.now(),
    };
    const line = encodeSay(utter);
    set((s) => ({
      messages: [...s.messages, msg],
      draft: '',
      mcuState: 'THINK',
      lastBus: { dir: 'tx', text: line.trim(), ts: Date.now() },
    }));
    vapLog.info('serial_tx', { app_id: VAP_CHAT_ID, turn_id: turnId, extra: utter.slice(0, 80) });
    writeSerial(line);
  },

  setFirmwareLive: (live, writeSerial) => {
    if (live) {
      for (const line of encodeLiveOn()) writeSerial(line);
      vapLog.info('mode_live', { app_id: VAP_CHAT_ID });
    } else {
      writeSerial(encodeLiveOff());
      vapLog.info('mode_mock', { app_id: VAP_CHAT_ID });
    }
  },

  resetSession: () => {
    resetParserAndSpeak();
    set({
      messages: [],
      mcuState: 'IDLE',
      turnId: 0,
      draft: '',
      hostListening: false,
      arm: emptyArm(),
      lastBus: null,
    });
  },
}));
