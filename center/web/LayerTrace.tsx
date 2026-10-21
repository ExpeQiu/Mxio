import React from 'react';
import { useTranslation } from 'react-i18next';
import { splitHops, type CenterLayer } from './hopLayers';
import { useVapStore } from '@apps/useVapStore';
import type { DriveHopId } from '@apps/drive';
import './LayerTrace.css';

const APP_CHIPS: { id: DriveHopId; key: string }[] = [
  { id: 'window', key: 'driveWindow' },
  { id: 'stt', key: 'driveStt' },
  { id: 'bridge', key: 'driveBridge' },
];

const HW_CHIPS: { id: DriveHopId; key: string; pin?: string }[] = [
  { id: 'uart', key: 'driveBus' },
  { id: 'idle', key: 'IDLE' },
  { id: 'listen', key: 'LISTEN' },
  { id: 'think', key: 'THINK' },
  { id: 'speak', key: 'SPEAK' },
  { id: 'oled', key: 'driveOled', pin: 'I2C' },
  { id: 'buzzer', key: 'driveBuzzer', pin: 'GPIO15' },
  { id: 'led', key: 'driveLed', pin: 'GPIO2' },
  { id: 'speaker', key: 'driveSpeaker', pin: 'TTS' },
];

function Chip({
  on,
  label,
  sub,
}: {
  on: boolean;
  label: string;
  sub?: string;
}): React.ReactElement {
  return (
    <span className={`center-trace-chip${on ? ' on' : ''}`}>
      <span>{label}</span>
      {sub ? <span className="center-trace-pin">{sub}</span> : null}
    </span>
  );
}

export const LayerTrace: React.FC<{ layer: CenterLayer }> = ({ layer }) => {
  const { t } = useTranslation();
  const listening = useVapStore((s) => s.hostListening);
  const state = useVapStore((s) => s.mcuState);
  const lastBus = useVapStore((s) => s.lastBus);
  const arm = useVapStore((s) => s.arm);
  const split = splitHops({ listening, state, lastBus });

  if (layer === 'app') {
    return (
      <div className="center-trace" data-testid="center-trace-app">
        {APP_CHIPS.map((n) => (
          <Chip
            key={n.id}
            on={split.app.has(n.id)}
            label={t(`editor.canvas.${n.key}`)}
          />
        ))}
      </div>
    );
  }

  if (layer === 'hardware') {
    const busText = lastBus?.text ? lastBus.text.slice(0, 22) : 'UART0';
    return (
      <div className="center-trace" data-testid="center-trace-hw">
        {HW_CHIPS.map((n) => (
          <Chip
            key={n.id}
            on={n.id === 'uart' ? split.uart : split.hardware.has(n.id)}
            label={n.id === 'uart' ? busText : n.key.startsWith('drive') ? t(`editor.canvas.${n.key}`) : n.key}
            sub={n.pin}
          />
        ))}
      </div>
    );
  }

  const motionOn = split.motion;
  return (
    <div className="center-trace" data-testid="center-trace-motion">
      <Chip on={motionOn.has('pose')} label={t('editor.canvas.drivePose', 'Pose')} />
      <Chip on={motionOn.has('sv_base')} label={`base ${arm.base}°`} />
      <Chip on={motionOn.has('sv_shld')} label={`shld ${arm.shld}°`} />
      <Chip on={motionOn.has('sv_elbw')} label={`elbw ${arm.elbw}°`} />
      <Chip on={motionOn.has('sv_grip')} label={`grip ${arm.grip}°`} />
    </div>
  );
};
