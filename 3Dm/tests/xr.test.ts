import { describe, expect, it } from 'vitest';
import { attachXR } from '../src/viewer/xr.js';

describe('P3 WebXR 接缝', () => {
  it('attachXR 打开 renderer.xr.enabled 并返回 detach', () => {
    const renderer = {
      xr: { enabled: false },
      domElement: { style: {} as Record<string, string> },
      setAnimationLoop: (fn: null | (() => void)) => {
        void fn;
      },
    };
    const host = { appendChild(n: unknown) { this.child = n; }, child: null as unknown };
    const xr = attachXR(renderer as never, host as never);
    expect(renderer.xr.enabled).toBe(true);
    expect(xr.supported).toBeTypeOf('boolean');
    xr.detach();
    expect(renderer.xr.enabled).toBe(false);
  });
});
