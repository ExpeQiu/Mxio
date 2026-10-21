/**
 * Convert an ExampleProject into a store-free VlxPayload.
 * Board IDs match loadExample.ts / addBoard: first of a kind → boardKind,
 * nth → `${boardKind}-N`.
 *
 * This module must stay free of `data/examples.ts` so the Node CLI can
 * import it without pulling Vite `?raw` assets.
 */
import { isPiBoardKind } from '../types/board';
import {
  VLX_FORMAT,
  VLX_VERSION,
  type VlxBoard,
  type VlxPayload,
  type VlxWire,
} from './vlxCore';

function stripBrandPrefix(componentType: string): string {
  return componentType.replace(/^(wokwi|velxio)-/, '');
}

function isBoardComponentType(componentType: string): boolean {
  const t = componentType.toLowerCase();
  return (
    t.includes('arduino') ||
    t.includes('pico') ||
    t.includes('raspberry') ||
    t.includes('esp32')
  );
}

export interface ExampleLike {
  id: string;
  title: string;
  description?: string;
  category?: string;
  difficulty?: string;
  tags?: string[];
  code?: string;
  boardType?: string;
  boardFilter?: string;
  languageMode?: 'arduino' | 'micropython' | 'espidf';
  libraries?: string[];
  files?: Array<{ name: string; content: string }>;
  boards?: Array<{
    boardKind: string;
    x: number;
    y: number;
    code?: string;
    files?: Array<{ name: string; content: string }>;
    vfsFiles?: Record<string, string>;
    sdFiles?: Array<{ name: string; contentB64: string }>;
  }>;
  components: Array<{
    type: string;
    id: string;
    x: number;
    y: number;
    properties: Record<string, unknown>;
  }>;
  wires: Array<{
    id: string;
    start: { componentId: string; pinName: string };
    end: { componentId: string; pinName: string };
    color: string;
    autoRouted?: boolean;
  }>;
}

export function exampleBoardIds(example: ExampleLike): string[] {
  if (example.boards && example.boards.length > 0) {
    const kindCount = new Map<string, number>();
    return example.boards.map((eb) => {
      const n = (kindCount.get(eb.boardKind) ?? 0) + 1;
      kindCount.set(eb.boardKind, n);
      return n === 1 ? eb.boardKind : `${eb.boardKind}-${n}`;
    });
  }
  const filter = example.boardFilter;
  if (filter === 'analog' || filter === 'digital') return [];
  return [example.boardType || 'arduino-uno'];
}

function filesForExampleBoard(
  _example: ExampleLike,
  eb: NonNullable<ExampleLike['boards']>[number],
): Array<{ name: string; content: string }> {
  if (eb.files?.length) return eb.files.map((f) => ({ name: f.name, content: f.content }));
  if (eb.vfsFiles && isPiBoardKind(eb.boardKind)) {
    return Object.entries(eb.vfsFiles).map(([name, content]) => ({ name, content }));
  }
  if (eb.code) {
    const filename = isPiBoardKind(eb.boardKind) ? 'script.py' : 'sketch.ino';
    return [{ name: filename, content: eb.code }];
  }
  return [];
}

export function exampleToVlx(example: ExampleLike): VlxPayload {
  const boardIds = exampleBoardIds(example);
  const boards: VlxBoard[] = [];
  const fileGroups: VlxPayload['fileGroups'] = {};

  if (example.boards && example.boards.length > 0) {
    example.boards.forEach((eb, idx) => {
      const id = boardIds[idx]!;
      const groupId = `group-${id}`;
      boards.push({
        id,
        boardKind: eb.boardKind,
        x: eb.x,
        y: eb.y,
        activeFileGroupId: groupId,
        languageMode: example.languageMode,
        sdFiles: eb.sdFiles,
        libraries: example.libraries,
      });
      fileGroups[groupId] = filesForExampleBoard(example, eb);
    });
  } else if (boardIds.length > 0) {
    const id = boardIds[0]!;
    const groupId = `group-${id}`;
    const kind = example.boardType || 'arduino-uno';
    boards.push({
      id,
      boardKind: kind,
      x: 100,
      y: 100,
      activeFileGroupId: groupId,
      languageMode: example.languageMode,
      libraries: example.libraries,
    });
    if (example.files?.length) {
      fileGroups[groupId] = example.files.map((f) => ({ name: f.name, content: f.content }));
    } else {
      const filename = isPiBoardKind(kind) ? 'script.py' : 'sketch.ino';
      fileGroups[groupId] = [{ name: filename, content: example.code ?? '' }];
    }
  }

  const components = example.components
    .filter((c) => !isBoardComponentType(c.type))
    .map((c) => ({
      id: c.id,
      metadataId: stripBrandPrefix(c.type),
      x: c.x,
      y: c.y,
      properties: (c.properties ?? {}) as Record<string, unknown>,
    }));

  const wires: VlxWire[] = example.wires.map((w) => ({
    id: w.id,
    start: { componentId: w.start.componentId, pinName: w.start.pinName, x: 0, y: 0 },
    end: { componentId: w.end.componentId, pinName: w.end.pinName, x: 0, y: 0 },
    color: w.color,
    waypoints: [],
    autoRouted: w.autoRouted,
  }));

  return {
    format: VLX_FORMAT,
    version: VLX_VERSION,
    exportedAt: new Date().toISOString(),
    name: example.title,
    boards,
    fileGroups,
    components,
    wires,
    activeBoardId: boardIds[0] ?? null,
  };
}
