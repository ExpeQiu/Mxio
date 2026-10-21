import {
  columnPercents,
  resolveStudioColumns,
  shouldAutoStudio,
  visibleColumnCount,
} from '../../../center/web/layout.ts';
import { loadExample, listExampleMeta } from '../examples/load.js';
import type { VlxPayload } from '../../../frontend/src/utils/vlxCore.ts';
import { logInfo } from '../output.js';

function exampleIdFromVlx(payload: VlxPayload): string | undefined {
  const name = (payload.name ?? '').toLowerCase();
  if (!name) return undefined;
  const items = listExampleMeta();
  const hit = items.find((e) => e.id === name || e.title.toLowerCase() === name);
  return hit?.id;
}

export function studioColumns(opts: {
  exampleId?: string;
  payload?: VlxPayload;
}): {
  exampleId: string | null;
  auto: boolean;
  columns: { hardware: true; app: boolean; motion: boolean };
  percents: { hw: number; app: number; motion: number };
  visible: number;
} {
  let exampleId = opts.exampleId ?? null;
  let partTypes: string[] = [];
  if (opts.payload) {
    partTypes = opts.payload.components.map((c) => c.metadataId);
    if (!exampleId) exampleId = exampleIdFromVlx(opts.payload) ?? null;
  }
  if (exampleId && partTypes.length === 0) {
    const ex = loadExample(exampleId);
    partTypes = ex.components.map((c) => c.type);
  }
  const columns = resolveStudioColumns({ exampleId, partTypes });
  const auto = shouldAutoStudio(exampleId, partTypes);
  const percents = columnPercents(columns);
  logInfo('studio.columns', {
    example_id: exampleId,
    auto,
    app: columns.app,
    motion: columns.motion,
    visible: visibleColumnCount(columns),
  });
  return {
    exampleId,
    auto,
    columns,
    percents,
    visible: visibleColumnCount(columns),
  };
}
