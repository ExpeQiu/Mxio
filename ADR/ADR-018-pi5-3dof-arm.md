# ADR-018：Raspberry Pi 5 三轴机械摆臂

- 状态：已采纳
- 日期：2026-09-16
- 模板：6（Velxio 图库）+ 1（Serial → 姿态 → PWM）

## 决策

1. 板型 **raspberry-pi-5**。执行器只从 OSS 目录取 `servo`，id 为 `sv_base` / `sv_shld` / `sv_elbw`，对应 Kit `arm-3dof`。
2. PWM：基座 GPIO12、肩 GPIO13、肘 GPIO18；状态灯 GPIO17 串 220Ω。固件 gpiozero `AngularServo`，脉宽 544–2400 µs，与 Arduino Servo.h 同一条控制律。
3. 输入走 Serial：`home` / `wave` / `demo` / `pose b s e`。默认 `demo` 摆臂；gpiozero 失败则 Mock 记角度，不发明新元件。
4. 无夹爪、无摄像头、无新 I2S。画布有三只角色舵机且无 `sv_grip` 时 `detectKitId` 返回 `arm-3dof`；视觉臂仍因 `sv_grip` 映射 `4dof-arm`。

## 打开

http://127.0.0.1:5173/example/pi5-3dof-arm
