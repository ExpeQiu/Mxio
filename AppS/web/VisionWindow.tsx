import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useWebcamFrames } from '@velxio/hooks/useWebcamFrames';
import { useSimulatorStore } from '@velxio/store/useSimulatorStore';
import { vapLog } from './log';
import { VAP_VISION_ID } from './registry';
import { useVapStore } from './useVapStore';
import './ChatWindow.css';

const PREVIEW_W = 160;
const PREVIEW_H = 120;

export const VisionWindow: React.FC = () => {
  const { t } = useTranslation();
  const win = useVapStore((s) => s.windows[VAP_VISION_ID]);
  const open = Boolean(win?.open);
  const docked = useVapStore((s) => s.docked);
  const pos = win?.pos ?? { x: -1, y: 48 };
  const setPos = useVapStore((s) => s.setPos);
  const setOpen = useVapStore((s) => s.setOpen);
  const arm = useVapStore((s) => s.arm);
  const camera = useVapStore((s) => s.peripherals.camera);
  const running = useSimulatorStore((s) => s.running);
  const activeBoardId = useSimulatorStore((s) => s.activeBoardId);
  const { status, framesSent, start, stop, videoRef, errorMessage } = useWebcamFrames(14000);
  const layerRef = useRef<HTMLDivElement>(null);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (docked || !open || pos.x >= 0 || !layerRef.current) return;
    setPos(VAP_VISION_ID, { x: 12, y: 48 });
  }, [docked, open, pos.x, setPos]);

  useEffect(() => {
    if (!open || !running || !camera.bound) {
      autoStartedRef.current = false;
      if (status === 'streaming') stop();
      return;
    }
    if (autoStartedRef.current || !activeBoardId || status === 'streaming' || status === 'requesting') {
      return;
    }
    autoStartedRef.current = true;
    vapLog.info('camera_start', { app_id: VAP_VISION_ID });
    void start(activeBoardId, { deviceId: camera.deviceId });
  }, [open, running, activeBoardId, status, start, stop, camera.bound, camera.deviceId]);

  if (!open) return null;

  const onTitlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (docked) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const layer = layerRef.current;
    if (!layer) return;
    const rect = layer.getBoundingClientRect();
    const grab = { dx: e.clientX - (rect.left + pos.x), dy: e.clientY - (rect.top + pos.y) };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const nextX = Math.max(0, Math.min(rect.width - 160, ev.clientX - rect.left - grab.dx));
      const nextY = Math.max(0, Math.min(rect.height - 48, ev.clientY - rect.top - grab.dy));
      setPos(VAP_VISION_ID, { x: nextX, y: nextY });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const cx = arm.face ? arm.cx : PREVIEW_W / 2;
  const cy = arm.face ? arm.cy : PREVIEW_H / 2;

  return (
    <div className="vap-layer" ref={layerRef}>
      <div
        className={`vap-chat vap-vision${docked ? ' vap-docked' : ''}`}
        style={docked ? undefined : { left: Math.max(0, pos.x), top: Math.max(0, pos.y) }}
        data-testid="vap-vision-window"
      >
        <div className="vap-chat-title" onPointerDown={onTitlePointerDown}>
          <span className="vap-chat-title-name">{t('editor.canvas.vision')}</span>
          <span className={`vap-chat-badge${arm.face ? ' vap-chat-badge-live' : ''}`}>
            {arm.face ? t('editor.canvas.visionLock') : t('editor.canvas.visionHunt')}
          </span>
          <button
            type="button"
            className="vap-chat-close"
            onClick={() => {
              stop();
              setOpen(VAP_VISION_ID, false, 'user');
            }}
            title={t('editor.canvas.toggleVision')}
          >
            ×
          </button>
        </div>
        {!running && <div className="vap-chat-hint">{t('editor.canvas.chatHintRun')}</div>}
        {errorMessage ? <div className="vap-chat-hint">{errorMessage}</div> : null}
        <div className="vap-vision-preview">
          <video ref={videoRef} className="vap-vision-video" muted playsInline autoPlay />
          <div
            className={`vap-vision-cross${arm.face ? ' on' : ''}`}
            style={{
              left: `${(cx / PREVIEW_W) * 100}%`,
              top: `${(cy / PREVIEW_H) * 100}%`,
            }}
          />
        </div>
        <div className="vap-vision-meta">
          <div>
            {t('editor.canvas.visionFrames')}: {framesSent} · {arm.bytes} B
          </div>
          <div>
            base {arm.base}° · shld {arm.shld}° · elbw {arm.elbw}° · grip {arm.grip}°
          </div>
          <div>
            {arm.face
              ? `err ${arm.errX},${arm.errY} n=${arm.n}`
              : `lost=${arm.lost} decode=${arm.decode ? 1 : 0}`}
          </div>
        </div>
      </div>
    </div>
  );
};
