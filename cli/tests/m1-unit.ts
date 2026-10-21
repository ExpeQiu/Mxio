import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyVlx, parseVlxJson, serializeVlx } from '../../frontend/src/utils/vlxCore.ts';
import { parseAssert, parseDrive, resolveDrivePin, evaluateAssertions } from '../src/sim/spice.ts';
import { addComponent, addWire, resolveBoard, setCodeFile } from '../src/circuit/mutate.ts';
import { validateProject } from '../src/circuit/validate.ts';
import { atomicWriteFile, openProject, saveProject, sha256Text } from '../src/ir/io.ts';
import { CliError } from '../src/errors.ts';
import { resolveConfig, parseDurationMs } from '../src/config.ts';
import { projectExecRequest } from '../src/exec/client.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const drive = parseDrive('gpio=17:1,23:1,5:1,16:1,27:0,24:0,6:0,13:0');
assert(drive.length === 8 && drive[0]!.pin === '17' && drive[0]!.high && drive[4]!.pin === '27' && !drive[4]!.high, 'parseDrive gpio list failed');
const arduino = parseDrive('D13:HIGH,D12:0');
assert(arduino[0]!.pin === 'D13' && arduino[0]!.high && !arduino[1]!.high, 'parseDrive named pins failed');
const wired = ['GPIO17', 'D13', '5V'];
assert(resolveDrivePin('raspberry-pi-5', '17', wired) === 'GPIO17', 'resolveDrivePin Pi failed');
assert(resolveDrivePin('arduino-uno', '13', ['D13']) === 'D13', 'resolveDrivePin Uno failed');

for (const boardKind of ['raspberry-pi-5', 'raspberry-pi-4', 'raspberry-pi-2', 'raspberry-pi-zero']) {
  const pi = emptyVlx({ boardKind, sketchName: 'main.py', sketchContent: 'print("ready")' });
  const request = projectExecRequest(pi, { target: 'sim' });
  assert(request.board === boardKind, 'Pi exec must preserve model instead of booting the Pi 3 default');
  assert(request.files[0]?.name === 'main.py', 'Pi exec must include Python files');
}

const a = parseAssert('current:m_fl>5mA');
assert(a.kind === 'current' && a.target === 'm_fl' && a.op === '>' && Math.abs(a.value - 0.005) < 1e-12 && !a.abs, 'parseAssert current failed');
const v = parseAssert('voltage:vm>2.4V');
assert(v.kind === 'voltage' && v.target === 'vm' && Math.abs(v.value - 2.4) < 1e-12, 'parseAssert voltage failed');

const neg = parseAssert('voltage:vm>-2.5e-1V');
assert(Math.abs(neg.value - -0.25) < 1e-12 && !neg.abs, 'parseAssert negative scientific failed');
const absA = parseAssert('abs:voltage:vm>1.5V');
assert(absA.abs && absA.kind === 'voltage', 'parseAssert abs prefix failed');

let unitThrew = false;
try {
  parseAssert('voltage:vm>5mA');
} catch (err) {
  unitThrew = err instanceof CliError && err.error_code === 'UNIT_MISMATCH';
}
assert(unitThrew, 'unit mismatch should throw UNIT_MISMATCH');

const signedFail = evaluateAssertions(
  [parseAssert('voltage:vm>2V')],
  {},
  { vm: -2.5 },
  { vm: -2.5 },
);
assert(!signedFail[0]!.ok && signedFail[0]!.actual === -2.5, 'negative voltage must not pass positive threshold');
const absPass = evaluateAssertions(
  [parseAssert('abs:voltage:vm>2V')],
  {},
  { vm: -2.5 },
  { vm: -2.5 },
);
assert(absPass[0]!.ok, 'explicit abs assertion should pass');
const missing = evaluateAssertions([parseAssert('voltage:nope>1V')], {}, {}, {});
assert(!missing[0]!.ok && missing[0]!.missing, 'missing probe must fail');

const payload = emptyVlx({ boardKind: 'arduino-uno', sketchName: 'sketch.ino' });
payload.boards.push({
  id: 'esp32',
  boardKind: 'esp32',
  x: 400,
  y: 80,
  activeFileGroupId: 'group-esp32',
});
payload.fileGroups['group-esp32'] = [{ name: 'sketch.ino', content: '// esp\n' }];

let boardThrew = false;
try {
  resolveBoard(payload, 'no-such');
} catch (err) {
  boardThrew = err instanceof CliError && err.error_code === 'BOARD_NOT_FOUND';
}
assert(boardThrew, 'missing board must throw BOARD_NOT_FOUND');
setCodeFile(payload, { file: 'sketch.ino', content: '// only-esp\n', boardId: 'esp32' });
assert(payload.fileGroups['group-arduino-uno']![0]!.content === '', 'uno sketch must stay unchanged');
assert(payload.fileGroups['group-esp32']![0]!.content.includes('only-esp'), 'esp32 sketch must update');

addComponent(payload, { part: 'led', id: 'led1' });
addWire(payload, { from: 'arduino-uno:D13', to: 'led1:A', id: 'w_led' });
let wireExists = false;
try {
  addWire(payload, { from: 'arduino-uno:D13', to: 'led1:A' });
} catch (err) {
  wireExists = err instanceof CliError && err.error_code === 'WIRE_EXISTS';
}
assert(wireExists, 'duplicate connection must throw WIRE_EXISTS');
let dupId = false;
try {
  addWire(payload, { from: 'arduino-uno:GND', to: 'led1:C', id: 'w_led', allowParallel: true });
} catch (err) {
  dupId = err instanceof CliError && err.error_code === 'DUPLICATE_WIRE_ID';
}
assert(dupId, 'duplicate wire id must throw');
addWire(payload, { from: 'arduino-uno:GND', to: 'led1:C', id: 'w_gnd', allowParallel: true });

let dangled = false;
try {
  addWire(payload, { from: 'ghost:A', to: 'led1:C' });
} catch (err) {
  dangled = err instanceof CliError && err.error_code === 'DANGLING_ENDPOINT';
}
assert(dangled, 'dangling endpoint must throw');

let nanCoord = false;
try {
  addComponent(payload, { part: 'led', id: 'led2', x: Number('nope') });
} catch (err) {
  nanCoord = err instanceof CliError && err.error_code === 'INVALID_COORDINATE';
}
assert(nanCoord, 'NaN coordinate must throw');

const vdup = emptyVlx({ boardKind: 'arduino-uno', sketchName: 'sketch.ino' });
vdup.wires.push(
  { id: 'w1', start: { componentId: 'arduino-uno', pinName: 'D13' }, end: { componentId: 'arduino-uno', pinName: 'GND' } },
  { id: 'w1', start: { componentId: 'arduino-uno', pinName: 'D12' }, end: { componentId: 'arduino-uno', pinName: 'GND' } },
);
const issues = validateProject(vdup);
assert(issues.issues.some((i) => i.code === 'duplicate-wire-id'), 'validate must flag duplicate wire id');

let nestedThrew = false;
try {
  parseVlxJson(
    JSON.stringify({
      format: 'velxio-project',
      version: 1,
      exportedAt: '2026-09-16T00:00:00.000Z',
      boards: [{ id: 'arduino-uno', boardKind: 'arduino-uno', x: 1, y: 2, activeFileGroupId: 'missing' }],
      fileGroups: {},
      components: [],
      wires: [],
      activeBoardId: 'arduino-uno',
    }),
  );
} catch {
  nestedThrew = true;
}
assert(nestedThrew, 'missing file group reference must fail parse');

const analogish = parseVlxJson(
  JSON.stringify({
    format: 'velxio-project',
    version: 1,
    exportedAt: '2026-09-16T00:00:00.000Z',
    boards: [],
    fileGroups: {},
    components: [{ id: 'r1', metadataId: 'resistor', x: 1, y: 2, properties: {} }],
    wires: [],
    activeBoardId: null,
  }),
);
assert(analogish.components.length === 1, 'analog empty boards should parse');

assert(parseDurationMs('30s') === 30_000, 'parseDurationMs 30s');
assert(parseDurationMs('1500') === 1500, 'parseDurationMs ms default');
let badFmt = false;
try {
  resolveConfig({ format: 'xml' });
} catch (err) {
  badFmt = err instanceof CliError && err.error_code === 'INVALID_FORMAT';
}
assert(badFmt, 'invalid format must throw');

const dir = mkdtempSync(join(tmpdir(), 'velxio-m1-'));
const file = join(dir, 'p.vlx');
const original = emptyVlx({ boardKind: 'arduino-uno', sketchName: 'sketch.ino' });
writeFileSync(file, serializeVlx(original));
const originalBytes = readFileSync(file, 'utf8');
const h1 = openProject(file);
const h2 = openProject(file);
h1.payload.name = 'first';
const r1 = saveProject(h1, h1.payload, { validate: true });
assert(r1.written, 'first save should write');
h2.payload.name = 'second';
let conflict = false;
try {
  saveProject(h2, h2.payload, { validate: true });
} catch (err) {
  conflict = err instanceof CliError && err.error_code === 'CONFLICT';
}
assert(conflict, 'second save on stale digest must CONFLICT');
assert(JSON.parse(readFileSync(file, 'utf8')).name === 'first', 'winner content must remain first');

const failFile = join(dir, 'keep.vlx');
writeFileSync(failFile, originalBytes);
const before = readFileSync(failFile);
const blocked = join(dir, 'blocked');
writeFileSync(blocked, 'not-a-dir');
let writeFailed = false;
try {
  atomicWriteFile(join(blocked, 'x.vlx'), 'NEW');
} catch (err) {
  writeFailed = err instanceof CliError && err.error_code === 'WRITE_FAILED';
}
assert(writeFailed, 'atomic write into file-as-dir must fail');
assert(readFileSync(failFile).equals(before), 'unrelated file must stay intact after write failure');
assert(sha256Text(originalBytes) === sha256Text(originalBytes), 'digest stable');

chmodSync(dir, 0o555);
let chmodFail = false;
try {
  atomicWriteFile(join(dir, 'nope.vlx'), 'x');
} catch (err) {
  chmodFail = err instanceof CliError && err.error_code === 'WRITE_FAILED';
}
chmodSync(dir, 0o755);
assert(chmodFail, 'write into read-only dir must fail');
assert(existsSync(failFile) && readFileSync(failFile).equals(before), 'original bytes unchanged after failed write');

console.log('ok m1-unit');
