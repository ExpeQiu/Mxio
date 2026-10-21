import { transcribeAudio } from './llm';
import { vapLog } from './log';

export function canMic(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export function canStt(): boolean {
  return canMic();
}

export function canTts(): boolean {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
}

export function speak(text: string, lang = 'zh-CN'): void {
  if (!canTts() || !text.trim()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.trim());
  u.lang = lang;
  window.speechSynthesis.speak(u);
}

export function stopSpeak(): void {
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

const MIN_HOLD_MS = 1200;

/** 按住说话：只走本机 MediaRecorder，避免浏览器 SpeechRecognition 抢麦。 */
export function startListen(opts: {
  lang?: string;
  deviceId?: string | null;
  onResult: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}): () => void {
  let finished = false;
  let media: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  const chunks: Blob[] = [];
  let stopped = false;
  let startedAt = 0;
  const holdBegan = Date.now();

  const finish = (error?: string) => {
    if (finished) return;
    finished = true;
    if (error && error !== 'aborted' && error !== 'no-speech') {
      opts.onError?.(error);
    }
    opts.onEnd?.();
  };

  let stopping = false;
  const haltRecorder = () => {
    if (finished || stopping) return;
    if (media && media.state === 'recording') {
      stopping = true;
      media.stop();
      return;
    }
    if (!media) return;
    stream?.getTracks().forEach((t) => t.stop());
    finish('empty');
  };

  if (!canMic() || typeof MediaRecorder === 'undefined') {
    finish('no_stt');
    return () => undefined;
  }

  void navigator.mediaDevices
    .getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
        ...(opts.deviceId ? { deviceId: { exact: opts.deviceId } } : {}),
      },
    })
    .then((s) => {
      if (finished) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;
      const mime = pickMime();
      media = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
      media.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      media.onstop = () => {
        s.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: media?.mimeType || 'audio/webm' });
        vapLog.info('stt_blob', {
          bytes: blob.size,
          extra: media?.mimeType || '',
          held_ms: startedAt ? Date.now() - startedAt : 0,
        });
        void transcribeAudio(blob).then((res) => {
          const utter = res.text.trim();
          if (utter) opts.onResult(utter, true);
          finish(utter ? undefined : res.error || 'empty');
        });
      };
      media.start();
      startedAt = Date.now();
      vapLog.info('stt_rec_start', { extra: mime || 'default' });
    })
    .catch((err: unknown) => {
      const name = err instanceof Error ? err.name : 'mic';
      finish(stopped ? 'empty' : name);
    });

  return () => {
    stopped = true;
    const waitForStart = () => {
      if (finished) return;
      if (!startedAt) {
        if (Date.now() - holdBegan > 8000) {
          finish('empty');
          return;
        }
        window.setTimeout(waitForStart, 50);
        return;
      }
      window.setTimeout(haltRecorder, Math.max(0, MIN_HOLD_MS - (Date.now() - startedAt)));
    };
    waitForStart();
  };
}
