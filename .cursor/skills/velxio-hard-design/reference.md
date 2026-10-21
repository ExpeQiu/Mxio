# Velxio 硬件设计参考

## Substitute 表

| 角色 | OSS 元件 | 常用引脚 | 真机可换 |
|------|----------|----------|----------|
| 文本输入 / ASR | Serial Monitor | UART0 | 同上 + 真麦 |
| 麦能量 | `big-sound-sensor` | `AOUT`→GPIO34 ADC，`VCC`/`GND` | INMP441 I2S |
| 播报 / TTS | `buzzer` | `1`←GPIO，`2`→GND | MAX98357 I2S |
| 按住说话 | `pushbutton` | `1.l`←GPIO，`2.l`→GND | 同 |
| 状态灯 | `led` + `resistor` 220 | GPIO→`rled:1`→`led:A`，`C`→GND | 同 |
| 状态屏 | `ssd1306-i2c-4pin` | SDA 21、SCL 22、VCC 3V3、GND | 同，固件 `Wire` 0x3C |
| 视觉跟随 | `esp32-cam` + 4×`servo` | PWM 12/13/14/15，LED GPIO2 | ESP-WHO / OpenCV |
| 三轴摆臂 | `raspberry-pi-5` + 3×`servo` | GPIO12/13/18 PWM，LED GPIO17 | SG90 / MG90S |
| WiFi | 仿真 AP | SSID `Velxio-GUEST` | 真实 AP |

`parts show` 无 `pins` 时，在 `cli/src/catalog/index.ts` 的 `FALLBACK_PINS` 补齐后再 `circuit validate`。

## ESP32 引脚习惯

| 功能 | GPIO | 画布 pinName |
|------|------|----------------|
| I2C SDA / SCL | 21 / 22 | `"21"` / `"22"` |
| 板载/状态 LED | 2 | `"2"` |
| 按键 | 4 | `"4"` |
| PWM / 蜂鸣 | 15 或 12–15 | 数字字符串 |
| ADC 输入 | 34 / 35 / 36 / 39 | `"34"` 等 |
| 3V3 / GND | — | `"3V3"` / `"GND"`（CAM 上常见 `5V.1` `GND.1`） |

对照已有示例接线，勿发明丝印名。`boardPinToNumber('esp32','34')` 接受裸数字。

## 标杆路径

| 项目 | 图库 id | 打开 |
|------|---------|------|
| 视觉臂 | `esp32cam-ai-arm` | http://127.0.0.1:5173/example/esp32cam-ai-arm |
| 对话机器人 | `esp32-ai-chat` | http://127.0.0.1:5173/example/esp32-ai-chat |
| 音箱超级AI | `esp32-speaker-agent` | http://127.0.0.1:5173/example/esp32-speaker-agent |
| Pi 5 三轴摆臂 | `pi5-3dof-arm` | http://127.0.0.1:5173/example/pi5-3dof-arm |

CLI：`cli/scripts/draw-ai-vision-arm.sh`、`cli/scripts/draw-ai-chat-bot.sh`、`cli/scripts/draw-speaker-agent.sh`、`cli/scripts/draw-pi5-3dof-arm.sh`。

## 固件边界

- 仿真：Serial 一行 = 一句用户话；OLED 用 ASCII 字模（中文走 Serial）。
- Live HTTP：OpenAI 兼容 JSON，自行抽 `"content"`；不引入 ArduinoJson / Adafruit。
- `libraries: []`，除非该库已在本仓 ESP32 QEMU 示例里验证（如 `ESP32Servo`、`PubSubClient`）。

## 编译对照

| 现象 | 处理 |
|------|------|
| `util/delay.h: No such file` | 用户目录 AVR 版 Adafruit；删库，`Wire` 直驱 SSD1306 |
| 电路拒绝运行 / short | LED 缺限流电阻 |
| validate `hyphen-id` | 实例 id 去掉 `-` |
| 一按键就「听到声音」 | 声传感器空闲在中位 ADC；用 `micBase + MIC_DELTA` |
| 改了 ino 仍旧错误 | 浏览器仍是旧示例；重新打开 `/example/<id>` |
