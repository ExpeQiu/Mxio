---
name: velxio-hard-design
description: >
  Designs simulatable Velxio hardware: catalog-first parts/boards lookup,
  substitute wish-list I/O to OSS catalog, same-law firmware (Mock First,
  Arduino core-only), .vlx gallery delivery. Use when the user mentions
  Velxio 硬件、画电路、接线、元件选型、ESP32 示例、对话机器人、视觉臂、
  仿真可跑、.vlx、图库，or asks to add a board+parts project in Velxio.
version: "0.1.0"
owner: coder
id: "skill-velxio-hard-design-2026"
trigger: model
---

# Velxio 硬件设计

仓：`/Volumes/Lexar/git/11 IOT/velxio`。CLI 命令细节见仓内 `cli/SKILL.md`。架构开仓走 `expe-architecture-guide`（硬件示例默认 **模板 6** 挂 Velxio 图库，管道按 **模板 1**）。

目标：仿真与真机同一条 **same-law** 状态机；零件只从 OSS 目录 **substitute**，真机再换外设。

```
Task Progress:
- [ ] 1. Clarify：板型 / 管道 / 非目标 / DoD=validate+demo compile
- [ ] 2. Catalog-first：parts / boards / example list
- [ ] 3. Substitute：愿望清单 → 现有元件与引脚
- [ ] 4. Same-law 固件：Mock First、core-only
- [ ] 5. 接线 .vlx：无连字符 id、LED 串电阻、引脚名对齐已有示例
- [ ] 6. 图库交付：sketch + examples-*.ts + draw.sh + ADR + verify
- [ ] 7. 编译闭环：--demo 通过后再 live；失败按 [reference.md](reference.md) 修
```

## 1. Clarify

写清四件事再画线：

| 项 | 完成标准 |
|----|----------|
| 板型 | OSS QEMU 可跑（`esp32` / `esp32-cam` / `esp32-c3`…），对照 `velxio boards list` |
| 管道 | 采集 → 处理 → 展示 一句话（例：Serial/麦 → THINK → 蜂鸣+OLED） |
| 非目标 | 新 I2S 元件、端侧 Whisper、独立 Web 对话仓 |
| DoD | `circuit validate` `"ok": true` 且 `compile --demo` `"status": "ok"` |

## 2. Catalog-first

先查再画。在 `cli/`：

```bash
./bin/velxio --format json parts list --query <词>
./bin/velxio --format json parts show <id>
./bin/velxio --format json boards list
./bin/velxio --format json example list --board esp32 --query <词>
./bin/velxio --format json kit list
./bin/velxio kit apply -p x.vlx --kit arm-3dof
./bin/velxio 3dm bom --kit arm-3dof --ids sv_base,sv_shld
```

完成标准：每个外设都有 **metadataId** 和已有示例里的 **pinName**。未知引脚先补 `cli/src/catalog/index.ts` 的 `FALLBACK_PINS`。

## 3. Substitute

愿望清单映射见 [reference.md](reference.md)。原则：仿真里能产生/消耗 GPIO·I2C·ADC·PWM 的零件优先；Serial 可代替 ASR。

完成标准：一张表，列「角色 / 元件 id / 板引脚 / 真机可替换件」。

## 4. Same-law 固件

- 默认 `AI_MOCK_MODE 1`；`MODE live` 才 `WiFi.begin("Velxio-GUEST")` + HTTP。Key 只经 Serial。
- **core-only**：只用板核心（`Wire` / `WiFi` / `HTTPClient` / `ESP32Servo` 已验证者）。用户 `~/Arduino/libraries` 旧 AVR 库会拖进 ESP-IDF。
- 日志带 `turn_id` / `state` / `mock`（或同类业务键）。
- ADC 声传感器用 **相对阈值**（基线 + delta），不用绝对峰值。

完成标准：无 Adafruit_SSD1306 / Adafruit_GFX；OLED 用 `Wire` 直驱 0x3C。

## 5. 接线

- 实例 id：`oled` `btn` `rled`（**禁止连字符**）。示例 id 可以有：`esp32-ai-chat`。
- LED：`GPIO → 220Ω → A`，`C → GND`。
- 按键：`GPIO → 1.l`，`2.l → GND`，`INPUT_PULLUP`。
- ESP32 I2C：SDA=`21` SCL=`22` VCC=`3V3`。
- 元件放 `examples-*.ts`，用 `velxio-` / `wokwi-` tag；`exampleToVlx` 会去掉前缀。

完成标准：`velxio circuit validate -p x.vlx` 无 error。

## 6. 图库交付

对照标杆：`esp32cam-ai-arm`、`esp32-ai-chat`。

| 文件 | 作用 |
|------|------|
| `frontend/src/data/sketches/<id>.ino` | 固件真源（`?raw`） |
| `frontend/src/data/examples-<slug>.ts` | 板、元件、线、`libraries: []` |
| `frontend/src/data/examples.ts` | import + 写入 `legacyExamples` |
| `frontend/src/__tests__/<id>.test.ts` | 接线与「无违禁库」断言 |
| `cli/scripts/draw-<id>.sh` | export + validate + `--demo` compile，写 `cli/logs/` |
| `cli/fixtures/<id>.vlx` | IR 夹具 |
| `cli/scripts/verify.sh` | 增加 export/validate/compile 检查 |
| `ADR/ADR-NNN-*.md` | 板型、substitute、Mock、非目标 |
| `guide/<id>.md` | 打开 URL 与 Serial 用法 |

`draw-*.sh` 模板拷 `cli/scripts/draw-ai-chat-bot.sh`。改完 sketch 后 **重新打开** `/example/<id>`（编辑器会留旧稿）。

完成标准：`cli/scripts/verify.sh` 通过。

## 7. 编译失败

正向处理：

1. 日志里路径若在 `Documents/Arduino/libraries/` → 去掉该库，改 core-only。
2. `util/delay.h` → AVR 库进了 ESP32；删 `#include` 与 `libraries` 清单。
3. Live 编译前先 `--demo`。QEMU 不可用时 `sim qemu` 预期 exit 2。

细节与引脚表：[reference.md](reference.md)。
