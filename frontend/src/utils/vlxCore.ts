/**
 * Store-free .vlx parse / serialize. Safe to import from the Node CLI
 * (no zustand, no DOM File).
 *
 * The editor wrappers in vlxFile.ts re-export these types and parse
 * helpers, then add store snapshots / browser download.
 */

export const VLX_FORMAT = 'velxio-project' as const;
export const VLX_VERSION = 1;

export interface VlxComponent {
  id: string;
  metadataId: string;
  x: number;
  y: number;
  properties: Record<string, unknown>;
}

export interface VlxWireEndpoint {
  componentId: string;
  pinName: string;
  x?: number;
  y?: number;
}

export interface VlxWire {
  id: string;
  start: VlxWireEndpoint;
  end: VlxWireEndpoint;
  color?: string;
  waypoints?: Array<{ x: number; y: number }>;
  signalType?: string;
  autoRouted?: boolean;
}

export interface VlxBoard {
  id: string;
  name?: string;
  boardKind: string;
  x: number;
  y: number;
  activeFileGroupId: string;
  languageMode?: string;
  serialBaudRate?: number;
  sdFiles?: Array<{ name: string; contentB64: string }>;
  libraries?: string[];
}

export interface VlxPayload {
  format: typeof VLX_FORMAT;
  version: number;
  exportedAt: string;
  name?: string;
  boards: VlxBoard[];
  fileGroups: Record<string, Array<{ name: string; content: string }>>;
  folderGroups?: Record<string, string[]>;
  components: VlxComponent[];
  wires: VlxWire[];
  activeBoardId: string | null;
}

export class VlxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VlxParseError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, ctx: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new VlxParseError(`${ctx} must be a non-empty string.`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, ctx: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new VlxParseError(`${ctx} must be a finite number.`);
  }
  return value;
}

function validateEndpoint(value: unknown, ctx: string): void {
  if (!isPlainObject(value)) {
    throw new VlxParseError(`${ctx} must be an object.`);
  }
  requireNonEmptyString(value.componentId, `${ctx}.componentId`);
  requireNonEmptyString(value.pinName, `${ctx}.pinName`);
}

function validateFileGroup(gid: string, files: unknown): void {
  if (!Array.isArray(files)) {
    throw new VlxParseError(`fileGroups["${gid}"] must be an array.`);
  }
  files.forEach((file, i) => {
    if (!isPlainObject(file)) {
      throw new VlxParseError(`fileGroups["${gid}"][${i}] must be an object.`);
    }
    requireNonEmptyString(file.name, `fileGroups["${gid}"][${i}].name`);
    if (typeof file.content !== 'string') {
      throw new VlxParseError(`fileGroups["${gid}"][${i}].content must be a string.`);
    }
  });
}

/** Validate unknown JSON as a VlxPayload. */
export function validateVlxPayload(data: unknown): VlxPayload {
  if (!isPlainObject(data)) {
    throw new VlxParseError('File is not a JSON object.');
  }
  if (data.format !== VLX_FORMAT) {
    throw new VlxParseError(
      `Not a Velxio project file (expected format="${VLX_FORMAT}", got ${JSON.stringify(
        data.format,
      )}).`,
    );
  }
  if (typeof data.version !== 'number') {
    throw new VlxParseError('Missing or invalid "version" field.');
  }
  if (data.version > VLX_VERSION) {
    throw new VlxParseError(
      `This file uses .vlx format version ${data.version}, but this Velxio supports up to v${VLX_VERSION}. Update Velxio to open it.`,
    );
  }
  if (typeof data.exportedAt !== 'string') {
    data.exportedAt = new Date().toISOString();
  }
  if (!Array.isArray(data.boards)) {
    throw new VlxParseError('Missing or invalid "boards" array.');
  }
  if (!isPlainObject(data.fileGroups)) {
    throw new VlxParseError('Missing or invalid "fileGroups" object.');
  }
  if (data.folderGroups !== undefined && !isPlainObject(data.folderGroups)) {
    delete data.folderGroups;
  }
  if (!Array.isArray(data.components)) {
    throw new VlxParseError('Missing or invalid "components" array.');
  }
  if (!Array.isArray(data.wires)) {
    throw new VlxParseError('Missing or invalid "wires" array.');
  }
  if (data.activeBoardId !== null && data.activeBoardId !== undefined && typeof data.activeBoardId !== 'string') {
    throw new VlxParseError('Invalid "activeBoardId" field.');
  }

  for (const [gid, files] of Object.entries(data.fileGroups as Record<string, unknown>)) {
    validateFileGroup(gid, files);
  }

  const boardIds = new Set<string>();
  data.boards.forEach((raw, i) => {
    if (!isPlainObject(raw)) {
      throw new VlxParseError(`boards[${i}] must be an object.`);
    }
    const id = requireNonEmptyString(raw.id, `boards[${i}].id`);
    requireNonEmptyString(raw.boardKind, `boards[${i}].boardKind`);
    requireFiniteNumber(raw.x, `boards[${i}].x`);
    requireFiniteNumber(raw.y, `boards[${i}].y`);
    const groupId = requireNonEmptyString(raw.activeFileGroupId, `boards[${i}].activeFileGroupId`);
    if (!Object.prototype.hasOwnProperty.call(data.fileGroups, groupId)) {
      throw new VlxParseError(`boards[${i}] (${id}) references missing file group "${groupId}".`);
    }
    boardIds.add(id);
  });

  if (typeof data.activeBoardId === 'string' && data.activeBoardId.length > 0 && !boardIds.has(data.activeBoardId)) {
    throw new VlxParseError(`activeBoardId "${data.activeBoardId}" does not match any board.`);
  }

  data.components.forEach((raw, i) => {
    if (!isPlainObject(raw)) {
      throw new VlxParseError(`components[${i}] must be an object.`);
    }
    requireNonEmptyString(raw.id, `components[${i}].id`);
    requireNonEmptyString(raw.metadataId, `components[${i}].metadataId`);
    requireFiniteNumber(raw.x, `components[${i}].x`);
    requireFiniteNumber(raw.y, `components[${i}].y`);
    if (raw.properties === undefined) {
      raw.properties = {};
    } else if (!isPlainObject(raw.properties)) {
      throw new VlxParseError(`components[${i}].properties must be an object.`);
    }
  });

  data.wires.forEach((raw, i) => {
    if (!isPlainObject(raw)) {
      throw new VlxParseError(`wires[${i}] must be an object.`);
    }
    requireNonEmptyString(raw.id, `wires[${i}].id`);
    validateEndpoint(raw.start, `wires[${i}].start`);
    validateEndpoint(raw.end, `wires[${i}].end`);
  });

  return data as unknown as VlxPayload;
}

/** Parse a .vlx JSON string. */
export function parseVlxJson(text: string): VlxPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new VlxParseError(`Invalid JSON: ${(err as Error).message}`);
  }
  return validateVlxPayload(parsed);
}

/** Serialize a payload for disk (pretty JSON + trailing newline). */
export function serializeVlx(payload: VlxPayload): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function emptyVlx(opts: {
  boardKind: string;
  name?: string;
  languageMode?: string;
  sketchName: string;
  sketchContent?: string;
}): VlxPayload {
  const id = opts.boardKind;
  const groupId = `group-${id}`;
  return {
    format: VLX_FORMAT,
    version: VLX_VERSION,
    exportedAt: new Date().toISOString(),
    name: opts.name ?? id,
    boards: [
      {
        id,
        boardKind: opts.boardKind,
        x: 40,
        y: 80,
        activeFileGroupId: groupId,
        languageMode: opts.languageMode,
      },
    ],
    fileGroups: {
      [groupId]: [{ name: opts.sketchName, content: opts.sketchContent ?? '' }],
    },
    components: [],
    wires: [],
    activeBoardId: id,
  };
}
