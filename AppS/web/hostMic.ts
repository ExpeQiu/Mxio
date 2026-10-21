/**
 * 宿主麦克风会话：对话窗与遥控器 B 键共用，避免两路抢麦。
 */
import { vapLog } from './log';
import { startListen } from './speech';
import { useVapStore } from './useVapStore';

let stopListen: (() => void) | null = null;
let pending = '';

export function startHostMic(
  writeSerial: (line: string) => void,
  hint: (key: string) => string,
): void {
  if (!useVapStore.getState().peripherals.mic.bound) {
    useVapStore.getState().setSttHint(hint('editor.remote.micOff'));
    vapLog.info('stt_blocked', { extra: 'mic unbound' });
    return;
  }
  pending = '';
  useVapStore.getState().setHostListening(true);
  useVapStore.getState().setSttHint('');
  vapLog.info('stt_start', { state: useVapStore.getState().mcuState });
  const deviceId = useVapStore.getState().peripherals.mic.deviceId;
  stopListen = startListen({
    deviceId,
    onResult: (text, isFinal) => {
      pending = text;
      useVapStore.getState().setDraft(text);
      if (isFinal && text.trim()) {
        useVapStore.getState().setSttHint('');
        useVapStore.getState().sendUtter(text, writeSerial);
        pending = '';
      }
    },
    onError: (error) => {
      vapLog.warn('stt_error', { extra: error });
      if (error === 'empty' || error === 'whisper' || error === 'ffmpeg') {
        useVapStore.getState().setSttHint(hint('editor.canvas.chatSttEmpty'));
        return;
      }
      if (error === 'silence') {
        useVapStore.getState().setSttHint(hint('editor.canvas.chatSttSilence'));
        return;
      }
      if (error === 'not-allowed' || error === 'service-not-allowed' || error === 'no_stt') {
        useVapStore.getState().setSttHint(hint('editor.canvas.chatNoStt'));
        return;
      }
      useVapStore.getState().setSttHint(hint('editor.canvas.chatSttFail'));
    },
    onEnd: () => {
      const leftover = pending.trim();
      pending = '';
      if (leftover) useVapStore.getState().sendUtter(leftover, writeSerial);
      useVapStore.getState().setHostListening(false);
      stopListen = null;
    },
  });
}

export function stopHostMic(hint: (key: string) => string): void {
  if (!stopListen) return;
  useVapStore.getState().setSttHint(hint('editor.canvas.chatSttWait'));
  stopListen();
  stopListen = null;
  vapLog.info('stt_stop');
}

export function abortHostMic(): void {
  stopListen?.();
  stopListen = null;
}
