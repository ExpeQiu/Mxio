/**
 * 综合窗口：左硬件 / 中应用 / 右运动。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VapHost } from '@apps/VapHost';
import { VirtualRemote } from '@apps/VirtualRemote';
import { useVapStore } from '@apps/useVapStore';
import { SimulatorCanvas } from '@velxio/components/simulator/SimulatorCanvas';
import { Motion3dPanel } from '@velxio/components/simulator/Motion3dPanel';
import { useProjectStore } from '@velxio/store/useProjectStore';
import { useSimulatorStore } from '@velxio/store/useSimulatorStore';
import { generatePreset, type GeneratedKit } from '@3dm/core/generate';
import { loadKit, registerKit } from '@3dm/core/kit';
import { canvasActuators, columnPercents, resolveStudioColumns, visibleColumnCount } from './layout';
import { draftsForMissing } from './applyBom';
import { centerLog } from './log';
import { LayerTrace } from './LayerTrace';
import { MotionKitBar, useMotionKit } from './MotionKitBar';
import { useCenterStore } from './useCenterStore';
import './StudioHost.css';

const FW_MIN = 120;
const FW_MAX = 480;
const FW_DEFAULT = 220;

export const StudioHost: React.FC<{
  canvasHeaderSlot: HTMLElement | null;
  firmware: React.ReactNode;
}> = ({ canvasHeaderSlot, firmware }) => {
  const { t } = useTranslation();
  const exampleId = useProjectStore((s) => s.currentExampleId);
  const components = useSimulatorStore((s) => s.components);
  const partTypes = components.map((c) => c.metadataId);
  const actuators = canvasActuators(components);
  const { kitId, onKitChange } = useMotionKit(exampleId, actuators);
  const [generated, setGenerated] = useState<GeneratedKit | null>(null);
  const recordAddComponent = useSimulatorStore((s) => s.recordAddComponent);
  const cols = resolveStudioColumns({ exampleId, partTypes });
  const percents = columnPercents(cols);
  const firmwareOpen = useCenterStore((s) => s.firmwareOpen);
  const toggleFirmware = useCenterStore((s) => s.toggleFirmware);
  const setDocked = useVapStore((s) => s.setDocked);
  const [fwHeight, setFwHeight] = useState(FW_DEFAULT);
  const [hwPct, setHwPct] = useState(percents.hw);
  const [appPct, setAppPct] = useState(percents.app);
  const rootRef = useRef<HTMLDivElement>(null);
  const colsKey = `${cols.app ? 1 : 0}${cols.motion ? 1 : 0}`;

  useEffect(() => {
    setHwPct(percents.hw);
    setAppPct(percents.app);
  }, [colsKey, percents.app, percents.hw]);

  useEffect(() => {
    setDocked(true);
    centerLog.info('studio_open', {
      example_id: exampleId,
      columns: String(visibleColumnCount(cols)),
      firmware_open: firmwareOpen,
    });
    return () => {
      setDocked(false);
      centerLog.info('studio_close', { example_id: exampleId });
    };
    // mount/unmount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setDocked]);

  const dragSplit = useCallback(
    (which: 'hw-app' | 'app-motion' | 'hw-motion') => (e: React.MouseEvent) => {
      e.preventDefault();
      const root = rootRef.current;
      if (!root) return;
      const startX = e.clientX;
      const startHw = hwPct;
      const startApp = appPct;
      const onMove = (ev: MouseEvent) => {
        const w = root.getBoundingClientRect().width;
        if (w <= 0) return;
        const delta = ((ev.clientX - startX) / w) * 100;
        if (which === 'hw-app') {
          const next = Math.max(22, Math.min(70, startHw + delta));
          setHwPct(next);
        } else if (which === 'hw-motion') {
          setHwPct(Math.max(22, Math.min(78, startHw + delta)));
        } else {
          const nextApp = Math.max(18, Math.min(50, startApp + delta));
          setAppPct(nextApp);
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [appPct, hwPct],
  );

  const onFwResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = fwHeight;
      const onMove = (ev: MouseEvent) => {
        setFwHeight(Math.max(FW_MIN, Math.min(FW_MAX, startH - (ev.clientY - startY))));
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [fwHeight],
  );

  const fillMissing = useCallback(() => {
    try {
      const kit = loadKit(kitId);
      const drafts = draftsForMissing(kit, actuators, components);
      for (const d of drafts) recordAddComponent(d);
      centerLog.info('kit.fill', { example_id: exampleId, kit_id: kitId, added: drafts.length });
    } catch (err) {
      centerLog.warn('kit.fill', { example_id: exampleId, kit_id: kitId, error: String(err) });
    }
  }, [actuators, components, exampleId, kitId, recordAddComponent]);

  const generateKit = useCallback(
    (token: string) => {
      const g = generatePreset(token);
      registerKit(g.kit);
      setGenerated(g);
      onKitChange(g.kit.id, true);
      centerLog.info('kit.generate', { example_id: exampleId, kit_id: g.kit.id, token });
    },
    [exampleId, onKitChange],
  );

  const motionPct = cols.motion ? Math.max(18, 100 - hwPct - (cols.app ? appPct : 0)) : 0;
  const appWidth = cols.app ? appPct : 0;

  return (
    <div className="center-studio" ref={rootRef} data-testid="center-studio">
      <div className="center-col" style={{ width: `${hwPct}%` }} data-testid="center-col-hw">
        <div className="center-col-head">
          <strong>{t('editor.shell.hardwareLayer', '硬件')}</strong>
        </div>
        <LayerTrace layer="hardware" />
        <div className="center-col-body">
          <SimulatorCanvas headerSlot={canvasHeaderSlot} />
        </div>
        {firmwareOpen && (
          <>
            <div className="center-fw-split" onMouseDown={onFwResize} />
            <div className="center-fw-drawer" style={{ height: fwHeight }}>
              {firmware}
            </div>
          </>
        )}
        <button
          type="button"
          className="center-fw-toggle"
          onClick={() => toggleFirmware()}
          data-testid="center-fw-toggle"
        >
          {firmwareOpen
            ? t('editor.shell.firmwareHide', '收起固件')
            : t('editor.shell.firmwareShow', '展开固件')}
        </button>
      </div>

      {cols.app && (
        <>
          <div className="center-split" onMouseDown={dragSplit('hw-app')} />
          <div className="center-col" style={{ width: `${appWidth}%` }} data-testid="center-col-app">
            <div className="center-col-head">
              <strong>{t('editor.shell.appLayer', '虚拟遥控器')}</strong>
            </div>
            <LayerTrace layer="app" />
            <div className="center-col-body center-app-pane">
              <VirtualRemote>
                <VapHost />
              </VirtualRemote>
            </div>
          </div>
        </>
      )}

      {cols.motion && (
        <>
          <div
            className="center-split"
            onMouseDown={dragSplit(cols.app ? 'app-motion' : 'hw-motion')}
          />
          <div className="center-col" style={{ width: `${motionPct}%` }} data-testid="center-col-motion">
            <div className="center-col-head">
              <strong>{t('editor.shell.motionLayer', '运动')}</strong>
              <MotionKitBar
                actuators={actuators}
                kitId={kitId}
                onKitChange={onKitChange}
                onFillMissing={fillMissing}
                onGenerate={generateKit}
              />
            </div>
            <LayerTrace layer="motion" />
            <div className="center-col-body">
              <Motion3dPanel kitId={kitId} actuators={actuators} generated={generated} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};
