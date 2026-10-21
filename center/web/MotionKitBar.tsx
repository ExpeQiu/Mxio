/**
 * 运动栏：选 Kit、补缺件、参数化生成。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { GEN_PRESETS } from '@3dm/core/generate';
import { detectKitId, listKits, loadKit, suggestBinds } from '@3dm/core/kit';
import type { CanvasActuator } from './layout';
import { centerLog } from './log';

export const MotionKitBar: React.FC<{
  actuators: CanvasActuator[];
  kitId: string;
  onKitChange: (id: string, locked: boolean) => void;
  onFillMissing?: () => void;
  onGenerate?: (token: string) => void;
}> = ({ actuators, kitId, onKitChange, onFillMissing, onGenerate }) => {
  const [tick, setTick] = useState(0);
  const kits = useMemo(() => listKits(), [tick]);
  const missing = useMemo(() => {
    try {
      return suggestBinds(loadKit(kitId), actuators).suggestions.filter((s) => s.status === 'missing');
    } catch {
      return [];
    }
  }, [actuators, kitId]);

  return (
    <>
      <select
        className="center-kit-select"
        value={kitId}
        onChange={(e) => onKitChange(e.target.value, true)}
        data-testid="center-kit-select"
        aria-label="模型组合"
      >
        {kits.map((k) => (
          <option key={k.id} value={k.id}>
            {k.name}
          </option>
        ))}
      </select>
      <select
        className="center-kit-gen"
        defaultValue=""
        aria-label="生成机构"
        data-testid="center-kit-gen"
        onChange={(e) => {
          const token = e.target.value;
          e.target.value = '';
          if (!token || !onGenerate) return;
          onGenerate(token);
          setTick((n) => n + 1);
        }}
      >
        <option value="">生成</option>
        {GEN_PRESETS.map((p) => (
          <option key={p.token} value={p.token}>
            {p.label}
          </option>
        ))}
      </select>
      {missing.length > 0 && (
        <>
          <span className="center-kit-hint" data-testid="center-kit-missing" title={missing.map((m) => m.name).join('、')}>
            缺{missing.map((m) => m.name).join('、')}
          </span>
          {onFillMissing && (
            <button
              type="button"
              className="center-kit-fill"
              data-testid="center-kit-fill"
              onClick={onFillMissing}
            >
              补缺件
            </button>
          )}
        </>
      )}
    </>
  );
};

export function useMotionKit(exampleId: string | null | undefined, actuators: CanvasActuator[]) {
  const ids = actuators.map((a) => a.id).join(',');
  const detected = detectKitId(actuators.map((a) => a.id));
  const [kitId, setKitId] = useState(detected);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    setLocked(false);
    const next = detectKitId(actuators.map((a) => a.id));
    setKitId(next);
    centerLog.info('kit.autodetect', { example_id: exampleId, kit_id: next, from_canvas: actuators.length });
    // example 切换时解锁并重测
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exampleId]);

  useEffect(() => {
    if (locked) return;
    setKitId(detected);
  }, [detected, ids, locked]);

  const onKitChange = (id: string, userLocked: boolean) => {
    setKitId(id);
    setLocked(userLocked);
    centerLog.info('kit.select', { example_id: exampleId, kit_id: id, locked: userLocked });
  };

  return { kitId, onKitChange };
}
