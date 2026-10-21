# Velxio CLI

功能现状、待优化问题、优先级与分阶段验收见 [CLI 升级计划](cli-upgrade-plan.md)（2026-09-16）。M1（CLI-01 至 CLI-05）已落地；拟议的 `sim run` / `project apply` / `capabilities` 仍未实现。

Velxio 系统的命令行入口（模板 6）：查元件/板型、读写 `.vlx`、Kit 补缺件、VAP/Studio 查询、写代码、编译、SPICE 断言。画布仍在 Web，CLI 不点编辑器。`start.sh` 仍管进程。

任意电路走同一条管线：`example export` / `project init` → `circuit` → `kit apply` → `code` → `compile --demo`。四轮小车只是回归夹具之一。

## 原则

- 数据走 stdout（`--format json`），日志走 stderr（`--verbose` 才打 info）。
- `--demo` / `VELXIO_MOCK_MODE=true` 可离线验收（不加载 ngspice WASM，不要求 8001）。
- 电路唯一 IR 是 `.vlx`（`format: velxio-project`）。
- Pi 族编译返回 `no compilation needed`。`sim qemu` 在 OSS 中 exit 2。
- `3dm` 域 CLI 信封相同；系统入口用 `velxio 3dm …` 转发。
- 配置优先级：CLI 参数 > `VELXIO_*` > `.env` > 默认。

## 信封与退出码

机器模式错误为 JSON，含 `protocol`（当前为 1）、`error_code`、`message`；`error` 与 `message` 同值以便旧脚本。帮助文本仍是普通文本。

| 退出码 | 含义 |
|--------|------|
| 0 | 成功 |
| 1 | 用法、板卡/接线、断言或业务失败 |
| 2 | 后端、求解器或依赖不可用 |

`--format` 只接受 `json` 或 `table`。`--api-url`、`--timeout`（如 `30s`）覆盖环境变量。写入类命令支持 `--dry-run`；覆盖已有文件需 `--force`。

## 常用命令

```bash
cd cli
./bin/velxio --demo doctor
./bin/velxio doctor --probe          # Mock 下仍探测真实端口
./bin/velxio parts list --category motors --format json
./bin/velxio boards list --format json
./bin/velxio example list --query blink --format json
./bin/velxio example export blink-led -o /tmp/blink.vlx --force
./bin/velxio project init --board arduino-uno -o /tmp/uno.vlx --dry-run
./bin/velxio circuit validate -p /tmp/div.vlx --format json
./bin/velxio kit list --format json
./bin/velxio kit apply -p /tmp/arm.vlx --kit arm-3dof
./bin/velxio vap list --format json
./bin/velxio studio columns --example esp32cam-ai-arm --format json
./bin/velxio compile -p /tmp/blink.vlx --demo --format json
./bin/velxio sim spice -p /tmp/div.vlx --assert voltage:vm>2V --format json
./bin/velxio 3dm kits
./bin/velxio 3dm fk --mech arm-3dof --q 'sv_base=90,sv_shld=90,sv_elbw=90'
```

`--drive` 支持 `gpio=17:1`、`D13:HIGH`、`GPIO5:0`。`--assert` 默认保留符号，支持负数和科学计数法；幅值用 `abs:voltage:vm>2V`。电压/电流单位必须匹配。`solved` 仅在真实 ngspice 成功时为 true；Demo 为 `mode=fixture` 或 `netlist-only`。

显式 `--board` 不存在会失败，不会写到另一块板。重复接线返回 `WIRE_EXISTS`；并行导线需 `--allow-parallel`。

从空白工程绘制 AI 视觉机械臂（ESP32-CAM + 4 舵机 + 锁定 LED）：

```bash
cli/scripts/draw-ai-vision-arm.sh
```

画布点 Camera 后，固件用肤色质心偏差驱动基座/肩肘跟随人脸。修好的电路：

http://127.0.0.1:5173/example/esp32cam-ai-arm

导出 ESP32 AI 对话机器人（OLED + 按键 + 声传感器 + 蜂鸣器，默认 Mock）：

```bash
cli/scripts/draw-ai-chat-bot.sh
```

Serial 输入一行即对话；`MODE live` 才走 WiFi HTTP。电路：

http://127.0.0.1:5173/example/esp32-ai-chat

Pi 5 三轴机械摆臂（gpiozero AngularServo，默认 demo 摆臂）：

```bash
cli/scripts/draw-pi5-3dof-arm.sh
```

http://127.0.0.1:5173/example/pi5-3dof-arm

## 验收

```bash
cli/scripts/verify.sh
```

日志写入 `cli/logs/verify.log`。报告含 passed / failed / skipped 与分层（offline、spice-live、compile-live、run-live）。依赖缺失计 skipped，不记为通过。
