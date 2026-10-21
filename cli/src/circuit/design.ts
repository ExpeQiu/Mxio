import { spawn } from 'node:child_process';
import { emptyVlx } from '../../../frontend/src/utils/vlxCore.ts';
import { CliError } from '../errors.js';
import { repoRoot } from '../paths.js';
import { addComponent, addWire, setCodeFile } from './mutate.js';

export interface DesignPart {
  role: string;
  gpio?: string;
}

export interface DesignResult {
  ok: boolean;
  error?: string;
  board?: { id: string; board_kind: string; fqbn: string | null };
  components: Array<{ id: string; metadata_id: string; x: number; y: number; properties?: Record<string, unknown> }>;
  wires: Array<{ id: string; from: string; to: string; color?: string }>;
  issues: Array<{ severity: string; code: string; message: string }>;
  notes: string[];
  sketch?: { name: string; content: string };
}

export function parseDesignPart(spec: string): DesignPart {
  const [role, gpio] = spec.split(':');
  if (!role) throw new CliError('USAGE', `零件格式应为 role 或 role:gpio，收到 ${spec}`);
  return { role, gpio: gpio || undefined };
}

export function designViaPython(board: string, parts: DesignPart[]): Promise<DesignResult> {
  const payload = JSON.stringify({ board, parts });
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-m', 'app.services.circuit_design_cli'], {
      cwd: `${repoRoot()}/backend`,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      err += String(chunk);
    });
    child.on('error', () => reject(new CliError('UNAVAILABLE', '无法启动 python3 做电路设计')));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new CliError('VALIDATION_FAILED', err.trim() || out.trim() || `设计进程退出 ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(out) as DesignResult);
      } catch {
        reject(new CliError('INVALID_JSON', '电路设计返回的不是 JSON'));
      }
    });
    child.stdin.end(payload);
  });
}

export function designToProject(result: DesignResult) {
  if (!result.board) throw new CliError('UNKNOWN_BOARD_KIND', '设计结果没有板型');
  const sketch = result.sketch ?? { name: 'sketch.ino', content: '' };
  const payload = emptyVlx({
    boardKind: result.board.board_kind,
    sketchName: sketch.name,
    sketchContent: sketch.content,
  });
  for (const component of result.components) {
    addComponent(payload, {
      part: component.metadata_id,
      id: component.id,
      x: component.x,
      y: component.y,
    });
    const created = payload.components.find((item) => item.id === component.id);
    if (created && component.properties) Object.assign(created.properties, component.properties);
  }
  for (const wire of result.wires) {
    addWire(payload, { from: wire.from, to: wire.to, id: wire.id, color: wire.color });
  }
  setCodeFile(payload, { file: sketch.name, content: sketch.content });
  return payload;
}
