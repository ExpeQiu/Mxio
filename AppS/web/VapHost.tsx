import { useEffect } from 'react';
import { useProjectStore } from '@velxio/store/useProjectStore';
import { useSimulatorStore } from '@velxio/store/useSimulatorStore';
import { ChatWindow } from './ChatWindow';
import { useVapStore } from './useVapStore';
import { VisionWindow } from './VisionWindow';

/** 把 UART 累计输出喂给虚拟窗口；按图库 example id 自动打开。 */
export const VapHost: React.FC = () => {
  const exampleId = useProjectStore((s) => s.currentExampleId);
  const syncExample = useVapStore((s) => s.syncExample);
  const ingestSerial = useVapStore((s) => s.ingestSerial);
  const serialOutput = useSimulatorStore((s) => {
    const id = s.activeBoardId;
    const board = s.boards.find((b) => b.id === id);
    return board?.serialOutput ?? s.serialOutput;
  });

  useEffect(() => {
    syncExample(exampleId);
  }, [exampleId, syncExample]);

  useEffect(() => {
    ingestSerial(serialOutput);
  }, [serialOutput, ingestSerial]);

  return (
    <>
      <ChatWindow />
      <VisionWindow />
    </>
  );
};
