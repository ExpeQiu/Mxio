export type {
  ArmTelemetry,
  ChatLine,
  ChatMessage,
  McuChatState,
  VirtualAppManifest,
} from './types';
export {
  encodeLiveOff,
  encodeLiveOn,
  encodeSay,
  parseArmLine,
  parseChatLine,
  SerialChatParser,
} from './protocol';
export {
  appsForExample,
  hasVapChat,
  hasVapVision,
  VAP_CHAT,
  VAP_CHAT_ID,
  VAP_VISION,
  VAP_VISION_ID,
  VIRTUAL_APPS,
} from './registry';
export { DriveTrace } from './DriveTrace';
export { activeHops } from './drive';
export type { DriveHopId, VapBusEvent } from './drive';
export { VapHost } from './VapHost';
export { VirtualRemote } from './VirtualRemote';
export { useVapStore } from './useVapStore';
export { actionForKey, primaryKey } from './remoteKeys';
export { defaultPeripherals, shouldSpeak } from './peripherals';
