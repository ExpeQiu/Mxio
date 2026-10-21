# ADR-015：综合窗口（Center Studio）

- 状态：已采纳（P0 三栏壳 / P1 停靠与空栏折叠 / P2 视觉臂自动进入 / P3 跨栏跑道 + 固件抽屉）
- 日期：2026-08-19
- 模板：**6（Velxio 宿主）** + **1（采集→管道→展示）**；应用清单仍为 ADR-014 的 4-lite
- 落点：`velxio/center`；编辑器 `@center`；不新开仓
- 不选：模板 5（电路画布已存在）；运动层回写 GPIO；替换 2D 画布

## 决策

1. `viewMode = studio` 是编辑器第四种视图，不是新产品。
2. 左硬件 = `SimulatorCanvas` 真源；中应用 = 停靠 `VirtualRemote`（屏内 `VapHost`）；右运动 = `Motion3dPanel` iframe。
3. UART0 仍是 MCU 唯一控制面；运动层只消费 `ActuatorPose`。
4. 同时具备 VAP 与执行器的示例（首发 `esp32cam-ai-arm`）加载时自动进 studio。
5. 无应用或无执行器则折叠对应栏，不留空栏。

## 后果

- Blink 仍是 code|circuit。
- Serial Monitor 仍作排障真源（底栏）。
- 3Dm 继续独立跑在 5174，由 iframe 嵌入。
