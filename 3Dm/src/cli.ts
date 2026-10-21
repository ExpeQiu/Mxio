#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { Command } from 'commander';
import { actuatorBus } from './core/bus.js';
import { assemblyFromBinds, bindMechanism, parseBindSpec } from './core/assemble.js';
import { listAssemblyIds, loadAssembly } from './core/assembly-catalog.js';
import { forwardKinematics } from './core/kinematics.js';
import { log, setRunId } from './core/log.js';
import { inferKind } from './core/actuator-info.js';
import { detectKitId, listKits, loadKit, missingBom, suggestBinds } from './core/kit.js';
import { generateMechanism } from './core/generate.js';
import { detectMechanismId, listMechanismIds, loadMechanism } from './core/mechanism.js';
import { playMockSync } from './core/mock.js';
import type { ActuatorPose, MechanismDef } from './core/types.js';
import {
  EXIT_FAIL,
  EXIT_OK,
  die,
  envelope,
  printJson,
  printTable,
} from './output.js';

const DEFAULT_MECH = process.env.VELXIO_3DM_MECH ?? '4dof-arm';

interface GlobalOpts {
  format?: string;
  demo?: boolean;
}

function gopts(cmd: Command): GlobalOpts {
  return cmd.optsWithGlobals() as GlobalOpts;
}

function source(_demo: boolean | undefined): 'live' | 'demo' {
  return 'demo';
}

function wantJson(cmd: Command): boolean {
  const f = gopts(cmd).format;
  if (f === 'table') return false;
  return true;
}

function parseQ(spec: string): ActuatorPose[] {
  if (!spec) return [];
  return spec.split(',').map((part) => {
    const [id, raw] = part.split('=');
    if (!id || raw === undefined) throw new Error(`无效 --q: ${part}`);
    const kind = id.startsWith('m_') ? 'dc-motor' : id.startsWith('stp') ? 'stepper' : 'servo';
    return { id: id.trim(), kind, q: Number(raw), t_ns: 0 };
  });
}

function resolveMech(opts: { mech: string; assembly?: string; bind?: string }): MechanismDef {
  let mech = loadMechanism(opts.mech);
  if (opts.bind) {
    mech = bindMechanism(mech, assemblyFromBinds(opts.mech, parseBindSpec(opts.bind)));
  } else if (opts.assembly) {
    mech = bindMechanism(mech, loadAssembly(opts.assembly));
  }
  return mech;
}

const program = new Command();
program
  .name('3dm')
  .description('Velxio 三维运动：执行器轨迹 dump / 正解 FK')
  .option('--demo', 'Mock 回放', false)
  .option('--format <fmt>', 'json | table', 'json');

program
  .command('mechs')
  .description('列出内置机构')
  .action((_opts: unknown, cmd: Command) => {
    const demo = gopts(cmd).demo;
    const items = listMechanismIds().map((id) => {
      const m = loadMechanism(id);
      return { id: m.id, name: m.name, kind: m.kind, joints: m.joints.length };
    });
    const body = envelope('3dm.mechs', { ok: true, items }, source(demo));
    if (wantJson(cmd)) printJson(body);
    else printTable(items, ['id', 'name', 'kind', 'joints']);
  });

program
  .command('dump')
  .description('P0：Mock 回放并输出关节轨迹')
  .option('--mech <id>', '机构 id', DEFAULT_MECH)
  .option('-o, --out <file>', '写入 JSON')
  .option('--duration <ms>', '时长毫秒', (v) => Number(v), 2000)
  .action((opts: { out?: string; duration: number; mech: string }, cmd: Command) => {
    setRunId(`3dm-dump-${Date.now().toString(36)}`);
    const mech = loadMechanism(opts.mech);
    actuatorBus.clear();
    const traj = playMockSync(mech, { durationMs: opts.duration, hz: 20 });
    const qs = traj.filter((p) => p.id === traj[0]?.id).map((p) => p.q);
    const extra = {
      ok: true,
      mech: mech.id,
      count: traj.length,
      actuators: [...new Set(traj.map((p) => p.id))],
      qMin: Math.min(...qs),
      qMax: Math.max(...qs),
      trajectory: traj,
    };
    const body = envelope('3dm.dump', extra, source(gopts(cmd).demo));
    const text = JSON.stringify(body, null, 2);
    if (opts.out) writeFileSync(opts.out, text);
    process.stdout.write(text + '\n');
    if (!(extra.qMax >= 170 && extra.qMin <= 10)) {
      log.error('dump.range', { phase: 'p0', qMin: extra.qMin, qMax: extra.qMax });
      process.exit(EXIT_FAIL);
    }
    process.exit(EXIT_OK);
  });

program
  .command('fk')
  .description('P2：给定关节量输出末端位姿（可叠加装配）')
  .option('--mech <id>', '机构 id', DEFAULT_MECH)
  .option('--assembly <id>', '装配 id')
  .option('--bind <spec>', '元件=关节,元件=关节')
  .option('--q <spec>', 'id=deg,id=deg', '')
  .action((opts: { q: string; mech: string; assembly?: string; bind?: string }, cmd: Command) => {
    const mech = resolveMech(opts);
    const poses = parseQ(opts.q);
    const fk = forwardKinematics(mech, poses);
    log.info('fk', { phase: 'p2', mech_id: mech.id, ee: fk.ee?.xyz });
    printJson(
      envelope(
        '3dm.fk',
        {
          ok: true,
          mech: mech.id,
          ee: fk.ee,
          joints: fk.joints,
          binds: mech.joints.map((j) => ({ joint: j.id, component: j.componentId, qScale: j.qScale ?? 1 })),
          links: Object.fromEntries(Object.entries(fk.links).map(([id, p]) => [id, p.xyz])),
        },
        source(gopts(cmd).demo),
      ),
    );
  });

program
  .command('assemblies')
  .description('列出装配')
  .option('--mech <id>', '按机构过滤')
  .action((opts: { mech?: string }, cmd: Command) => {
    const items = listAssemblyIds(opts.mech).map((id) => {
      const a = loadAssembly(id);
      return { id: a.id, name: a.name, mechanismId: a.mechanismId, mounts: a.mounts.length };
    });
    const body = envelope('3dm.assemblies', { ok: true, items }, source(gopts(cmd).demo));
    if (wantJson(cmd)) printJson(body);
    else printTable(items, ['id', 'name', 'mechanismId', 'mounts']);
  });

program
  .command('assemble')
  .description('把元件绑到关节，打印装配后的驱动表')
  .option('--mech <id>', '机构 id', DEFAULT_MECH)
  .option('--assembly <id>', '内置装配 id')
  .option('--bind <spec>', '元件=关节,...')
  .action((opts: { mech: string; assembly?: string; bind?: string }, cmd: Command) => {
    if (!opts.assembly && !opts.bind) {
      die(
        EXIT_FAIL,
        envelope('3dm.assemble', { ok: false, error: '需要 --assembly 或 --bind' }, source(gopts(cmd).demo)),
      );
    }
    const mech = resolveMech(opts);
    const binds = mech.joints.map((j) => ({
      joint: j.id,
      component: j.componentId,
      qOffsetDeg: j.qOffsetDeg ?? 0,
      qScale: j.qScale ?? 1,
    }));
    printJson(envelope('3dm.assemble', { ok: true, mech: mech.id, binds }, source(gopts(cmd).demo)));
  });

program
  .command('kits')
  .description('列出模型组合（机构 + 默认装配 + 角色）')
  .action((_opts: unknown, cmd: Command) => {
    const items = listKits().map((k) => ({
      id: k.id,
      name: k.name,
      mechanismId: k.mechanismId,
      assemblyId: k.assemblyId,
      roles: k.roles.map((r) => r.role),
    }));
    const body = envelope('3dm.kits', { ok: true, items }, source(gopts(cmd).demo));
    if (wantJson(cmd)) printJson(body);
    else printTable(items, ['id', 'name', 'mechanismId']);
  });

program
  .command('suggest')
  .description('按角色把画布执行器绑到 Kit 关节')
  .requiredOption('--kit <id>', '模型组合 id')
  .option('--ids <csv>', '元件 id 列表')
  .action((opts: { kit: string; ids?: string }, cmd: Command) => {
    const kit = loadKit(opts.kit);
    const actuators = (opts.ids ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => ({ id, kind: inferKind(id) }));
    const result = suggestBinds(kit, actuators);
    printJson(envelope('3dm.suggest', { ok: true, kit: kit.id, ...result }, source(gopts(cmd).demo)));
  });

program
  .command('detect')
  .option('--ids <csv>', '元件 id 列表')
  .action((opts: { ids?: string }, cmd: Command) => {
    const ids = (opts.ids ?? '').split(',').filter(Boolean);
    const id = detectMechanismId(ids);
    const kit = detectKitId(ids);
    printJson(envelope('3dm.detect', { ok: true, id, kit, ids }, source(gopts(cmd).demo)));
  });

program
  .command('generate')
  .description('参数化生成机构（串联臂 / 轮式 / 四足 / 人形）')
  .requiredOption('--kind <k>', 'serial | wheeled | quadruped | humanoid')
  .option('--n <n>', '关节数或轮数', (v) => Number(v))
  .option('--legs <n>', '腿数', (v) => Number(v))
  .option('--dof <n>', '每腿轴数', (v) => Number(v))
  .action((opts: { kind: string; n?: number; legs?: number; dof?: number }, cmd: Command) => {
    const kind = opts.kind as 'serial' | 'wheeled' | 'quadruped' | 'humanoid';
    const g = generateMechanism({
      kind,
      n: opts.n,
      legs: opts.legs,
      dofPerLeg: opts.dof,
    });
    printJson(
      envelope(
        '3dm.generate',
        {
          ok: true,
          kit: g.kit.id,
          name: g.kit.name,
          kind: g.mechanism.kind,
          joints: g.mechanism.joints.map((j) => j.id),
          roles: g.kit.roles.map((r) => r.role),
          aliases: g.kit.roles.map((r) => r.aliases[0]),
        },
        source(gopts(cmd).demo),
      ),
    );
  });

program
  .command('bom')
  .description('列出 Kit 相对画布元件的缺件')
  .requiredOption('--kit <id>', '模型组合 id')
  .option('--ids <csv>', '已有元件 id')
  .action((opts: { kit: string; ids?: string }, cmd: Command) => {
    const kit = loadKit(opts.kit);
    const ids = (opts.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const actuators = ids.map((id) => ({ id, kind: inferKind(id) }));
    const parts = missingBom(kit, actuators, ids);
    printJson(envelope('3dm.bom', { ok: true, kit: kit.id, parts }, source(gopts(cmd).demo)));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  log.error('cli', { error: String(err) });
  die(EXIT_FAIL, envelope('3dm', { ok: false, error: String(err) }));
});
