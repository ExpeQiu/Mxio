import { useEditorStore } from '@velxio/store/useEditorStore';
import { useMotion3dStore } from '@velxio/store/useMotion3dStore';
import { centerLog } from './log';
import { shouldAutoStudio, visibleColumnCount, resolveStudioColumns } from './layout';

/** P2：加载示例时自动进入 / 离开综合视图。 */
export function applyStudioAuto(
  exampleId: string | null | undefined,
  partTypes: readonly string[],
): void {
  const auto = shouldAutoStudio(exampleId, partTypes);
  const editor = useEditorStore.getState();
  const cols = resolveStudioColumns({ exampleId, partTypes });
  if (auto) {
    editor.setViewMode('studio');
    useMotion3dStore.getState().setOpen(true);
    centerLog.info('auto_studio', {
      example_id: exampleId ?? null,
      view_mode: 'studio',
      columns: String(visibleColumnCount(cols)),
    });
    return;
  }
  if (editor.viewMode === 'studio') {
    editor.setViewMode('both');
    useMotion3dStore.getState().setOpen(false);
    centerLog.info('leave_studio', {
      example_id: exampleId ?? null,
      view_mode: 'both',
    });
  }
}
