export type McuChatState = 'IDLE' | 'LISTEN' | 'THINK' | 'SPEAK';

export type VapCapability = 'stt' | 'tts' | 'llm' | 'camera';

export type VapBind = 'uart0' | 'camera';

export interface VirtualAppManifest {
  id: string;
  title: string;
  bind: VapBind;
  capabilities: VapCapability[];
  exampleIds: string[];
}

export interface ChatLine {
  turnId: number;
  mock: boolean;
  state?: McuChatState;
  extra: string;
  raw: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  turnId: number;
  ts: number;
}

export interface VapWindowState {
  open: boolean;
  userClosed: boolean;
  pos: { x: number; y: number };
}

export interface ArmTelemetry {
  face: boolean;
  cx: number;
  cy: number;
  n: number;
  errX: number;
  errY: number;
  base: number;
  shld: number;
  elbw: number;
  grip: number;
  lost: number;
  decode: boolean;
  bytes: number;
}
