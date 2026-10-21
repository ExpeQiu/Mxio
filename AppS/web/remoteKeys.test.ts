import { describe, expect, it } from 'vitest';
import {
  actionForKey,
  isPad,
  isPeriph,
  keyCaption,
  primaryKey,
} from './remoteKeys';

describe('remote keys', () => {
  it('maps arrows / Z·Enter / X·Space / 1·2·3', () => {
    expect(actionForKey('ArrowUp')).toBe('up');
    expect(actionForKey('ArrowDown')).toBe('down');
    expect(actionForKey('Z')).toBe('a');
    expect(actionForKey('Enter')).toBe('a');
    expect(actionForKey('x')).toBe('b');
    expect(actionForKey(' ')).toBe('b');
    expect(actionForKey('1')).toBe('camera');
    expect(actionForKey('2')).toBe('mic');
    expect(actionForKey('3')).toBe('speaker');
    expect(actionForKey('q')).toBeNull();
  });

  it('exposes canvas-bind primary keys and captions', () => {
    expect(primaryKey('up')).toBe('ArrowUp');
    expect(primaryKey('a')).toBe('z');
    expect(keyCaption('up')).toBe('Up');
    expect(keyCaption('a')).toBe('Z');
    expect(keyCaption('camera')).toBe('1');
    expect(isPad('a')).toBe(true);
    expect(isPeriph('mic')).toBe(true);
    expect(isPad('mic')).toBe(false);
  });
});
