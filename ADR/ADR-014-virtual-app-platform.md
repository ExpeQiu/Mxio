# ADR-014：虚拟应用平台（Host Window / VAP）

- 状态：已采纳（P0 对话窗口 / P1 LLM 网关 / P2 视觉窗口）
- 日期：2026-08-18
- 模板：**6（Velxio 宿主）** + **1（采集→管道→展示）**；应用目录用 **4-lite 注册表**，不做完整 Skill 中台
- 参考：`ADR-013`、`esp32-ai-chat`、`SerialMonitor`、`Motion3dPanel`（iframe 侧栏先例）
- 不选：模板 5（电路画布已存在，不另起 React Flow）；模板 2 四专家类；独立 Next 对话仓

## 背景

Velxio 已能仿真 ESP32 硬件与固件状态机（例：`/example/esp32-ai-chat`）。OSS 无 I2S 麦/功放，QEMU 也不能跑端侧 ASR/TTS。人机交互目前只能走 Serial 打字。

需要一层 **虚拟应用**：在编辑器里开 Web 窗口，借用 PC 的麦克风、喇叭、浏览器 STT/TTS，以及可选的 LLM，同时 **不拆走硬件真源**——固件仍看到 UART/GPIO，仿真与真机同一条 same-law 状态机。

ADR-013 拒绝的是「独立对话产品仓」。本决策明确：**编辑器内的宿主窗口是虚拟外设，不是新产品。**

## 选项

| # | 选项 | 结论 |
|---|------|------|
| A | 新仓 Next 对话 UI，硬件只当装饰 | 拒绝（与 ADR-013 冲突） |
| B | 固件内做 Whisper/TTS + 新 I2S 元件 | 拒绝（QEMU/元件表做不到） |
| C | 编辑器内 Host Window + UART 桥（本决策） | 固件不变协议即可先跑通 |

## 决策

1. **落点**：`velxio/AppS`（窗口 `web/`、网关 `server/`）。编辑器 `@apps` 引用；不新建仓。
2. **总线**：UART0（已有 `serialWriteToBoard` / `serialOutput`）。窗口是 Serial 的富客户端，不是第二条控制面。
3. **管道（模板 1）**：

```
PC 麦/键盘 → STT/文本 → HostBridge → Serial TX
    → ESP32 固件（IDLE/LISTEN/THINK/SPEAK）
    → Serial RX 日志 → HostBridge 解析 → 窗口字幕 + TTS +（可选）LLM 网关
硬件侧仍驱动 OLED / 蜂鸣 / LED
```

4. **智能层**：默认 `AI_MOCK_MODE`。Live 时固件走 `http://192.168.4.2/v1/chat/completions`（slirp 上的 llm.local）；Key 只进 `.env`，不进仓库、不进浏览器。
5. **应用是清单，不是硬编码专家类**：`VirtualAppManifest` 注册（id / 绑定 UART 或 camera / 能力 stt|tts|llm|camera / 关联 example id）。已交付 `vap-chat`、`vap-vision`。
6. **窗口形态**：画布上可拖动的 Web 窗口（对话气泡 + 按住说话），不是替换 Serial Monitor；Serial 仍作排障真源。
7. **非目标（P0）**：端侧 Whisper、新 I2S 零件、完整 Skill 中台、React Flow、独立登录/多租户、把 LLM Key 写进 sketch。

## 模板必答（按模板 1 裁剪）

| 问 | 答 |
|----|----|
| 多仓 vs monorepo | 留在 `velxio`；与 ADR-011/013 一致 |
| 双写 | 否。Serial 是唯一 MCU 视图；窗口只是宿主投影 |
| 编排中枢 | `HostBridge`（前端），无新 FastAPI SIM |
| 运行时 | 现有 Vite :5173 + 后端 :8001；无新常驻进程 |
| 智能常驻 vs 按需 | 按会话按需；Mock First |

## 契约（P0 兼容现有固件）

窗口 → 板：一行文本或 `SAY <utter>`（与 `ai-chat-bot.ino` 已有命令一致）。

板 → 窗口：解析现有日志，不强制改固件。

```
[chat] turn_id=<n> state=<IDLE|LISTEN|THINK|SPEAK> mock=<0|1> <text>
```

P1 可升级为行分隔 JSON（`{"v":1,"type":"utter"|...}`），旧日志解析保留为 fallback。

## 增量

| 阶段 | DoD | 估时 |
|------|-----|------|
| P0 对话窗口 | 已交付：`/example/esp32-ai-chat` 窗口 + Serial `SAY` + TTS；Mock 默认开 | 完成 |
| P1 LLM 网关 | 已交付：窗口 Live → `URL`+`MODE live`；宿主 `/api/vap` + guestfwd Mock；Key 不进仓 | 完成 |
| P2 注册表 | 已交付：`vap-vision` + `/example/esp32cam-ai-arm` 视觉窗口借用 PC 摄像头 | 完成 |

## 后果

- 仿真里人机交互可演示；真机仍用按键 + 真麦/喇叭，固件状态机不变。
- 浏览器语音 API 需 HTTPS 或 localhost；无麦时键盘输入必须可用。
- 不把 QEMU HTTP 稳定性绑死在 P0 验收上。
