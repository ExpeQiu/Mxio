import { describe, it, expect, beforeEach } from 'vitest';
import {
  appsForExample,
  hasVapChat,
  hasVapVision,
  VAP_CHAT_ID,
  VAP_VISION_ID,
} from '@apps/registry';
import { useVapStore } from '@apps/useVapStore';

describe('vap registry', () => {
  it('binds chat and vision to their examples', () => {
    expect(hasVapChat('esp32-ai-chat')).toBe(true);
    expect(appsForExample('esp32-ai-chat')[0]?.id).toBe(VAP_CHAT_ID);
    expect(hasVapVision('esp32cam-ai-arm')).toBe(true);
    expect(appsForExample('esp32cam-ai-arm')[0]?.id).toBe(VAP_VISION_ID);
    expect(hasVapChat('esp32cam-ai-arm')).toBe(false);
    expect(appsForExample(null)).toEqual([]);
  });
});

describe('vap store ingest', () => {
  beforeEach(() => {
    useVapStore.getState().resetSession();
    useVapStore.setState({
      windows: {},
      messages: [],
      mcuState: 'IDLE',
      mock: true,
      turnId: 0,
      boundExampleId: null,
    });
  });

  it('auto-opens the matching window', () => {
    useVapStore.getState().syncExample('esp32-ai-chat');
    expect(useVapStore.getState().isOpen(VAP_CHAT_ID)).toBe(true);
    expect(useVapStore.getState().peripherals.camera.bound).toBe(false);
    expect(useVapStore.getState().peripherals.mic.bound).toBe(true);
    useVapStore.getState().setOpen(VAP_CHAT_ID, false, 'user');
    expect(useVapStore.getState().windows[VAP_CHAT_ID]?.userClosed).toBe(true);
    useVapStore.getState().syncExample('esp32cam-ai-arm');
    expect(useVapStore.getState().isOpen(VAP_CHAT_ID)).toBe(false);
    expect(useVapStore.getState().isOpen(VAP_VISION_ID)).toBe(true);
    expect(useVapStore.getState().peripherals.camera.bound).toBe(true);
  });

  it('turns SPEAK serial into an assistant bubble and SAY into UART', () => {
    const sent: string[] = [];
    useVapStore.getState().sendUtter('你好', (line) => sent.push(line));
    expect(sent).toEqual(['SAY 你好\n']);
    expect(useVapStore.getState().messages[0]).toMatchObject({ role: 'user', text: '你好' });

    useVapStore
      .getState()
      .ingestSerial('[chat] turn_id=1 state=SPEAK mock=1 你好，我是 Velxio 对话机器人。\n');
    const { messages, mcuState, mock } = useVapStore.getState();
    expect(mcuState).toBe('SPEAK');
    expect(mock).toBe(true);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1].text).toContain('Velxio');
  });

  it('parses arm serial into telemetry and sends MODE live', () => {
    useVapStore
      .getState()
      .ingestSerial(
        '[arm] face=1 cx=90 cy=50 n=120 err=10,-10 base=95 shld=88 elbw=91 grip=20 bytes=4096\n',
      );
    expect(useVapStore.getState().arm).toMatchObject({ face: true, base: 95, grip: 20 });
    const sent: string[] = [];
    useVapStore.getState().setFirmwareLive(true, (line) => sent.push(line));
    expect(sent[0]).toMatch(/^URL http:\/\/192\.168\.4\.2\//);
    expect(sent[1]).toBe('MODE live\n');
  });
});
