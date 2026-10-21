# ESP32 AI 对话机器人

图库 id：`esp32-ai-chat`。ADR：`ADR/ADR-013-esp32-ai-chat.md`、`ADR/ADR-014-virtual-app-platform.md`。

打开 http://127.0.0.1:5173/example/esp32-ai-chat 后会弹出对话窗口（P0 虚拟应用）。先运行仿真。

## 用法

1. OLED 用板内 Wire 直驱，不安装 Adafruit_SSD1306（本机旧库会在 ESP32 上要 `util/delay.h`）。
2. 对话窗口打字或按住说话；也可在 Serial（115200）输入一行，例如 `你好`。窗口点 Live 走宿主网关 `http://192.168.4.2/v1/chat/completions`（默认仍是 Mock）。
3. 或点按键「说话」，再在 Serial 打字；声传感器滑条可触发「听到声音」。

命令：`HELP` / `MODE mock|live` / `SSID` / `URL` / `KEY` / `SAY 文本`。

## CLI

```bash
cli/scripts/draw-ai-chat-bot.sh
cli/scripts/verify.sh
```
