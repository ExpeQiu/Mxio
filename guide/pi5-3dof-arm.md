# Pi 5 三轴机械摆臂

图库：http://127.0.0.1:5173/example/pi5-3dof-arm

Raspberry Pi 5 驱动基座 / 肩 / 肘三只舵机。Start the Pi → Upload → `python3 /home/pi/script.py`。

| 角色 | 元件 | 引脚 |
|------|------|------|
| 基座 | `sv_base` | GPIO12 PWM，5V，GND |
| 肩 | `sv_shld` | GPIO13 |
| 肘 | `sv_elbw` | GPIO18 |
| 状态灯 | `ledok` + `rled` 220Ω | GPIO17 |

Serial 一行一条：`home`、`wave`、`demo`、`pose 90 60 120`。右侧运动栏选 **三轴机械臂**（自动识别 `arm-3dof`）。
