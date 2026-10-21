import { getApiBase } from '@velxio/lib/apiBase';
import { vapLog } from './log';

export interface VapLlmHealth {
  status: string;
  mock: boolean;
  has_upstream: boolean;
  has_key: boolean;
  guest_url: string;
  model: string;
}

export async function fetchVapHealth(): Promise<VapLlmHealth | null> {
  try {
    const resp = await fetch(`${getApiBase()}/vap/health`);
    if (!resp.ok) return null;
    return (await resp.json()) as VapLlmHealth;
  } catch (err) {
    vapLog.warn('llm_health_fail', { extra: err instanceof Error ? err.message : 'fetch' });
    return null;
  }
}

export async function completeChat(text: string): Promise<{ content: string; mock: boolean } | null> {
  try {
    const resp = await fetch(`${getApiBase()}/vap/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mock',
        messages: [{ role: 'user', content: text }],
      }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
      velxio?: { mock?: boolean };
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    vapLog.info('llm_host_rx', { extra: content.slice(0, 80), mock: data.velxio?.mock !== false });
    return { content, mock: data.velxio?.mock !== false };
  } catch (err) {
    vapLog.warn('llm_host_fail', { extra: err instanceof Error ? err.message : 'fetch' });
    return null;
  }
}

export async function transcribeAudio(blob: Blob): Promise<{ text: string; error?: string }> {
  if (blob.size < 80) {
    vapLog.warn('stt_host_skip', { extra: 'empty', bytes: blob.size });
    return { text: '', error: 'empty' };
  }
  try {
    const resp = await fetch(`${getApiBase()}/vap/stt`, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    });
    if (!resp.ok) return { text: '', error: 'http' };
    const data = (await resp.json()) as { text?: string; error?: string };
    const text = (data.text ?? '').trim();
    vapLog.info('stt_host_rx', { extra: text.slice(0, 80), bytes: blob.size, error: data.error });
    return { text, error: data.error };
  } catch (err) {
    vapLog.warn('stt_host_fail', { extra: err instanceof Error ? err.message : 'fetch' });
    return { text: '', error: 'fetch' };
  }
}
