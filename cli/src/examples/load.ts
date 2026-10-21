import { exampleProjects } from '../../../frontend/src/data/examples.ts';
import type { ExampleLike } from '../../../frontend/src/utils/exampleToVlx.ts';
import { logInfo } from '../output.js';

let cache: ExampleLike[] | null = null;

function allExamples(): ExampleLike[] {
  if (!cache) {
    cache = exampleProjects as ExampleLike[];
    logInfo('examples.catalog', { count: cache.length });
  }
  return cache;
}

export interface ExampleMeta {
  id: string;
  title: string;
  category: string;
  board: string;
  components: number;
  wires: number;
}

export function listExampleMeta(opts?: {
  query?: string;
  board?: string;
  category?: string;
}): ExampleMeta[] {
  const q = opts?.query?.toLowerCase();
  const board = opts?.board?.toLowerCase();
  const category = opts?.category?.toLowerCase();
  return allExamples()
    .map((e) => ({
      id: e.id,
      title: e.title,
      category: e.category ?? '',
      board: e.boardFilter ?? e.boardType ?? (e.boards?.[0]?.boardKind ?? ''),
      components: e.components.length,
      wires: e.wires.length,
    }))
    .filter((e) => {
      if (category && e.category.toLowerCase() !== category) return false;
      if (board && e.board.toLowerCase() !== board) return false;
      if (
        q &&
        !e.id.toLowerCase().includes(q) &&
        !e.title.toLowerCase().includes(q) &&
        !e.board.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function loadExample(id: string): ExampleLike {
  const ex = allExamples().find((e) => e.id === id);
  if (!ex) {
    throw new Error(`未知示例 ${id}。velxio example list --query ${id}`);
  }
  return ex;
}
