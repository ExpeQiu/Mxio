# ADR-012：Velxio 三维运动系统（3Dm）

- 状态：已采纳
- 日期：2026-08-18
- 模板：1（分层数据流，嵌在现有 Velxio 画布内）
- 参考仓：`/Volumes/Lexar/git/03T/Uni-SIM`（采集→管道→展示）；代码落点 `velxio/3Dm`

## 背景

Velxio 已有 MCU 仿真与舵机/步进/直流电机的电信号层，2D 画布只改 `angle` / `spinning`。需要把执行件状态接到机构正解与 3D/WebXR，且不另起仿真器。

## 决策

1. **仓内模块**：全部核心在 `velxio/3Dm`，不新开产品仓。
2. **契约**：`ActuatorPose { id, kind, q, qdot?, spinning?, t_ns }` 是唯一跨层消息；3D 与 XR 只消费 pose → FK。
3. **分层**：P0 总线/轨迹 → P1 Three 视口 → P2 机构 JSON + 正解 → P3 同一 pose 接 WebXR。
4. **机构**：`servo-sweep` / `4dof-arm` / `4wd-chassis`；元件 id 与 `ai-vision-arm.vlx`、Pi5 四驱示例对齐。
5. **v1 不做**：刚体碰撞、CAD 数字孪生、替换 2D 画布。
6. **生命周期**：`3Dm/start.sh`（5174）、`stop.sh`、`verify.sh`；`VELXIO_3DM_MOCK` / `--demo`。

## 后果

- 编辑器通过 iframe + `postMessage` 注入 pose，3Dm 可独立验收。
- 无 headset 时 P3 降级为按钮「VR 不可用」，桌面视口仍可用。
