import type { WebGLRenderer } from 'three';
import { log } from '../core/log.js';

export interface XrHandle {
  supported: boolean;
  detach: () => void;
}

type XrRenderer = {
  xr: { enabled: boolean };
  setAnimationLoop: (fn: null | ((time: number, frame?: unknown) => void)) => void;
  domElement: { style: { touchAction?: string } };
};

/**
 * P3：同一套 pose → FK → 场景，只把 Three 渲染循环接到 WebXR。
 * 无 headset / 非安全上下文时 supported=false，桌面视口照常工作。
 */
export function attachXR(
  renderer: WebGLRenderer | XrRenderer,
  host: ParentNode,
  onFrame?: (time: number) => void,
): XrHandle {
  const r = renderer as XrRenderer;
  r.xr.enabled = true;
  r.domElement.style.touchAction = 'none';

  const btn = globalThis.document?.createElement?.('button') ?? ({
    textContent: '',
    disabled: false,
    style: {} as Record<string, string>,
    onclick: null as null | (() => void),
    remove: () => undefined,
    className: '',
  } as unknown as HTMLButtonElement);
  btn.textContent = 'Enter VR';
  btn.className = 'xr-btn';
  if ('style' in btn) {
    Object.assign(btn.style, {
      position: 'absolute',
      right: '12px',
      bottom: '12px',
      zIndex: '5',
    });
  }

  let supported = false;
  const xr = (globalThis.navigator as Navigator & { xr?: { isSessionSupported: (m: string) => Promise<boolean> } })
    ?.xr;

  if (xr?.isSessionSupported) {
    void xr.isSessionSupported('immersive-vr').then((ok) => {
      supported = ok;
      btn.textContent = ok ? 'Enter VR' : 'VR 不可用';
      btn.disabled = !ok;
      log.info('xr.support', { phase: 'p3', supported: ok });
    });
  } else {
    btn.textContent = 'VR 不可用';
    btn.disabled = true;
    log.info('xr.support', { phase: 'p3', supported: false, reason: 'no navigator.xr' });
  }

  btn.onclick = async () => {
    const nav = globalThis.navigator as Navigator & {
      xr?: { requestSession: (m: string) => Promise<{ end: () => Promise<void> }> };
    };
    if (!nav.xr?.requestSession) return;
    try {
      const session = await nav.xr.requestSession('immersive-vr');
      const threeRenderer = renderer as WebGLRenderer;
      await threeRenderer.xr.setSession(session as never);
      log.info('xr.session', { phase: 'p3', on: true });
      session.addEventListener?.('end', () => {
        log.info('xr.session', { phase: 'p3', on: false });
      });
    } catch (err) {
      log.error('xr.session', { phase: 'p3', error: String(err) });
    }
  };

  if ('appendChild' in host) host.appendChild(btn);

  if (onFrame) {
    r.setAnimationLoop((time) => onFrame(time));
  }

  return {
    get supported() {
      return supported;
    },
    detach() {
      r.xr.enabled = false;
      r.setAnimationLoop(null);
      btn.remove?.();
    },
  };
}
