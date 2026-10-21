# ADR-017：模型组合（Kit）与运动绑定

- 状态：已采纳
- 日期：2026-08-20
- 模板：**6（Velxio 宿主）** + **1（采集→管道→展示）**
- 落点：`velxio/3Dm`（Kit 真源）+ `velxio/center`（Studio 选型）

## 背景

3Dm 已有机构 JSON、装配与点选换绑，但综合窗口右侧写死 `4dof-arm`，画布执行器靠 `sv_base` / `m_fl` 猜测。需要可选用的整机配方，并把电机/舵机按角色绑到运动节点。

## 决策

1. 新增 **Kit**：机构 + 默认装配 + 角色 BOM。P0 含 `arm-3dof`、`car-2wd`，并包裹已有 `4dof-arm` / `4wd-chassis` / `servo-sweep`。
2. 绑定按角色：精确 id → 同种类顺序填入；缺件只提示，不发明目录外元件。
3. Studio 运动栏选 Kit，经已有 `postMessage`（`velxio.3dm.kit`）下发；运动层仍只消费 `ActuatorPose`。
4. `detect --ids sv_base,sv_shld` 仍返回 `4dof-arm`（视觉臂契约）。`sv_base+sv_shld+sv_elbw` 且无 `sv_grip` 时返回 `arm-3dof`（Pi 5 三轴摆臂）。
5. P1：`quad-4dof` 四轴机器狗；缺件可用「补缺件」落到画布（仅 servo / dc-motor / stepper）。
6. P2：`generateMechanism` 参数化生成串联臂 / 轮式 / 四足 / 人形；内置 `humanoid-lite`。

## 非目标

回写 GPIO、替换 2D 画布、CAD 孪生、步态规划。
