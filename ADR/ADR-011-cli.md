# ADR-011：Velxio 标准 CLI

- 状态：已采纳（2026-09-16 增补：全仓 Agent 入口；同日 M1 可靠性基线）
- 日期：2026-08-18
- 模板：6（CLI 工具集），规范对齐 `15CLI/CLI标准.md`
- 参考仓：`/Volumes/Lexar/git/15CLI/po-monitor-CLI`

## 决策

1. **入口命令**：`velxio`（仓内 `cli/`，`cli/package.json` bin）。Agent/终端对整仓只走这一条。
2. **电路 IR**：`.vlx` / `VlxPayload`（`format: velxio-project`），与编辑器导出同一契约。
3. **语言**：TypeScript + Commander，而不是 Python Click。元件表、接线、ngspice Node 适配器均在前端 TS 中；第三期 `sim spice` 必须复用它们。
4. **配置**：CLI 参数 > `VELXIO_*` 环境变量 > `.env` > 默认（`VELXIO_API_URL=http://127.0.0.1:8001`）。已提供 `--api-url`、`--timeout`。
5. **Mock**：`--demo` 与 `VELXIO_MOCK_MODE=true` 等价，二者都不得启动真实编译或 ngspice。`verify.sh` 不依赖 QEMU 镜像。`doctor --demo` 为纯离线结果；`--probe` 才探测真实环境。
6. **主仓**：velxio monorepo 的 `cli/`，不新建 `15CLI/velxio-CLI`。
7. **通用入口**：CLI 对接元件表、板型、示例图库、任意 `.vlx`、Kit/运动查询、VAP 清单与探活。个案（如 `pi5-4wd-car`）只作回归夹具。
8. **域 CLI**：`3Dm/bin/3dm` 保留给 [`3Dm/verify.sh`](../3Dm/verify.sh)；信封与 `velxio` 相同。`velxio 3dm …` 薄转发，不复制运动学。
9. **运维脚本**：[`start.sh`](../start.sh) / [`stop.sh`](../stop.sh) / 根 [`verify.sh`](../verify.sh) 仍管 venv、端口、子包验收。CLI 的 `doctor` 只探活，不拉起进程。

## 信封

stdout 是数据，stderr 是 JSON 日志。默认 `--format json`（非 TTY 亦 json）。

| 字段 | 含义 |
|------|------|
| `module` | 点分名，如 `circuit.validate` / `3dm.fk` / `vap.health` |
| `version` | CLI 版本 |
| `protocol` | 信封协议版本，当前为 `1` |
| `data_source` | `live` 或 `demo` |
| `fetched_at` | ISO 时间 |
| `ok` | 是否成功 |
| `error_code` | 失败时的稳定码（如 `BOARD_NOT_FOUND`） |
| `message` | 失败说明；`error` 与其同值，兼容旧脚本 |

全局旗标：`--format json|table`、`--demo`、`--verbose`、`--force`、`--dry-run`、`--api-url`、`--timeout`。非法 `--format` 失败。`--verbose` 控制 stderr info 日志。

工程写入走同目录临时文件 + 原子替换；已有文件需 `--force`；并发用摘要比对，冲突返回 `CONFLICT`。失败不截断原文件。

SPICE 断言默认保留符号。旧脚本若依赖 `Math.abs`，改为 `abs:voltage:id>2V` 或 `abs:current:id>5mA`。

## 退出码

| 码 | 含义 |
|----|------|
| 0 | 成功（含校验通过、编译 ready、`doctor --demo`） |
| 1 | 用法错误或电路/断言失败 |
| 2 | 后端、求解器或依赖不可用（含 `qemu_unavailable`、live `doctor` 打不到 8001） |

## 命令地图

系统入口 `velxio`：

- 探活：`doctor`、`version`
- 目录：`parts`、`boards`、`example`
- 工程：`project init|show`、`circuit add|wire|list|rm|unwire|validate`、`code set|get|list`
- 编译仿真：`compile`、`sim spice|qemu`
- 运动：`kit list|apply|detect`；`3dm <subcommand>` 转发
- 应用：`vap list|show|health`、`studio columns`

## 真源

CLI 只做 Commander 适配与信封。禁止在 `cli/src` 再写一份 Kit/BOM/VAP 注册表。

- 元件表：frontend catalog
- Kit / FK：`3Dm/src/core`
- VAP 清单：`AppS/web/registry.ts`
- Studio 列：`center/web/layout.ts`；补缺件草稿：`center/web/applyBom.ts`

## 非目标

- 用 Playwright 点画布 / Monaco
- 在 CLI 里重绘元件图形
- 把 `sim qemu` 伪装成 Pi 5 已能跑 `script.py`
- 把 `start.sh` 进程管理搬进 Node
- CLI 往运行中的仿真灌 Serial（那是编辑器 HostBridge，见 ADR-014）
