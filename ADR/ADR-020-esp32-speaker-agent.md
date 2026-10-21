# ADR-020：小米音箱耳机孔接超级AI（Velxio 仿真）

- 状态：已采纳
- 日期：2026-10-21
- 模板：**6（CLI 工具集）** 托管交付；链路按 **模板 1**：拾音 → 文本 → 超级AI → 插孔播报

## 背景

小米音箱经 3.5mm 接 ESP32，ESP32 只连 AgentCenter 云端超级AI。OSS 目录没有耳机孔、I2S 麦和功放，QEMU 也跑不了端侧识别与合成。仿真要走通同一条状态机。

## 决策

1. **板型**：`esp32`（DevKit V1，QEMU 可编译）。真机可换 ESP32-S3，引脚约定不变。
2. **Substitute**：蜂鸣器 `jack` = 耳机孔播报；`big-sound-sensor` 的 `AOUT` = 拾音能量，不接在蜂鸣器上；按键 = 按住说话；SSD1306 = 状态；Serial 一行 = 识别文本。
3. **Mock First**：默认板内回复「系统 / 知识 / 技能 / 建任务 / 确认 / 取消」。`MODE live` 才连接 `Velxio-GUEST`，向 `/api/super-ai/device/turn` 提交文本，头 `X-Device-Token`。令牌只从 Serial 的 `TOKEN` 进入，日志只记 `token=set|empty`。
4. **确认**：建任务先留待确认；下一句「确认 / 执行 / 做吧 / 把它做了」才带 `pending` 发出；「取消 / 算了 / 不用了 / 不要」本地丢掉。有 `task_id` 时短轮询 `/device/tasks/{id}`。
5. **交付**：示例 id `esp32-speaker-agent`。`cli/scripts/draw-speaker-agent.sh` 导出并写 `cli/logs/draw-speaker-agent.log`。
6. **非目标**：新 I2S 元件、端侧 Whisper、在 AgentCenter 上新开语音接口、板子领取任务。

## 管道

```
按键 / Serial / 麦能量 → LISTEN
        → THINK（Mock 或 POST /device/turn）
        → CONFIRM（待确认时留到下一句）
        → POLL（有 task_id）
        → SPEAK（蜂鸣器 = 插孔）
        → IDLE
```

## 后果

- 仿真与真机共用状态机。真机把蜂鸣器换成线路 DAC 进音箱 AUX，把声传感器换成 I2S 麦。
- `verify.sh` 只验 `--demo` 导出、校验和编译。Live 需要宿主把 `192.168.4.2` 转到云端，并先 `TOKEN`。
