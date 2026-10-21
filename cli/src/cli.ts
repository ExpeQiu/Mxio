#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Command, Option } from 'commander';
import { emptyVlx } from '../../frontend/src/utils/vlxCore.ts';
import { exampleToVlx } from '../../frontend/src/utils/exampleToVlx.ts';
import { isPiBoardKind } from '../../frontend/src/types/board.ts';
import { CLI_VERSION } from './paths.js';
import { type CliConfig, peekArgvFlags, resolveConfig } from './config.js';
import { CliError, commanderToCliError, errorEnvelope } from './errors.js';
import {
  EXIT_FAIL,
  EXIT_OK,
  EXIT_UNAVAILABLE,
  die,
  envelope,
  logInfo,
  printJson,
  printTable,
  setVerbose,
  type DataSource,
} from './output.js';
import { findPart, listBoards, loadParts, partPins } from './catalog/index.js';
import { createProject, readVlx, updateVlx, type SaveResult } from './ir/io.js';
import { validateProject } from './circuit/validate.js';
import {
  addComponent,
  addWire,
  getCodeFile,
  listCircuit,
  listCodeFiles,
  removeComponent,
  removeWire,
  setCodeFile,
} from './circuit/mutate.js';
import { designToProject, designViaPython, parseDesignPart } from './circuit/design.js';
import { compileProject } from './compile/index.js';
import { parseAssert, parseDrive, runSpice } from './sim/spice.js';
import { qemuStatus } from './sim/qemu.js';
import { listExampleMeta, loadExample } from './examples/load.js';
import { runDoctor } from './doctor.js';
import { forward3dm } from './forward-3dm.js';
import { vapHealth, vapList, vapShow } from './vap/index.js';
import { studioColumns } from './studio/index.js';
import { demoExec, liveExec, projectExecRequest, type ExecTarget } from './exec/client.js';

interface GlobalOpts {
  format?: string;
  demo?: boolean;
  verbose?: boolean;
  apiUrl?: string;
  timeout?: string;
  force?: boolean;
  dryRun?: boolean;
}

function gopts(cmd: Command): GlobalOpts {
  return cmd.optsWithGlobals() as GlobalOpts;
}

function ctx(cmd: Command, extra: { probe?: boolean } = {}): CliConfig {
  const g = gopts(cmd);
  const local = cmd.opts() as GlobalOpts;
  const cfg = resolveConfig({
    ...g,
    force: Boolean(g.force || local.force),
    dryRun: Boolean(g.dryRun || local.dryRun),
    ...extra,
  });
  setVerbose(cfg.verbose);
  return cfg;
}

function wantJson(cfg: CliConfig): boolean {
  return cfg.format !== 'table';
}

function fail(module: string, err: unknown, dataSource: DataSource): never {
  const mapped = errorEnvelope(module, err, dataSource);
  die(mapped.exit, mapped.body);
}

function withCmd(
  module: string,
  cmd: Command,
  fn: (cfg: CliConfig) => void | Promise<void>,
  extra: { probe?: boolean } = {},
): Promise<void> {
  const cfg = ctx(cmd, extra);
  return Promise.resolve()
    .then(() => fn(cfg))
    .catch((err: unknown) => fail(module, err, cfg.dataSource));
}

function writeMeta(result: SaveResult): Record<string, unknown> {
  return { written: result.written, dry_run: result.dry_run };
}

function collect(val: string, acc: string[]): string[] {
  acc.push(val);
  return acc;
}

function peekSource(): DataSource {
  try {
    return resolveConfig(peekArgvFlags()).dataSource;
  } catch {
    return 'live';
  }
}

const program = new Command();
let commanderErr = '';
program
  .name('velxio')
  .description('Velxio 标准 CLI：元件、电路 .vlx、Kit、VAP、探活、编译与 SPICE')
  .version(CLI_VERSION)
  .enablePositionalOptions()
  .addOption(new Option('--format <fmt>', 'json | table').choices(['json', 'table']).default('json'))
  .option('--demo', 'Mock / 离线路径', false)
  .option('--verbose', 'stderr 打调试日志', false)
  .option('--force', '覆盖已有目标文件', false)
  .option('--dry-run', '不写盘，只返回将要发生的变更', false)
  .option('--api-url <url>', '后端 API，覆盖 VELXIO_API_URL')
  .option('--timeout <duration>', '请求超时，如 1500、30s')
  .showHelpAfterError(false)
  .configureOutput({
    writeErr: (str) => {
      commanderErr += str;
    },
  })
  .exitOverride();

program
  .command('version')
  .description('打印版本信封')
  .action((_opts: unknown, cmd: Command) =>
    withCmd('version', cmd, (cfg) => {
      printJson(envelope('version', { ok: true, version: CLI_VERSION }, cfg.dataSource));
    }),
  );

program
  .command('doctor')
  .description('探活前端/运动视口/后端/VAP/arduino-cli；--demo 为纯离线结果')
  .option('--probe', '即使 Mock 也探测真实环境', false)
  .action(async (opts: { probe?: boolean }, cmd: Command) => {
    await withCmd(
      'doctor',
      cmd,
      async (cfg) => {
        const result = await runDoctor({
          demo: cfg.mock,
          probe: Boolean(opts.probe),
          apiUrl: cfg.apiUrl,
          timeoutMs: cfg.timeoutMs,
        });
        printJson(envelope('doctor', { ...result }, cfg.dataSource));
        process.exit(result.ok ? EXIT_OK : EXIT_UNAVAILABLE);
      },
      { probe: Boolean(opts.probe) },
    );
  });

const parts = program.command('parts').description('元件清单查询');
parts
  .command('list')
  .option('--category <cat>')
  .option('--query <q>')
  .action((opts: { category?: string; query?: string }, cmd: Command) =>
    withCmd('parts.list', cmd, (cfg) => {
      let items = loadParts().map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        tagName: p.tagName,
        pinCount: p.pinCount,
        pins: (p.pins ?? partPins(p) ?? []).join(','),
      }));
      if (opts.category) items = items.filter((p) => p.category === opts.category);
      if (opts.query) {
        const q = opts.query.toLowerCase();
        items = items.filter(
          (p) =>
            p.id.includes(q) ||
            p.name.toLowerCase().includes(q) ||
            p.tagName.toLowerCase().includes(q),
        );
      }
      const body = envelope('parts.list', { ok: true, count: items.length, items }, cfg.dataSource);
      if (wantJson(cfg)) printJson(body);
      else printTable(items, ['id', 'name', 'category', 'pinCount']);
    }),
  );
parts.command('show <id>').action((id: string, _opts: unknown, cmd: Command) =>
  withCmd('parts.show', cmd, (cfg) => {
    const part = findPart(id);
    if (!part) throw new CliError('NOT_FOUND', `未找到元件 ${id}`, { id });
    printJson(
      envelope(
        'parts.show',
        { ok: true, item: { ...part, pins: part.pins ?? partPins(part) ?? [] } },
        cfg.dataSource,
      ),
    );
  }),
);

program
  .command('boards')
  .description('板型')
  .command('list')
  .action((_opts: unknown, cmd: Command) =>
    withCmd('boards.list', cmd, (cfg) => {
      const items = listBoards();
      const body = envelope('boards.list', { ok: true, count: items.length, items }, cfg.dataSource);
      if (wantJson(cfg)) printJson(body);
      else printTable(items, ['id', 'label', 'compile']);
    }),
  );

const example = program.command('example').description('内置示例');
example
  .command('list')
  .option('--query <q>')
  .option('--board <kind>')
  .option('--category <cat>')
  .action((opts: { query?: string; board?: string; category?: string }, cmd: Command) =>
    withCmd('example.list', cmd, (cfg) => {
      const items = listExampleMeta(opts);
      const body = envelope(
        'example.list',
        { ok: true, count: items.length, items },
        cfg.dataSource,
      );
      if (wantJson(cfg)) printJson(body);
      else printTable(items, ['id', 'title', 'board', 'category']);
    }),
  );
example.command('show <id>').action((id: string, _opts: unknown, cmd: Command) =>
  withCmd('example.show', cmd, (cfg) => {
    const ex = loadExample(id);
    printJson(
      envelope(
        'example.show',
        {
          ok: true,
          item: {
            id: ex.id,
            title: ex.title,
            category: ex.category,
            board: ex.boardFilter ?? ex.boardType ?? ex.boards?.[0]?.boardKind ?? '',
            components: ex.components.map((c) => ({ id: c.id, type: c.type })),
            wires: ex.wires.length,
            files: ex.files?.map((f) => f.name) ?? Object.keys(ex.boards?.[0]?.vfsFiles ?? {}),
          },
        },
        cfg.dataSource,
      ),
    );
  }),
);
example
  .command('export <id>')
  .requiredOption('-o, --out <file>', '.vlx 输出路径')
  .option('--force', '覆盖已有文件', false)
  .option('--dry-run', '不写盘', false)
  .action((id: string, opts: { out: string; force?: boolean; dryRun?: boolean }, cmd: Command) =>
    withCmd('example.export', cmd, (cfg) => {
      const ex = loadExample(id);
      const payload = exampleToVlx(ex);
      const saved = createProject(opts.out, payload, {
        force: cfg.force,
        dryRun: cfg.dryRun,
        validate: true,
      });
      logInfo('exported example', { id, out: opts.out, boards: payload.boards.length, ...saved });
      printJson(
        envelope(
          'example.export',
          {
            ok: true,
            id,
            out: opts.out,
            boards: payload.boards.map((b) => b.id),
            components: payload.components.length,
            wires: payload.wires.length,
            ...writeMeta(saved),
          },
          cfg.dataSource,
        ),
      );
    }),
  );

const project = program.command('project').description('.vlx 工程');
project
  .command('init')
  .requiredOption('--board <kind>', '板型，如 raspberry-pi-5')
  .option('-o, --out <file>', '输出路径', 'project.vlx')
  .option('--name <name>', '工程名')
  .option('--force', '覆盖已有文件', false)
  .option('--dry-run', '不写盘', false)
  .action((opts: { board: string; out: string; name?: string; force?: boolean; dryRun?: boolean }, cmd: Command) =>
    withCmd('project.init', cmd, (cfg) => {
      if (!listBoards().some((b) => b.id === opts.board)) {
        throw new CliError('UNKNOWN_BOARD_KIND', `未知板型: ${opts.board}`, { board: opts.board });
      }
      const sketchName = isPiBoardKind(opts.board) ? 'script.py' : 'sketch.ino';
      const payload = emptyVlx({
        boardKind: opts.board,
        name: opts.name,
        sketchName,
        languageMode: isPiBoardKind(opts.board) ? undefined : 'arduino',
      });
      const saved = createProject(opts.out, payload, {
        force: cfg.force,
        dryRun: cfg.dryRun,
        validate: true,
      });
      printJson(
        envelope(
          'project.init',
          { ok: true, out: opts.out, board: opts.board, ...writeMeta(saved) },
          cfg.dataSource,
        ),
      );
    }),
  );
project
  .command('show')
  .requiredOption('-p, --project <vlx>')
  .action((opts: { project: string }, cmd: Command) =>
    withCmd('project.show', cmd, (cfg) => {
      const payload = readVlx(opts.project);
      printJson(
        envelope(
          'project.show',
          {
            ok: true,
            name: payload.name,
            format: payload.format,
            boards: payload.boards.map((b) => ({
              id: b.id,
              boardKind: b.boardKind,
              files: (payload.fileGroups[b.activeFileGroupId] ?? []).map((f) => f.name),
            })),
            components: payload.components.map((c) => ({ id: c.id, metadataId: c.metadataId })),
            wires: payload.wires.map((w) => ({
              id: w.id,
              from: `${w.start.componentId}:${w.start.pinName}`,
              to: `${w.end.componentId}:${w.end.pinName}`,
            })),
          },
          cfg.dataSource,
        ),
      );
    }),
  );

const circuit = program.command('circuit').description('电路元件与接线');
circuit
  .command('design')
  .description('按目录和接线规则生成电路：led 自动串 220Ω，实例 id 不含连字符')
  .requiredOption('--board <kind>', 'esp32 | arduino-uno | raspberry-pi-5')
  .option('--part <role[:gpio]>', 'led:2 button:4 oled servo buzzer，可重复', collect, [] as string[])
  .option('-o, --output <vlx>', '写入 .vlx')
  .action(async (opts: { board: string; part: string[]; output?: string }, cmd: Command) => {
    await withCmd('circuit.design', cmd, async (cfg) => {
      const parts = (opts.part ?? []).map(parseDesignPart);
      if (parts.length === 0) throw new CliError('USAGE', '至少给一个 --part');
      const designed = await designViaPython(opts.board, parts);
      logInfo('circuit.design', { board: opts.board, ok: designed.ok, parts: parts.length });
      let written: Record<string, unknown> = {};
      if (opts.output && designed.ok && designed.board) {
        const payload = designToProject(designed);
        const saved = createProject(opts.output, payload, { force: cfg.force, dryRun: cfg.dryRun });
        written = writeMeta(saved);
      }
      printJson(
        envelope(
          'circuit.design',
          {
            ok: designed.ok,
            ...designed,
            ...written,
            ...(designed.ok
              ? {}
              : {
                  error_code: 'VALIDATION_FAILED',
                  message: designed.issues?.[0]?.message ?? designed.error,
                  error: designed.issues?.[0]?.message ?? designed.error,
                }),
          },
          cfg.dataSource,
        ),
      );
      if (!designed.ok) process.exit(EXIT_FAIL);
    });
  });
circuit
  .command('add')
  .requiredOption('-p, --project <vlx>')
  .requiredOption('--part <id>')
  .requiredOption('--id <id>')
  .option('--x <n>', 'x', (v) => Number(v))
  .option('--y <n>', 'y', (v) => Number(v))
  .option('--dry-run', '不写盘', false)
  .action((opts: { project: string; part: string; id: string; x?: number; y?: number }, cmd: Command) =>
    withCmd('circuit.add', cmd, (cfg) => {
      const saved = updateVlx(
        opts.project,
        (payload) => {
          addComponent(payload, opts);
        },
        { dryRun: cfg.dryRun, validate: true },
      );
      printJson(
        envelope(
          'circuit.add',
          { ok: true, id: opts.id, part: opts.part, ...writeMeta(saved) },
          cfg.dataSource,
        ),
      );
    }),
  );
circuit
  .command('wire')
  .requiredOption('-p, --project <vlx>')
  .requiredOption('--from <spec>', 'id:PIN')
  .requiredOption('--to <spec>', 'id:PIN')
  .option('--id <id>')
  .option('--color <hex>', '导线颜色', '#888888')
  .option('--allow-parallel', '允许相同端点的并行导线', false)
  .option('--dry-run', '不写盘', false)
  .action(
    (
      opts: {
        project: string;
        from: string;
        to: string;
        id?: string;
        color?: string;
        allowParallel?: boolean;
      },
      cmd: Command,
    ) =>
      withCmd('circuit.wire', cmd, (cfg) => {
        const saved = updateVlx(
          opts.project,
          (payload) => {
            addWire(payload, opts);
          },
          { dryRun: cfg.dryRun, validate: true },
        );
        printJson(
          envelope(
            'circuit.wire',
            { ok: true, from: opts.from, to: opts.to, ...writeMeta(saved) },
            cfg.dataSource,
          ),
        );
      }),
  );
circuit
  .command('list')
  .requiredOption('-p, --project <vlx>')
  .action((opts: { project: string }, cmd: Command) =>
    withCmd('circuit.list', cmd, (cfg) => {
      const listed = listCircuit(readVlx(opts.project));
      const body = envelope(
        'circuit.list',
        { ok: true, ...listed, count: listed.components.length },
        cfg.dataSource,
      );
      if (wantJson(cfg)) printJson(body);
      else printTable(listed.components, ['id', 'metadataId', 'x', 'y']);
    }),
  );
circuit
  .command('rm')
  .requiredOption('-p, --project <vlx>')
  .requiredOption('--id <id>')
  .action((opts: { project: string; id: string }, cmd: Command) =>
    withCmd('circuit.rm', cmd, (cfg) => {
      const saved = updateVlx(
        opts.project,
        (payload) => {
          removeComponent(payload, opts.id);
        },
        { dryRun: cfg.dryRun, validate: false },
      );
      logInfo('circuit.rm', { project: opts.project, id: opts.id });
      printJson(
        envelope('circuit.rm', { ok: true, id: opts.id, ...writeMeta(saved) }, cfg.dataSource),
      );
    }),
  );
circuit
  .command('unwire')
  .requiredOption('-p, --project <vlx>')
  .option('--id <id>')
  .option('--from <spec>', 'id:PIN')
  .option('--to <spec>', 'id:PIN')
  .action((opts: { project: string; id?: string; from?: string; to?: string }, cmd: Command) =>
    withCmd('circuit.unwire', cmd, (cfg) => {
      const saved = updateVlx(
        opts.project,
        (payload) => {
          removeWire(payload, opts);
        },
        { dryRun: cfg.dryRun, validate: false },
      );
      logInfo('circuit.unwire', { project: opts.project, id: opts.id, from: opts.from, to: opts.to });
      printJson(
        envelope(
          'circuit.unwire',
          { ok: true, id: opts.id, from: opts.from, to: opts.to, ...writeMeta(saved) },
          cfg.dataSource,
        ),
      );
    }),
  );
circuit
  .command('validate')
  .requiredOption('-p, --project <vlx>')
  .action((opts: { project: string }, cmd: Command) =>
    withCmd('circuit.validate', cmd, (cfg) => {
      const result = validateProject(readVlx(opts.project));
      logInfo('circuit.validate', {
        project: opts.project,
        ok: result.ok,
        issues: result.issues.length,
      });
      printJson(
        envelope(
          'circuit.validate',
          {
            ok: result.ok,
            issues: result.issues,
            ...(result.ok
              ? {}
              : { error_code: 'VALIDATION_FAILED', message: '电路校验失败', error: '电路校验失败' }),
          },
          cfg.dataSource,
        ),
      );
      process.exit(result.ok ? EXIT_OK : EXIT_FAIL);
    }),
  );

const code = program.command('code').description('板卡源文件');
code
  .command('set')
  .requiredOption('-p, --project <vlx>')
  .requiredOption('--file <name>')
  .option('--from <path>', '读取本地文件')
  .option('--content <text>', '直接写入文本')
  .option('--board <id>')
  .option('--dry-run', '不写盘', false)
  .action(
    (opts: { project: string; file: string; from?: string; content?: string; board?: string }, cmd: Command) =>
      withCmd('code.set', cmd, (cfg) => {
        const content = opts.from ? readFileSync(opts.from, 'utf8') : opts.content;
        if (content === undefined) {
          throw new CliError('MISSING_ARGUMENT', '需要 --from 或 --content');
        }
        const saved = updateVlx(
          opts.project,
          (payload) => {
            setCodeFile(payload, { file: opts.file, content, boardId: opts.board });
          },
          { dryRun: cfg.dryRun, validate: false },
        );
        printJson(
          envelope('code.set', { ok: true, file: opts.file, board: opts.board, ...writeMeta(saved) }, cfg.dataSource),
        );
      }),
  );
code
  .command('list')
  .requiredOption('-p, --project <vlx>')
  .option('--board <id>')
  .action((opts: { project: string; board?: string }, cmd: Command) =>
    withCmd('code.list', cmd, (cfg) => {
      const files = listCodeFiles(readVlx(opts.project), opts.board);
      const body = envelope('code.list', { ok: true, files }, cfg.dataSource);
      if (wantJson(cfg)) printJson(body);
      else printTable(files, ['name', 'bytes']);
    }),
  );
code
  .command('get')
  .requiredOption('-p, --project <vlx>')
  .requiredOption('--file <name>')
  .option('--board <id>')
  .action((opts: { project: string; file: string; board?: string }, cmd: Command) =>
    withCmd('code.get', cmd, (cfg) => {
      const file = getCodeFile(readVlx(opts.project), opts.file, opts.board);
      printJson(envelope('code.get', { ok: true, ...file }, cfg.dataSource));
    }),
  );

const kit = program.command('kit').description('模型组合（机构 + 装配 + 角色 BOM）');
kit.command('list').action(async (_opts: unknown, cmd: Command) =>
  withCmd('kit.list', cmd, async (cfg) => {
    const { kitListItems } = await import('./kit/apply.js');
    const items = kitListItems();
    const body = envelope('kit.list', { ok: true, count: items.length, items }, cfg.dataSource);
    if (wantJson(cfg)) printJson(body);
    else printTable(items, ['id', 'name', 'mechanismId']);
  }),
);
kit
  .command('detect')
  .requiredOption('-p, --project <vlx>')
  .action(async (opts: { project: string }, cmd: Command) =>
    withCmd('kit.detect', cmd, async (cfg) => {
      const { detectFromVlx } = await import('./kit/apply.js');
      const found = detectFromVlx(readVlx(opts.project));
      printJson(envelope('kit.detect', { ok: true, ...found }, cfg.dataSource));
    }),
  );
kit
  .command('apply')
  .requiredOption('-p, --project <vlx>')
  .requiredOption('--kit <id>')
  .option('--dry-run', '不写盘', false)
  .action(async (opts: { project: string; kit: string }, cmd: Command) =>
    withCmd('kit.apply', cmd, async (cfg) => {
      const { applyKitToVlx } = await import('./kit/apply.js');
      let added: string[] = [];
      let kitId = opts.kit;
      const saved = updateVlx(
        opts.project,
        (payload) => {
          const result = applyKitToVlx(payload, opts.kit);
          added = result.added;
          kitId = result.kit;
        },
        { dryRun: cfg.dryRun, validate: true },
      );
      printJson(
        envelope('kit.apply', { ok: true, kit: kitId, added, ...writeMeta(saved) }, cfg.dataSource),
      );
    }),
  );

const vap = program.command('vap').description('虚拟应用清单与健康');
vap.command('list').action((_opts: unknown, cmd: Command) =>
  withCmd('vap.list', cmd, (cfg) => {
    const items = vapList().map((a) => ({
      id: a.id,
      title: a.title,
      bind: a.bind,
      capabilities: a.capabilities.join(','),
      exampleIds: a.exampleIds.join(','),
    }));
    const body = envelope('vap.list', { ok: true, count: items.length, items }, cfg.dataSource);
    if (wantJson(cfg)) printJson(body);
    else printTable(items, ['id', 'title', 'bind', 'exampleIds']);
  }),
);
vap.command('show <id>').action((id: string, _opts: unknown, cmd: Command) =>
  withCmd('vap.show', cmd, (cfg) => {
    const item = vapShow(id);
    if (!item) throw new CliError('NOT_FOUND', `未找到应用 ${id}`, { id });
    printJson(envelope('vap.show', { ok: true, item }, cfg.dataSource));
  }),
);
vap.command('health').action(async (_opts: unknown, cmd: Command) =>
  withCmd('vap.health', cmd, async (cfg) => {
    const result = await vapHealth({ demo: cfg.mock });
    printJson(envelope('vap.health', result, cfg.dataSource));
    if (result.ok) process.exit(EXIT_OK);
    process.exit(cfg.mock ? EXIT_FAIL : EXIT_UNAVAILABLE);
  }),
);

program
  .command('studio')
  .description('综合窗口列可见性')
  .command('columns')
  .option('--example <id>', '示例 id')
  .option('-p, --project <vlx>')
  .action((opts: { example?: string; project?: string }, cmd: Command) =>
    withCmd('studio.columns', cmd, (cfg) => {
      if (!opts.example && !opts.project) {
        throw new CliError('MISSING_ARGUMENT', '需要 --example 或 -p');
      }
      const result = studioColumns({
        exampleId: opts.example,
        payload: opts.project ? readVlx(opts.project) : undefined,
      });
      printJson(envelope('studio.columns', { ok: true, ...result }, cfg.dataSource));
    }),
  );

program
  .command('3dm')
  .description('转发 3Dm 域 CLI（kits / fk / bom / generate …）')
  .argument('[args...]')
  .allowUnknownOption()
  .allowExcessArguments(true)
  .passThroughOptions()
  .helpOption(false)
  .action((_args: string[], _opts: unknown, cmd: Command) => {
    const cfg = ctx(cmd);
    forward3dm({ demo: cfg.mock, format: cfg.format, dataSource: cfg.dataSource });
  });

program
  .command('compile')
  .description('编译（Pi 返回 ready）')
  .requiredOption('-p, --project <vlx>')
  .action(async (opts: { project: string }, cmd: Command) => {
    await withCmd('compile', cmd, async (cfg) => {
      const result = await compileProject(readVlx(opts.project), {
        demo: cfg.mock,
        apiUrl: cfg.apiUrl,
        timeoutMs: cfg.timeoutMs,
      });
      logInfo('compile', { project: opts.project, status: result.status, reason: result.reason });
      const ok = result.status === 'ok' || result.status === 'ready';
      printJson(
        envelope(
          'compile',
          {
            ok,
            ...result,
            ...(ok
              ? {}
              : {
                  error_code: result.error_code ?? 'COMPILE_ERROR',
                  message: result.reason,
                  error: result.reason,
                }),
          },
          cfg.dataSource,
        ),
      );
      if (ok) process.exit(EXIT_OK);
      process.exit(result.error_code === 'UNAVAILABLE' ? EXIT_UNAVAILABLE : EXIT_FAIL);
    });
  });

const sim = program.command('sim').description('仿真（spice / qemu）');
sim
  .command('spice')
  .requiredOption('-p, --project <vlx>')
  .option('--drive <spec>', 'gpio=17:1,D13:1,...', '')
  .option('--assert <spec>', 'current:id>5mA | voltage:id>2V | abs:voltage:id>2V', collect, [] as string[])
  .option('--fixture <file>', 'demo 电流/电压 JSON 夹具')
  .action(
    async (
      opts: { project: string; drive: string; assert: string[]; fixture?: string },
      cmd: Command,
    ) => {
      const cfg = ctx(cmd);
      try {
        const drive = opts.drive ? parseDrive(opts.drive) : [];
        const asserts = (opts.assert ?? []).map(parseAssert);
        const result = await runSpice(readVlx(opts.project), {
          drive,
          asserts,
          demo: cfg.mock,
          fixture: opts.fixture,
        });
        printJson(envelope('sim.spice', { ...result }, cfg.dataSource));
        process.exit(result.ok ? EXIT_OK : EXIT_FAIL);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/wasm|ngspice/i.test(msg)) {
          fail(
            'sim.spice',
            new CliError('UNAVAILABLE', msg, undefined, EXIT_UNAVAILABLE),
            cfg.dataSource,
          );
        }
        fail('sim.spice', err, cfg.dataSource);
      }
    },
  );
sim
  .command('qemu')
  .description('树莓派虚拟机。带 -p 时真正启动；否则只报告是否可用')
  .option('-p, --project <vlx>', '要在虚拟机里运行的工程')
  .option('--duration <sec>', '进入系统后继续采集的秒数', '8')
  .option('--expect <text>', '日志里必须出现的文本，可重复', collect, [] as string[])
  .action(async (opts: { project?: string; duration: string; expect?: string[] }, cmd: Command) => {
    await withCmd('sim.qemu', cmd, async (cfg) => {
      if (!opts.project || cfg.mock) {
        const st = qemuStatus({ demo: cfg.mock });
        printJson(
          envelope(
            'sim.qemu',
            {
              ok: false,
              ...st,
              error_code: 'UNAVAILABLE',
              message: st.reason,
              error: st.reason,
            },
            cfg.dataSource,
          ),
        );
        process.exit(EXIT_UNAVAILABLE);
      }
      const g = gopts(cmd);
      const timeoutMs = g.timeout ? cfg.timeoutMs : Math.max(cfg.timeoutMs, 180_000);
      const request = projectExecRequest(readVlx(opts.project), {
        target: 'sim',
        duration_s: Number(opts.duration),
        expect: opts.expect,
      });
      logInfo('sim.qemu', { board: request.board });
      const result = await liveExec(request, { apiUrl: cfg.apiUrl, timeoutMs });
      const ok = result.success === true;
      printJson(envelope('sim.qemu', { ok, ...result, ...(ok ? {} : { message: result.error, error: result.error }) }, cfg.dataSource));
      process.exit(ok ? EXIT_OK : result.error_code === 'UNAVAILABLE' ? EXIT_UNAVAILABLE : EXIT_FAIL);
    });
  });

const exec = program.command('exec').description('硬件执行：仿真、ESP32 烧录、树莓派 SSH');

exec
  .command('run')
  .description('修改后的工程：编译 → 仿真 / 烧录 / SSH → 日志断言')
  .requiredOption('-p, --project <vlx>')
  .addOption(new Option('--target <target>', 'sim | esp32 | pi | jtag').choices(['sim', 'esp32', 'pi', 'jtag']).default('sim'))
  .option('--duration <sec>', '采集秒数', '5')
  .option('--expect <text>', '日志里必须出现的文本，可重复；re: 开头为正则', collect, [] as string[])
  .option('--port <port>', 'ESP32 串口')
  .option('--baud <n>', '串口波特率', '115200')
  .option('--serial <text>', '运行前写入串口的文本', '')
  .option('--host <host>', '树莓派主机')
  .option('--user <user>', 'SSH 用户', 'pi')
  .option('--identity <file>', 'SSH 私钥')
  .option('--remote-dir <dir>', '远端目录', '/tmp/velxio')
  .option('--start <cmd>', '远端启动命令')
  .option('--action <action>', 'pi: cycle | test | start | stop | logs', 'cycle')
  .action(async (opts, cmd: Command) => {
    await withCmd('exec.run', cmd, async (cfg) => {
      const g = gopts(cmd);
      const timeoutMs = g.timeout ? cfg.timeoutMs : Math.max(cfg.timeoutMs, 180_000);
      const request = projectExecRequest(readVlx(opts.project), {
        target: opts.target as ExecTarget,
        duration_s: Number(opts.duration),
        expect: opts.expect,
        port: opts.port,
        baud: Number(opts.baud),
        serial_input: opts.serial,
        host: opts.host,
        user: opts.user,
        identity: opts.identity,
        remote_dir: opts.remoteDir,
        start_cmd: opts.start,
        action: opts.action,
      });
      logInfo('exec.run', { target: request.target, board: request.board, demo: cfg.mock });
      const result = cfg.mock
        ? demoExec(request)
        : await liveExec(request, { apiUrl: cfg.apiUrl, timeoutMs });
      const ok = result.success === true;
      printJson(
        envelope(
          'exec.run',
          {
            ok,
            ...result,
            ...(ok
              ? {}
              : {
                  error_code: result.error_code ?? 'ASSERT_FAILED',
                  message: result.error,
                  error: result.error,
                }),
          },
          cfg.dataSource,
        ),
      );
      if (ok) process.exit(EXIT_OK);
      const code = String(result.error_code ?? '');
      process.exit(code === 'UNAVAILABLE' || code === 'TIMEOUT' || code === 'CONNECTION_REFUSED' ? EXIT_UNAVAILABLE : EXIT_FAIL);
    });
  });

exec
  .command('boundary')
  .description('查看编译/仿真与 USB 的部署边界')
  .action(async (_opts, cmd: Command) => {
    await withCmd('exec.boundary', cmd, async (cfg) => {
      if (cfg.mock) {
        printJson(
          envelope(
            'exec.boundary',
            {
              ok: true,
              hardware_local: true,
              usb: 'local-executor',
              compile_and_sim: 'container-or-remote',
              jtag: 'not-implemented',
            },
            cfg.dataSource,
          ),
        );
        return;
      }
      const res = await fetch(`${cfg.apiUrl}/api/exec/boundary`);
      const body = (await res.json()) as Record<string, unknown>;
      printJson(envelope('exec.boundary', { ok: res.ok, ...body }, cfg.dataSource));
      if (!res.ok) process.exit(EXIT_UNAVAILABLE);
    });
  });

exec
  .command('diagnose')
  .description('查看最近一次真机结果、电平和简短诊断')
  .option('--host <host>', '树莓派地址')
  .option('--port <port>', 'ESP32 串口，用于对应最近任务')
  .option('--user <user>', 'SSH 用户', 'pi')
  .option('--command <cmd>', '在树莓派上额外执行的一条命令')
  .action(async (opts: { host?: string; port?: string; user: string; command?: string }, cmd: Command) => {
    await withCmd('exec.diagnose', cmd, async (cfg) => {
      if (cfg.mock) {
        printJson(
          envelope(
            'exec.diagnose',
            { ok: true, summary: 'demo 诊断：没有真机故障', hints: [], gpio_high: [] },
            cfg.dataSource,
          ),
        );
        return;
      }
      if (!opts.host && !opts.port) {
        throw new CliError('USAGE', '需要 --host 或 --port');
      }
      const token = process.env.VELXIO_EXEC_TOKEN ?? '';
      const res = await fetch(`${cfg.apiUrl}/api/exec/diagnose`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          host: opts.host,
          port: opts.port,
          user: opts.user,
          command: opts.command,
        }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      const detail = (body.detail && typeof body.detail === 'object' ? body.detail : body) as Record<string, unknown>;
      printJson(envelope('exec.diagnose', { ok: res.ok && detail.success !== false, ...detail }, cfg.dataSource));
      if (!res.ok || detail.success === false) process.exit(EXIT_FAIL);
    });
  });

const device = program.command('device').description('ESP32 设备通道，默认 Wi-Fi；USB 需显式选择');
device.command('voice')
  .addOption(new Option('--button-route <service>', 'BOOT 按键语音服务').choices(['agentcenter', 'doubao']).makeOptionMandatory())
  .action(async (opts, cmd: Command) => {
    await withCmd('device.voice', cmd, async (cfg) => {
      if (cfg.mock) throw new CliError('UNAVAILABLE', '语音路由仅支持真实设备', undefined, EXIT_UNAVAILABLE);
      const res = await fetch(`${cfg.apiUrl}/api/exec/esp32/voice-route`, {
        method: 'POST', signal: AbortSignal.timeout(Math.max(cfg.timeoutMs, 10000)),
        headers: { 'Content-Type': 'application/json', ...(process.env.VELXIO_EXEC_TOKEN ? { Authorization: `Bearer ${process.env.VELXIO_EXEC_TOKEN}` } : {}) },
        body: JSON.stringify({ route: opts.buttonRoute }),
      });
      const body = await res.json() as Record<string, unknown>;
      const ok = res.ok && body.success === true;
      printJson(envelope('device.voice', { ...body, ok }, cfg.dataSource));
      if (!ok) process.exit(EXIT_FAIL);
    });
  });
device.command('wifi', { isDefault: true })
  .addOption(new Option('--action <action>', 'status | volume | brightness').choices(['status', 'volume', 'brightness']).default('status'))
  .option('--value <number>', '音量或亮度，0–100')
  .action(async (opts, cmd: Command) => {
    await withCmd('device.wifi', cmd, async (cfg) => {
      if (cfg.mock) throw new CliError('UNAVAILABLE', 'Wi-Fi 通道仅支持真实设备', undefined, EXIT_UNAVAILABLE);
      const value = opts.value === undefined ? undefined : Number(opts.value);
      if ((opts.action === 'status' && value !== undefined) ||
          (opts.action !== 'status' && (value === undefined || !Number.isInteger(value) || value < 0 || value > 100))) {
        throw new CliError('USAGE', 'status 无需 value；volume/brightness 需要 0–100 的整数 value');
      }
      const res = await fetch(`${cfg.apiUrl}/api/exec/esp32/wifi`, {
        method: 'POST', signal: AbortSignal.timeout(Math.max(cfg.timeoutMs, 25000)),
        headers: { 'Content-Type': 'application/json', ...(process.env.VELXIO_EXEC_TOKEN ? { Authorization: `Bearer ${process.env.VELXIO_EXEC_TOKEN}` } : {}) },
        body: JSON.stringify({ action: opts.action, value }),
      });
      const body = await res.json() as Record<string, unknown>;
      const ok = res.ok && body.success === true;
      printJson(envelope('device.wifi', { ...body, ok }, cfg.dataSource));
      if (!ok) process.exit(EXIT_FAIL);
    });
  });
device.command('usb')
  .requiredOption('--port <port>')
  .addOption(new Option('--action <action>', 'observe | restart').choices(['observe', 'restart']).default('observe'))
  .option('--duration <seconds>', '采集秒数，1–30', '15')
  .action(async (opts, cmd: Command) => {
    await withCmd('device.usb', cmd, async (cfg) => {
      const duration = Number(opts.duration);
      if (!Number.isFinite(duration) || duration < 1 || duration > 30) throw new CliError('USAGE', 'duration 必须为 1–30 秒');
      if (cfg.mock) throw new CliError('UNAVAILABLE', '设备通道仅支持真实设备', undefined, EXIT_UNAVAILABLE);
      const res = await fetch(`${cfg.apiUrl}/api/exec/esp32/channel`, {
        method: 'POST', signal: AbortSignal.timeout(Math.max(cfg.timeoutMs, (duration + 10) * 1000)),
        headers: { 'Content-Type': 'application/json', ...(process.env.VELXIO_EXEC_TOKEN ? { Authorization: `Bearer ${process.env.VELXIO_EXEC_TOKEN}` } : {}) },
        body: JSON.stringify({ port: opts.port, action: opts.action, duration_s: duration }),
      });
      const body = await res.json() as Record<string, unknown>;
      const result = typeof body.detail === 'object' && body.detail !== null ? body.detail as Record<string, unknown> : body;
      const ok = res.ok && result.success === true;
      printJson(envelope('device.usb', { ...result, ok }, cfg.dataSource));
      if (!ok) process.exit(EXIT_FAIL);
    });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const code = (err as { code?: string }).code;
  if (
    code === 'commander.helpDisplayed' ||
    code === 'commander.help' ||
    code === 'commander.version'
  ) {
    if (commanderErr) process.stderr.write(commanderErr);
    process.exit(EXIT_OK);
  }
  fail('cli', commanderToCliError(err, commanderErr), peekSource());
});
