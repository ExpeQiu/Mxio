import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSimulatorStore } from '@velxio/store/useSimulatorStore';
import { DriveTrace } from './DriveTrace';
import { fetchVapHealth } from './llm';
import { vapLog } from './log';
import { VAP_CHAT_ID } from './registry';
import { abortHostMic, startHostMic, stopHostMic } from './hostMic';
import { canMic } from './speech';
import { useVapStore } from './useVapStore';
import './ChatWindow.css';

export const ChatWindow: React.FC = () => {
  const { t } = useTranslation();
  const win = useVapStore((s) => s.windows[VAP_CHAT_ID]);
  const open = Boolean(win?.open);
  const docked = useVapStore((s) => s.docked);
  const pos = win?.pos ?? { x: -1, y: 52 };
  const setPos = useVapStore((s) => s.setPos);
  const setOpen = useVapStore((s) => s.setOpen);
  const messages = useVapStore((s) => s.messages);
  const mcuState = useVapStore((s) => s.mcuState);
  const mock = useVapStore((s) => s.mock);
  const gatewayMock = useVapStore((s) => s.gatewayMock);
  const setGatewayMock = useVapStore((s) => s.setGatewayMock);
  const setFirmwareLive = useVapStore((s) => s.setFirmwareLive);
  const draft = useVapStore((s) => s.draft);
  const setDraft = useVapStore((s) => s.setDraft);
  const sendUtter = useVapStore((s) => s.sendUtter);
  const hostListening = useVapStore((s) => s.hostListening);
  const sttHint = useVapStore((s) => s.sttHint);
  const running = useSimulatorStore((s) => s.running);
  const serialWriteToBoard = useSimulatorStore((s) => s.serialWriteToBoard);
  const activeBoardId = useSimulatorStore((s) => s.activeBoardId);
  const layerRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const micBound = useVapStore((s) => s.peripherals.mic.bound);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, mcuState]);

  useEffect(() => {
    if (docked || !open || pos.x >= 0 || !layerRef.current) return;
    const w = layerRef.current.clientWidth;
    setPos(VAP_CHAT_ID, { x: Math.max(8, w - 356), y: 48 });
  }, [docked, open, pos.x, setPos]);

  useEffect(() => {
    if (!open) return;
    void fetchVapHealth().then((h) => {
      if (h) setGatewayMock(h.mock);
    });
  }, [open, setGatewayMock]);

  useEffect(() => {
    return () => {
      abortHostMic();
    };
  }, []);

  if (!open) return null;

  const writeSerial = (line: string) => {
    if (!activeBoardId) {
      vapLog.warn('no_board', { extra: 'send dropped' });
      return;
    }
    serialWriteToBoard(activeBoardId, line);
  };

  const send = () => sendUtter(draft, writeSerial);
  const hint = (key: string) => t(key);
  const startMic = () => startHostMic(writeSerial, hint);
  const stopMic = () => stopHostMic(hint);

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
      setPos(VAP_CHAT_ID, { x: nextX, y: nextY });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="vap-layer" ref={layerRef}>
      <div
        className={`vap-chat${docked ? ' vap-docked' : ''}`}
        style={docked ? undefined : { left: Math.max(0, pos.x), top: Math.max(0, pos.y) }}
        data-testid="vap-chat-window"
      >
        <div className="vap-chat-title" onPointerDown={onTitlePointerDown}>
          <span className="vap-chat-title-name">{t('editor.canvas.chat')}</span>
          <span className={`vap-chat-badge${mock ? '' : ' vap-chat-badge-live'}`}>
            {mock ? 'MOCK' : 'LIVE'} · {mcuState}
          </span>
          <button
            type="button"
            className="vap-chat-btn vap-chat-btn-mode"
            onClick={() => setFirmwareLive(mock, writeSerial)}
            title={t('editor.canvas.chatToggleLive')}
          >
            {mock ? 'Live' : 'Mock'}
          </button>
          <button
            type="button"
            className="vap-chat-close"
            onClick={() => setOpen(VAP_CHAT_ID, false, 'user')}
            title={t('editor.canvas.toggleChat')}
          >
            ×
          </button>
        </div>
        {!running && <div className="vap-chat-hint">{t('editor.canvas.chatHintRun')}</div>}
        {gatewayMock === false ? (
          <div className="vap-chat-hint">{t('editor.canvas.chatGatewayLive')}</div>
        ) : null}
        {sttHint ? <div className="vap-chat-hint">{sttHint}</div> : null}
        {!docked && <DriveTrace />}
        <div className="vap-chat-log" ref={logRef}>
          {messages.length === 0 ? (
            <div className="vap-chat-empty">{t('editor.canvas.chatEmpty')}</div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`vap-bubble vap-bubble-${m.role === 'user' ? 'user' : 'assistant'}`}
              >
                {m.text}
              </div>
            ))
          )}
        </div>
        <form
          className="vap-chat-compose"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            className="vap-chat-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('editor.canvas.chatPlaceholder')}
            aria-label={t('editor.canvas.chatPlaceholder')}
          />
          <button
            type="button"
            className={`vap-chat-btn vap-chat-btn-mic${hostListening ? ' listening' : ''}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              startMic();
            }}
            onPointerUp={stopMic}
            onPointerCancel={stopMic}
            title={
              !micBound
                ? t('editor.remote.micOff')
                : canMic()
                  ? t('editor.canvas.chatHold')
                  : t('editor.canvas.chatNoStt')
            }
          >
            {t('editor.canvas.chatHold')}
          </button>
          <button type="submit" className="vap-chat-btn" disabled={!draft.trim()}>
            {t('editor.canvas.chatSend')}
          </button>
        </form>
      </div>
    </div>
  );
};
