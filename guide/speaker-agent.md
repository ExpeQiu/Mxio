# 小米音箱耳机孔接超级AI（仿真）

图库 id：`esp32-speaker-agent`。决策：`ADR/ADR-020-esp32-speaker-agent.md`。

打开 http://127.0.0.1:5173/example/esp32-speaker-agent ，先运行仿真。改过固件后重新打开该地址。

蜂鸣器是 3.5mm 播报，声传感器只报告有没有声音。词句在 Serial（115200）输入。

## 用法

1. 输入 `系统是否正常`。蜂鸣器响，Serial 打出协调器回复。
2. 输入 `帮我建任务：整理本周输出`，再输入 `确认` 或 `取消`。
3. 按下「说话」后，在时限内输入一行；只拨大声传感器、不输入文字时，日志是 `mic=1 asr=empty`。
4. `MODE live` 之后才会连 `Velxio-GUEST`。先 `TOKEN <设备令牌>`，需要时再 `URL http://192.168.4.2/api/super-ai/device/turn`。令牌不会写回日志。

命令：`HELP` / `MODE mock|live` / `SSID` / `PASS` / `URL` / `TOKEN` / `WORKSPACE` / `SAY 文本`。真机落地包在 `/Users/qiubin/gitcom/IOT/Ibox/esp32-speaker/落地`。

日志在 Serial，形如 `[spk] turn_id=1 state=SPEAK mock=1 device=xiaomi-living …`。导出日志在 `cli/logs/draw-speaker-agent.log`。

## CLI

```bash
cli/scripts/draw-speaker-agent.sh
cli/scripts/verify.sh
```
