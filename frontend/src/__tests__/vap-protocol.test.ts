import { describe, it, expect } from 'vitest';
import {
  encodeLiveOn,
  encodeSay,
  GUEST_LLM_URL,
  parseArmLine,
  parseChatLine,
  SerialChatParser,
} from '@apps/protocol';

describe('vap protocol', () => {
  it('parses THINK / SPEAK lines from ai-chat-bot.ino', () => {
    const think = parseChatLine('[chat] turn_id=3 state=THINK mock=1 你好');
    expect(think).toMatchObject({
      turnId: 3,
      state: 'THINK',
      mock: true,
      extra: '你好',
    });
    const speak = parseChatLine(
      '[chat] turn_id=3 state=SPEAK mock=1 你好，我是 Velxio 对话机器人。',
    );
    expect(speak?.state).toBe('SPEAK');
    expect(speak?.extra).toContain('Velxio');
  });

  it('parses logChat lines without state', () => {
    const line = parseChatLine('[chat] turn_id=0 mock=1 mode=mock');
    expect(line).toMatchObject({ turnId: 0, mock: true, extra: 'mode=mock' });
    expect(line?.state).toBeUndefined();
  });

  it('ignores unrelated serial', () => {
    expect(parseChatLine('hello')).toBeNull();
    expect(parseChatLine('[wifi] connected')).toBeNull();
  });

  it('encodes SAY and Live commands for firmware', () => {
    expect(encodeSay('  你好  世界 ')).toBe('SAY 你好 世界\n');
    expect(encodeLiveOn()).toEqual([`URL ${GUEST_LLM_URL}\n`, 'MODE live\n']);
  });

  it('parses arm telemetry from ai-vision-arm.ino', () => {
    const hit = parseArmLine(
      '[arm] face=1 cx=90 cy=50 n=120 err=10,-10 base=95 shld=88 elbw=91 grip=20 bytes=4096',
    );
    expect(hit).toMatchObject({ face: true, cx: 90, base: 95, grip: 20 });
    const lost = parseArmLine('[arm] face=0 decode=1 lost=3 base=90 shld=90 bytes=2048');
    expect(lost).toMatchObject({ face: false, lost: 3, decode: true });
  });

  it('incrementally splits lines and resets when output is cleared', () => {
    const p = new SerialChatParser();
    const a = p.push('[chat] turn_id=1 state=LISTEN mock=1 button\n[chat] turn_id=1 st');
    expect(a.lines).toHaveLength(1);
    expect(a.lines[0].state).toBe('LISTEN');
    const b = p.push(
      '[chat] turn_id=1 state=LISTEN mock=1 button\n[chat] turn_id=1 state=THINK mock=1 hi\n',
    );
    expect(b.reset).toBe(false);
    expect(b.lines).toHaveLength(1);
    expect(b.lines[0].state).toBe('THINK');
    const c = p.push('');
    expect(c.reset).toBe(true);
    expect(c.lines).toEqual([]);
  });
});
