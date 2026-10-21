import type { ArmTelemetry, ChatLine, McuChatState } from './types';

const STATES: readonly McuChatState[] = ['IDLE', 'LISTEN', 'THINK', 'SPEAK'];

/** 固件：`[chat] turn_id=N state=SPEAK mock=1 回复` 或无 state 的 logChat 行。 */
const LINE_RE = /^\[chat\]\s+turn_id=(-?\d+)\s+(?:state=([A-Za-z]+)\s+)?mock=([01])\s*(.*)$/;

const ARM_FACE_RE =
  /^\[arm\]\s+face=(\d+)\s+cx=(-?\d+)\s+cy=(-?\d+)\s+n=(-?\d+)\s+err=(-?\d+),(-?\d+)\s+base=(-?\d+)\s+shld=(-?\d+)\s+elbw=(-?\d+)\s+grip=(-?\d+)\s+bytes=(\d+)/;
const ARM_LOST_RE =
  /^\[arm\]\s+face=0\s+decode=(\d+)\s+lost=(-?\d+)\s+base=(-?\d+)\s+shld=(-?\d+)\s+bytes=(\d+)/;

export const GUEST_LLM_URL = 'http://192.168.4.2/v1/chat/completions';

export function parseChatLine(line: string): ChatLine | null {
  const raw = line.trim();
  if (!raw.startsWith('[chat]')) return null;
  const m = raw.match(LINE_RE);
  if (!m) return null;
  const maybeState = m[2];
  const state = STATES.includes(maybeState as McuChatState)
    ? (maybeState as McuChatState)
    : undefined;
  return {
    turnId: Number(m[1]),
    mock: m[3] === '1',
    state,
    extra: (m[4] ?? '').trim(),
    raw,
  };
}

export function parseArmLine(line: string): ArmTelemetry | null {
  const raw = line.trim();
  if (!raw.startsWith('[arm]')) return null;
  const hit = raw.match(ARM_FACE_RE);
  if (hit) {
    return {
      face: hit[1] === '1',
      cx: Number(hit[2]),
      cy: Number(hit[3]),
      n: Number(hit[4]),
      errX: Number(hit[5]),
      errY: Number(hit[6]),
      base: Number(hit[7]),
      shld: Number(hit[8]),
      elbw: Number(hit[9]),
      grip: Number(hit[10]),
      lost: 0,
      decode: true,
      bytes: Number(hit[11]),
    };
  }
  const lost = raw.match(ARM_LOST_RE);
  if (!lost) return null;
  return {
    face: false,
    cx: 0,
    cy: 0,
    n: 0,
    errX: 0,
    errY: 0,
    base: Number(lost[3]),
    shld: Number(lost[4]),
    elbw: 90,
    grip: 70,
    lost: Number(lost[2]),
    decode: lost[1] === '1',
    bytes: Number(lost[5]),
  };
}

export function encodeSay(text: string): string {
  const u = text.replace(/\s+/g, ' ').trim();
  return `SAY ${u}\n`;
}

export function encodeLiveOn(): string[] {
  return [`URL ${GUEST_LLM_URL}\n`, 'MODE live\n'];
}

export function encodeLiveOff(): string {
  return 'MODE mock\n';
}

export function isTransportFail(extra: string): boolean {
  return /WiFi 未连接|HTTP \d|解析失败|回退 mock/.test(extra);
}

/** 对 Serial Monitor 累计输出做增量切行。输出被清空时自动复位。 */
export class SerialLineParser {
  private seen = 0;
  private rest = '';

  reset(): void {
    this.seen = 0;
    this.rest = '';
  }

  push(fullOutput: string): { lines: string[]; reset: boolean } {
    let reset = false;
    if (fullOutput.length < this.seen) {
      this.reset();
      reset = true;
    }
    const added = fullOutput.slice(this.seen);
    this.seen = fullOutput.length;
    const data = this.rest + added;
    const parts = data.split(/\r?\n/);
    this.rest = parts.pop() ?? '';
    return { lines: parts, reset };
  }
}

export class SerialChatParser {
  private inner = new SerialLineParser();

  reset(): void {
    this.inner.reset();
  }

  push(fullOutput: string): { lines: ChatLine[]; reset: boolean } {
    const { lines, reset } = this.inner.push(fullOutput);
    const parsed: ChatLine[] = [];
    for (const line of lines) {
      const chat = parseChatLine(line);
      if (chat) parsed.push(chat);
    }
    return { lines: parsed, reset };
  }
}
