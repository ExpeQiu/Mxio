import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import {
  parseVlxJson,
  serializeVlx,
  VlxParseError,
  type VlxPayload,
} from '../../../frontend/src/utils/vlxCore.ts';
import { validateProject } from '../circuit/validate.js';
import { CliError } from '../errors.js';

export interface ProjectHandle {
  path: string;
  payload: VlxPayload;
  digest: string;
  originalBytes: string;
}

export interface WriteOptions {
  force?: boolean;
  dryRun?: boolean;
  /** 写入前跑电路校验，默认 true。 */
  validate?: boolean;
  create?: boolean;
}

export interface SaveResult {
  written: boolean;
  dry_run: boolean;
  path: string;
  digest: string;
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function atomicWriteFile(filePath: string, content: string): void {
  const dir = dirname(filePath);
  const tmp = join(
    dir,
    `.${basename(filePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    writeFileSync(tmp, content, { encoding: 'utf8' });
    renameSync(tmp, filePath);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* ignore tmp cleanup */
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError('WRITE_FAILED', `写入失败: ${msg}`, { path: filePath });
  }
}

function lockPathFor(filePath: string): string {
  return `${filePath}.lock`;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function acquireLock(filePath: string): number {
  const lockPath = lockPathFor(filePath);
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      const fd = openSync(lockPath, 'wx');
      writeFileSync(fd, `${process.pid}\n`);
      return fd;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw new CliError('WRITE_FAILED', `无法锁定工程: ${(err as Error).message}`, {
          path: filePath,
        });
      }
      try {
        const pid = Number(readFileSync(lockPath, 'utf8').trim());
        if (!Number.isInteger(pid) || pid <= 0 || !pidAlive(pid)) {
          try {
            unlinkSync(lockPath);
          } catch {
            /* raced */
          }
          continue;
        }
      } catch {
        /* unreadable lock */
      }
      if (Date.now() > deadline) {
        throw new CliError('CONFLICT', `工程正被其他进程写入: ${filePath}`, { path: filePath });
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

function releaseLock(filePath: string, fd: number): void {
  try {
    closeSync(fd);
  } catch {
    /* already closed */
  }
  try {
    unlinkSync(lockPathFor(filePath));
  } catch {
    /* already gone */
  }
}

function readProjectText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError('FILE_NOT_FOUND', `文件不存在: ${path}`, { path });
    }
    throw err;
  }
}

function parseOrThrow(path: string, text: string): VlxPayload {
  try {
    return parseVlxJson(text);
  } catch (err) {
    if (err instanceof VlxParseError) {
      const code = /Invalid JSON/i.test(err.message) ? 'INVALID_JSON' : 'INVALID_VLX';
      throw new CliError(code, err.message, { path });
    }
    throw err;
  }
}

export function openProject(path: string): ProjectHandle {
  const originalBytes = readProjectText(path);
  return {
    path,
    payload: parseOrThrow(path, originalBytes),
    digest: sha256Text(originalBytes),
    originalBytes,
  };
}

export function readVlx(path: string): VlxPayload {
  return openProject(path).payload;
}

function ensureValid(payload: VlxPayload): void {
  const result = validateProject(payload);
  if (!result.ok) {
    throw new CliError('VALIDATION_FAILED', '写入前校验失败', { issues: result.issues });
  }
}

export function saveProject(
  handle: ProjectHandle,
  payload: VlxPayload,
  opts: WriteOptions = {},
): SaveResult {
  if (opts.validate !== false) ensureValid(payload);
  payload.exportedAt = new Date().toISOString();
  const content = serializeVlx(payload);
  const digest = sha256Text(content);
  if (opts.dryRun) {
    return { written: false, dry_run: true, path: handle.path, digest };
  }
  const fd = acquireLock(handle.path);
  try {
    if (existsSync(handle.path)) {
      const now = sha256Text(readFileSync(handle.path, 'utf8'));
      if (now !== handle.digest) {
        throw new CliError('CONFLICT', '工程已被其他进程修改', {
          path: handle.path,
          expected: handle.digest,
          actual: now,
        });
      }
    }
    atomicWriteFile(handle.path, content);
    return { written: true, dry_run: false, path: handle.path, digest };
  } finally {
    releaseLock(handle.path, fd);
  }
}

export function createProject(
  path: string,
  payload: VlxPayload,
  opts: WriteOptions = {},
): SaveResult {
  if (opts.validate !== false) ensureValid(payload);
  payload.exportedAt = new Date().toISOString();
  const content = serializeVlx(payload);
  const digest = sha256Text(content);
  if (opts.dryRun) {
    if (existsSync(path) && !opts.force) {
      throw new CliError('FILE_EXISTS', `目标已存在，需 --force: ${path}`, { path });
    }
    return { written: false, dry_run: true, path, digest };
  }
  const fd = acquireLock(path);
  try {
    if (existsSync(path) && !opts.force) {
      throw new CliError('FILE_EXISTS', `目标已存在，需 --force: ${path}`, { path });
    }
    atomicWriteFile(path, content);
    return { written: true, dry_run: false, path, digest };
  } finally {
    releaseLock(path, fd);
  }
}

export function updateVlx(
  path: string,
  mutator: (payload: VlxPayload) => void,
  opts: WriteOptions = {},
): SaveResult & { payload: VlxPayload } {
  const handle = openProject(path);
  mutator(handle.payload);
  const result = saveProject(handle, handle.payload, opts);
  return { ...result, payload: handle.payload };
}

export function writeVlx(path: string, payload: VlxPayload, opts: WriteOptions = {}): SaveResult {
  if (opts.create || !existsSync(path)) {
    return createProject(path, payload, { ...opts, create: true });
  }
  const handle = openProject(path);
  return saveProject(handle, payload, opts);
}
