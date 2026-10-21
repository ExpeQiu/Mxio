# 3Dm 三维运动

执行器状态总线 → 运动学正解 → Three.js / WebXR。独立跑在 `http://127.0.0.1:5174`。

## 启动

```bash
cd 3Dm && ./start.sh    # 视口
./verify.sh             # P0 dump + P2 FK + 单测
./stop.sh
```

| 阶段 | DoD |
|------|-----|
| P0 | `./bin/3dm dump --mech servo-sweep` 轨迹 q 覆盖 0–180 |
| P1 | 视口中单舵机/臂随 Mock 转动 |
| P2 | `./bin/3dm fk --mech 4dof-arm --q 'sv_base=90,...'` 末端 ≈ (0.22,0,0.06) |
| P3 | 视口右下角 VR 按钮；有 headset 时同一 pose 进 XR |

## 消息

父页（Velxio 编辑器）→ iframe：

```json
{ "type": "velxio.3dm.pose", "pose": { "id": "sv_base", "kind": "servo", "q": 90, "t_ns": 0 } }
{ "type": "velxio.3dm.kit", "kit": "arm-3dof", "actuators": [{ "id": "servo-1", "kind": "servo" }] }
```

## 模型组合（Kit）

Kit = 机构 + 默认装配 + 角色。内置含 `quad-4dof`（四轴机器狗）、`humanoid-lite`（简易人形）。

```bash
./bin/3dm kits
./bin/3dm generate --kind serial --n 5
./bin/3dm generate --kind quadruped --legs 4 --dof 2
./bin/3dm bom --kit quad-4dof
./bin/3dm suggest --kit arm-3dof --ids sv_base,sv_shld
./bin/3dm fk --mech arm-3dof --q 'sv_base=90,sv_shld=90,sv_elbw=90'
# 系统入口等价：
../cli/bin/velxio 3dm kits
```

## 装配（元件 → 关节 → 运动）

三份东西分开：

| 层 | 是什么 | 例子 |
|----|--------|------|
| 元件 | 画布上的执行器，只出 `q` | `sv_base` 舵机 PWM→度 |
| 机构 | 连杆 + 关节骨架 | `4dof-arm` 的 `j_base/j_shld/j_elbw/j_grip` |
| 装配 | 谁驱动哪个关节，以及零位/传动比 | `sv_base → j_base`，`qScale=-1` 反向 |

公式：

```
q_关节 = (q_元件 + qOffsetDeg) × qScale
T = T_父 × T_安装原点 × Rot(轴, q_关节)
```

换绑或改 `qScale` 会改末端位姿。同一组 PWM：

```bash
# 默认：基座 180° → 末端在 +Y
./bin/3dm fk --mech 4dof-arm --assembly arm-default \
  --q 'sv_base=180,sv_shld=90,sv_elbw=90,sv_grip=70'

# 对调基座↔肘：同一 PWM 变成俯仰
./bin/3dm fk --mech 4dof-arm --assembly arm-swap-base-elbw --q '...'

# 基座反向
./bin/3dm fk --mech 4dof-arm --assembly arm-invert-base --q '...'

# 临时绑
./bin/3dm assemble --mech 4dof-arm --bind 'sv_base=j_elbw,sv_elbw=j_base,...'
```

装配文件：`assemblies/*.json`。

## 画布装配（http://127.0.0.1:5174）

1. 点白色关节球（或连杆）选中，标签变黄。
2. 点左侧执行器（`sv_base` 等）；也可先点执行器再点关节。
3. 目标关节已有元件则**对调**，正解立刻变。
4. 双击关节或点「反向所选」切换 `qScale=-1`。


