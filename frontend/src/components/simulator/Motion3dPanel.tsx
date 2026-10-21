/**
 * 3Dm 视口：iframe 嵌入 velxio/3Dm（默认 5174）。
 * 父页通过 postMessage 下发 kit / 执行器列表，运动层只消费 pose。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeneratedKit } from '@3dm/core/generate';
import type { CanvasActuator } from '@center/layout';
import { centerLog } from '@center/log';
import { probe3dm, threeDmOrigin } from './probe3dm';

function frameSrc(kitId: string): string {
  const raw =
    (import.meta as { env?: { VITE_3DM_URL?: string } }).env?.VITE_3DM_URL ??
    'http://127.0.0.1:5174';
  const u = new URL(raw);
  u.searchParams.set('embed', '1');
  u.searchParams.delete('mech');
  u.searchParams.set('kit', kitId);
  return u.toString();
}

export const Motion3dPanel: React.FC<{
  kitId?: string;
  actuators?: CanvasActuator[];
  generated?: GeneratedKit | null;
}> = ({ kitId = '4dof-arm', actuators = [], generated = null }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const src = useMemo(() => frameSrc(kitId), []);
  const origin = threeDmOrigin(src);
  const [up, setUp] = useState<boolean | null>(null);

  const postState = useCallback(() => {
    if (!up) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    if (generated && generated.kit.id === kitId) {
      win.postMessage({ type: 'velxio.3dm.register', generated, actuators }, '*');
      return;
    }
    win.postMessage({ type: 'velxio.3dm.kit', kit: kitId, actuators }, '*');
  }, [actuators, generated, kitId, up]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const ok = await probe3dm(origin);
      if (!alive) return;
      setUp((prev) => {
        if (prev !== ok) {
          centerLog.info(ok ? '3dm.up' : '3dm.down', { url: origin, kit_id: kitId });
        }
        return ok;
      });
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [origin, kitId]);

  useEffect(() => {
    postState();
  }, [postState]);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#0b1220',
        position: 'relative',
      }}
    >
      {up === null && (
        <div style={{ flex: 1, color: '#64748b', fontSize: 12, padding: 16 }}>正在连接 3Dm…</div>
      )}
      {up && (
        <iframe
          ref={iframeRef}
          id="velxio-3dm-frame"
          title="Velxio 3D Motion"
          src={src}
          onLoad={postState}
          allow="xr-spatial-tracking; xr"
          style={{ flex: 1, width: '100%', border: 0, background: '#0b1220' }}
        />
      )}
      {up === false && (
        <div
          data-testid="3dm-offline"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: '#94a3b8',
            fontSize: 13,
            padding: 16,
            textAlign: 'center',
          }}
        >
          <strong style={{ color: '#e2e8f0', fontWeight: 600 }}>3D 视口未启动</strong>
          <span>运动栏嵌的是 3Dm（{origin}），当前连不上。</span>
          <code style={{ fontSize: 11, color: '#7dd3fc' }}>cd velxio/3Dm && ./start.sh</code>
          <span style={{ fontSize: 11, color: '#64748b' }}>或重新执行仓库根目录 ./start.sh</span>
        </div>
      )}
    </div>
  );
};
