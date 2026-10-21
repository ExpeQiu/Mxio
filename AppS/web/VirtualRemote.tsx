/**
 * 虚拟遥控器：屏上投影现有 VAP 对话/视觉；按键联动 PC 键盘与画布按钮；顶栏绑定本机外设。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSimulatorStore } from '@velxio/store/useSimulatorStore';
import { dispatchRemoteToCanvas } from './canvasBridge';
import { startHostMic, stopHostMic } from './hostMic';
import { vapLog } from './log';
import {
  applyDeny,
  applyGrant,
  applyOff,
  deviceErrorName,
  devicesOfKind,
  type MediaDeviceLite,
  type PeripheralKind,
} from './peripherals';
import { VAP_CHAT_ID, VAP_VISION_ID } from './registry';
import {
  actionForKey,
  isModifierKey,
  isPad,
  isPeriph,
  isRemoteTypingTarget,
  keyCaption,
  type RemoteActionId,
  type RemotePadId,
  type RemotePeriphId,
} from './remoteKeys';
import { canMic, canTts, stopSpeak } from './speech';
import { useVapStore } from './useVapStore';
import './VirtualRemote.css';

const PERIPH_ORDER: RemotePeriphId[] = ['camera', 'mic', 'speaker'];

function listDevices(): Promise<MediaDeviceLite[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return Promise.resolve([]);
  }
  return navigator.mediaDevices.enumerateDevices().then((all) =>
    all.map((d) => ({
      deviceId: d.deviceId,
      kind: d.kind as MediaDeviceLite['kind'],
      label: d.label || d.deviceId.slice(0, 8),
    })),
  );
}

function scrollScreen(id: RemotePadId): void {
  const log = document.querySelector('.vremote-screen .vap-chat-log') as HTMLElement | null;
  if (!log) return;
  if (id === 'up') log.scrollTop -= 48;
  if (id === 'down') log.scrollTop += 48;
}

export const VirtualRemote: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const pressed = useVapStore((s) => s.pressed);
  const setPressed = useVapStore((s) => s.setPressed);
  const peripherals = useVapStore((s) => s.peripherals);
  const setPeripheral = useVapStore((s) => s.setPeripheral);
  const sendUtter = useVapStore((s) => s.sendUtter);
  const draft = useVapStore((s) => s.draft);
  const chatOpen = useVapStore((s) => Boolean(s.windows[VAP_CHAT_ID]?.open));
  const visionOpen = useVapStore((s) => Boolean(s.windows[VAP_VISION_ID]?.open));
  const serialWriteToBoard = useSimulatorStore((s) => s.serialWriteToBoard);
  const activeBoardId = useSimulatorStore((s) => s.activeBoardId);
  const components = useSimulatorStore((s) => s.components);
  const [devices, setDevices] = useState<MediaDeviceLite[]>([]);
  const [picker, setPicker] = useState<RemotePeriphId | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const previewStream = useRef<MediaStream | null>(null);
  const componentsRef = useRef(components);
  componentsRef.current = components;

  const writeSerial = useCallback(
    (line: string) => {
      if (!activeBoardId) {
        vapLog.warn('no_board', { extra: 'remote send dropped' });
        return;
      }
      serialWriteToBoard(activeBoardId, line);
    },
    [activeBoardId, serialWriteToBoard],
  );

  const hint = useCallback((key: string) => t(key), [t]);

  const stopPreview = useCallback(() => {
    previewStream.current?.getTracks().forEach((tr) => tr.stop());
    previewStream.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
  }, []);

  const fire = useCallback(
    (id: RemoteActionId, down: boolean) => {
      setPressed(id, down);
      dispatchRemoteToCanvas(id, down ? 'button-press' : 'button-release', componentsRef.current);
    },
    [setPressed],
  );

  const onA = useCallback(() => {
    sendUtter(draft, writeSerial);
  }, [draft, sendUtter, writeSerial]);

  const togglePeriph = useCallback(
    async (kind: RemotePeriphId) => {
      const cur = useVapStore.getState().peripherals[kind];
      if (cur.bound) {
        if (kind === 'camera') stopPreview();
        if (kind === 'speaker') stopSpeak();
        setPeripheral(kind, applyOff(cur));
        vapLog.info('peripheral_off', { extra: kind });
        return;
      }
      if (kind === 'speaker') {
        setPeripheral('speaker', { ...cur, bound: true, status: canTts() ? 'on' : 'idle' });
        vapLog.info('peripheral_on', { extra: 'speaker' });
        return;
      }
      if (kind === 'mic' && !canMic()) {
        setPeripheral('mic', applyDeny('no_stt', false));
        return;
      }
      setPeripheral(kind, { ...cur, status: 'requesting' });
      try {
        const stream = await navigator.mediaDevices.getUserMedia(
          kind === 'camera' ? { video: true, audio: false } : { video: false, audio: true },
        );
        const track = kind === 'camera' ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0];
        const deviceId = track?.getSettings().deviceId ?? '';
        const label = track?.label ?? kind;
        if (kind === 'camera' && !visionOpen) {
          previewStream.current = stream;
          if (previewRef.current) {
            previewRef.current.srcObject = stream;
            void previewRef.current.play();
          }
        } else {
          stream.getTracks().forEach((tr) => tr.stop());
        }
        setPeripheral(kind, applyGrant(deviceId, label));
        const listed = await listDevices();
        setDevices(listed);
        vapLog.info('peripheral_on', { extra: kind, device: label.slice(0, 40) });
      } catch (err) {
        const { denied, message } = deviceErrorName(err);
        setPeripheral(kind, applyDeny(message, denied));
        vapLog.warn('peripheral_fail', { extra: `${kind} ${message}` });
      }
    },
    [setPeripheral, stopPreview, visionOpen],
  );

  const pickDevice = useCallback(
    async (kind: PeripheralKind, deviceId: string) => {
      const hit = devices.find((d) => d.deviceId === deviceId);
      const cur = useVapStore.getState().peripherals[kind];
      setPeripheral(kind, applyGrant(deviceId, hit?.label ?? deviceId.slice(0, 8)));
      vapLog.info('peripheral_pick', { extra: kind, device: deviceId.slice(0, 12) });
      setPicker(null);
      if (kind === 'camera' && !visionOpen && cur.bound) {
        stopPreview();
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: deviceId } },
            audio: false,
          });
          previewStream.current = stream;
          if (previewRef.current) {
            previewRef.current.srcObject = stream;
            void previewRef.current.play();
          }
        } catch (err) {
          const { denied, message } = deviceErrorName(err);
          setPeripheral(kind, applyDeny(message, denied));
        }
      }
    },
    [devices, setPeripheral, stopPreview, visionOpen],
  );

  const onPad = useCallback(
    (id: RemotePadId, down: boolean) => {
      fire(id, down);
      if (down && (id === 'up' || id === 'down')) scrollScreen(id);
    },
    [fire],
  );

  const onAction = useCallback(
    (id: RemoteActionId, down: boolean) => {
      if (isPeriph(id)) {
        if (down) void togglePeriph(id);
        setPressed(id, down);
        return;
      }
      if (id === 'a') {
        fire('a', down);
        if (down) onA();
        return;
      }
      if (id === 'b') {
        fire('b', down);
        if (down) startHostMic(writeSerial, hint);
        else stopHostMic(hint);
        return;
      }
      onPad(id, down);
    },
    [fire, hint, onA, onPad, setPressed, togglePeriph, writeSerial],
  );

  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || isModifierKey(e.key)) return;
      if (isRemoteTypingTarget(e.target)) return;
      const id = actionForKey(e.key);
      if (!id) return;
      e.preventDefault();
      if (useVapStore.getState().pressed[id]) return;
      vapLog.info('remote_key', { extra: id, down: true });
      onActionRef.current(id, true);
    };
    const up = (e: KeyboardEvent) => {
      const id = actionForKey(e.key);
      if (!id) return;
      if (isPeriph(id)) {
        setPressed(id, false);
        return;
      }
      onActionRef.current(id, false);
    };
    const blur = () => {
      const cur = useVapStore.getState().pressed;
      for (const [id, on] of Object.entries(cur)) {
        if (on) onActionRef.current(id as RemoteActionId, false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      stopPreview();
    };
  }, [setPressed, stopPreview]);

  const showPreview = peripherals.camera.bound && !visionOpen;
  const screenEmpty = !chatOpen && !visionOpen;

  return (
    <div className="vremote" data-testid="virtual-remote" tabIndex={0}>
      <div className="vremote-dock">
        <div className="vremote-dock-brand">
          <span>MAKER</span>
          <span className="vremote-dock-ver">v1.0</span>
        </div>
        <div className="vremote-dock-btns">
          {PERIPH_ORDER.map((id) => {
            const p = peripherals[id];
            const on = p.bound && p.status !== 'denied' && p.status !== 'error';
            return (
              <div key={id} className="vremote-periph">
                <button
                  type="button"
                  className={`vremote-periph-btn ${id}${on ? ' on' : ''}${pressed[id] ? ' pressed' : ''}${p.status === 'requesting' ? ' wait' : ''}`}
                  data-testid={`vremote-periph-${id}`}
                  title={`${t(`editor.remote.${id}`)} · ${keyCaption(id)}`}
                  onClick={() => void togglePeriph(id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    void listDevices().then((d) => {
                      setDevices(d);
                      setPicker(picker === id ? null : id);
                    });
                  }}
                />
                <button
                  type="button"
                  className="vremote-periph-lab"
                  onClick={() => {
                    void listDevices().then((d) => {
                      setDevices(d);
                      setPicker(picker === id ? null : id);
                    });
                  }}
                >
                  {t(`editor.remote.${id}`)}
                  <kbd>{keyCaption(id)}</kbd>
                </button>
                {picker === id ? (
                  <div className="vremote-picker" data-testid={`vremote-picker-${id}`}>
                    {devicesOfKind(devices, id).length === 0 ? (
                      <div className="vremote-picker-empty">{t('editor.remote.noDevice')}</div>
                    ) : (
                      devicesOfKind(devices, id).map((d) => (
                        <button
                          key={d.deviceId}
                          type="button"
                          className={d.deviceId === p.deviceId ? 'sel' : ''}
                          onClick={() => void pickDevice(id, d.deviceId)}
                        >
                          {d.label}
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="vremote-shell">
        <div className="vremote-bezel">
          <div className="vremote-screen">
            {showPreview ? (
              <video
                ref={previewRef}
                className="vremote-pip"
                muted
                playsInline
                autoPlay
                data-testid="vremote-cam-preview"
              />
            ) : (
              <video ref={previewRef} className="vremote-pip hidden" muted playsInline />
            )}
            {screenEmpty ? <div className="vremote-empty">{t('editor.remote.empty')}</div> : null}
            {children}
          </div>
        </div>

        <div className="vremote-pad">
          <div className="vremote-dpad" aria-label={t('editor.remote.dpad')}>
            {(['up', 'left', 'right', 'down'] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={`vremote-dir ${id}${pressed[id] ? ' pressed' : ''}`}
                data-testid={`vremote-pad-${id}`}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  onPad(id, true);
                }}
                onPointerUp={() => onPad(id, false)}
                onPointerCancel={() => onPad(id, false)}
              >
                <span />
              </button>
            ))}
            <span className="vremote-dir-cap">{keyCaption('up')}</span>
          </div>
          <div className="vremote-ab">
            <PadFace
              id="a"
              pressed={Boolean(pressed.a)}
              caption={keyCaption('a')}
              label={t('editor.remote.padA')}
              onDown={() => onAction('a', true)}
              onUp={() => onAction('a', false)}
            />
            <PadFace
              id="b"
              pressed={Boolean(pressed.b)}
              caption={keyCaption('b')}
              label={t('editor.remote.padB')}
              onDown={() => onAction('b', true)}
              onUp={() => onAction('b', false)}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

function PadFace({
  id,
  pressed,
  caption,
  label,
  onDown,
  onUp,
}: {
  id: 'a' | 'b';
  pressed: boolean;
  caption: string;
  label: string;
  onDown: () => void;
  onUp: () => void;
}): React.ReactElement {
  return (
    <div className="vremote-face">
      <button
        type="button"
        className={`vremote-face-btn ${id}${pressed ? ' pressed' : ''}`}
        data-testid={`vremote-pad-${id}`}
        title={`${label} · ${caption}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onDown();
        }}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      <span>
        {label} <kbd>{caption}</kbd>
      </span>
    </div>
  );
}
