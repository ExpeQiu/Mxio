import { describe, expect, it, vi, afterEach } from 'vitest';
import { probe3dm, threeDmOrigin } from '../components/simulator/probe3dm';

describe('probe3dm', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('连接失败视为未启动', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    expect(await probe3dm('http://127.0.0.1:5174')).toBe(false);
  });

  it('no-cors 成功视为已启动', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null))));
    expect(await probe3dm('http://127.0.0.1:5174')).toBe(true);
  });

  it('从 iframe src 取出 origin', () => {
    expect(threeDmOrigin('http://127.0.0.1:5174/?embed=1&kit=arm-3dof')).toBe(
      'http://127.0.0.1:5174',
    );
  });
});
