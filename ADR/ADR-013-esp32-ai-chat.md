# ADR-013：ESP32 AI 对话机器人（Velxio 图库）

- 状态：已采纳
- 日期：2026-08-18
- 模板：**6（CLI 工具集）** 托管交付；对话链路按 **模板 1** 分层：采集 → 管道 → 展示
- 参考：`/Volumes/Lexar/git/11 IOT/velxio/cli`、图库 `esp32cam-ai-arm`；不新建 15CLI 仓

## 背景

要在 Velxio 上做可仿真的 ESP32 对话机器人。OSS 元件表没有 I2S 麦/功放；QEMU 也跑不了端侧 ASR/TTS。必须用现有零件走通同一条状态机，真机再换音频前端。

## 选项

| # | 选项 | 结论 |
|---|------|------|
| A | 新仓 + Next 对话 UI | 产品不是 Web；拒绝 |
| B | 模板 2 场景合同 / 四专家类 | 固件状态机不是 Hermes 主控；拒绝 |
| C | 挂在 Velxio 图库 + CLI `.vlx`（本决策） | 与视觉臂同一交付面 |

## 决策

1. **板型**：ESP32 DevKit（OSS QEMU 可跑），不是 ESP32-CAM。
2. **仿真 I/O**：声音传感器 = 麦；蜂鸣器 = 嘴；SSD1306 = 状态；按键 = 按住说话；Serial = 文本 ASR。
3. **Mock First**：默认 `AI_MOCK_MODE=1`，板内关键词回复。`MODE live` 才走 `Velxio-GUEST` + OpenAI 兼容 HTTP。Key 只经 Serial，不进仓库。
4. **交付**：示例 id `esp32-ai-chat`；IR 由 `cli/scripts/draw-ai-chat-bot.sh` 导出。
5. **非目标**：端侧 Whisper/TTS、I2S 新元件、独立对话中台。
6. **OLED 驱动**：板内 `Wire` 直驱 SSD1306，**不**用 Adafruit_SSD1306。本机 `~/Arduino/libraries` 里旧版库会无条件 `#include <util/delay.h>`（AVR only），ESP-IDF 编译必挂。

## 管道

```
按键/Serial/麦峰值 → LISTEN → THINK(mock|HTTP) → SPEAK(蜂鸣+OLED) → IDLE
```

## 后果

- 仿真与真机共用状态机；真机可把麦/喇叭换成 INMP441 + MAX98357。
- Live 路径依赖仿真 WiFi；`verify.sh` 只验 `--demo` 导出/校验/编译。
