import type { VirtualAppManifest } from './types';

export const VAP_CHAT_ID = 'vap-chat';
export const VAP_VISION_ID = 'vap-vision';

export const VAP_CHAT: VirtualAppManifest = {
  id: VAP_CHAT_ID,
  title: '对话',
  bind: 'uart0',
  capabilities: ['stt', 'tts', 'llm'],
  exampleIds: ['esp32-ai-chat'],
};

export const VAP_VISION: VirtualAppManifest = {
  id: VAP_VISION_ID,
  title: '视觉',
  bind: 'camera',
  capabilities: ['camera'],
  exampleIds: ['esp32cam-ai-arm'],
};

export const VIRTUAL_APPS: VirtualAppManifest[] = [VAP_CHAT, VAP_VISION];

export function appsForExample(exampleId: string | null | undefined): VirtualAppManifest[] {
  if (!exampleId) return [];
  return VIRTUAL_APPS.filter((app) => app.exampleIds.includes(exampleId));
}

export function hasVapChat(exampleId: string | null | undefined): boolean {
  return appsForExample(exampleId).some((app) => app.id === VAP_CHAT_ID);
}

export function hasVapVision(exampleId: string | null | undefined): boolean {
  return appsForExample(exampleId).some((app) => app.id === VAP_VISION_ID);
}
