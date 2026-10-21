import React from 'react';
import { useTranslation } from 'react-i18next';
import { activeHops, type DriveHopId } from './drive';
import { useVapStore } from './useVapStore';
import './DriveTrace.css';

const SW: { id: DriveHopId; key: string }[] = [
  { id: 'window', key: 'driveWindow' },
  { id: 'stt', key: 'driveStt' },
  { id: 'bridge', key: 'driveBridge' },
];
const FW: { id: DriveHopId; key: string }[] = [
  { id: 'idle', key: 'IDLE' },
  { id: 'listen', key: 'LISTEN' },
  { id: 'think', key: 'THINK' },
  { id: 'speak', key: 'SPEAK' },
];
const HW: { id: DriveHopId; pin: string; key: string }[] = [
  { id: 'oled', pin: 'I2C', key: 'driveOled' },
  { id: 'buzzer', pin: 'GPIO15', key: 'driveBuzzer' },
  { id: 'led', pin: 'GPIO2', key: 'driveLed' },
  { id: 'speaker', pin: 'TTS', key: 'driveSpeaker' },
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
    <span className={`vap-drive-chip${on ? ' on' : ''}`}>
      <span>{label}</span>
      {sub ? <span className="vap-drive-pin">{sub}</span> : null}
    </span>
  );
}

export const DriveTrace: React.FC = () => {
  const { t } = useTranslation();
  const listening = useVapStore((s) => s.hostListening);
  const state = useVapStore((s) => s.mcuState);
  const lastBus = useVapStore((s) => s.lastBus);
  const hops = activeHops({ listening, state, lastBus });
  const busOn = hops.has('uart');
  const busText = lastBus?.text ? lastBus.text.slice(0, 28) : 'UART0';
  const busDir = lastBus?.dir === 'rx' ? 'RX' : lastBus?.dir === 'tx' ? 'TX' : '';

  return (
    <div className="vap-drive" data-testid="vap-drive-trace">
      <div className="vap-drive-row">
        <span className="vap-drive-lab">{t('editor.canvas.driveSoftware')}</span>
        {SW.map((n) => (
          <Chip key={n.id} on={hops.has(n.id)} label={t(`editor.canvas.${n.key}`)} />
        ))}
      </div>
      <div className="vap-drive-row">
        <span className="vap-drive-lab">{t('editor.canvas.driveBus')}</span>
        <Chip on={busOn} label={`${busDir ? `${busDir} ` : ''}${busText}`} />
      </div>
      <div className="vap-drive-row">
        <span className="vap-drive-lab">{t('editor.canvas.driveFirmware')}</span>
        {FW.map((n) => (
          <Chip key={n.id} on={hops.has(n.id)} label={n.key} />
        ))}
      </div>
      <div className="vap-drive-row">
        <span className="vap-drive-lab">{t('editor.canvas.driveHardware')}</span>
        {HW.map((n) => (
          <Chip key={n.id} on={hops.has(n.id)} label={t(`editor.canvas.${n.key}`)} sub={n.pin} />
        ))}
      </div>
    </div>
  );
};
