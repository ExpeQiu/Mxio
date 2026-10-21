# Velxio CLI Skill

用 `velxio` 驱动 **整套** Velxio（元件、任意 `.vlx` 电路、Kit、VAP、编译、SPICE），**不要**点编辑器画布或 Monaco。

硬件选型 / substitute / 图库交付走 skill `velxio-hard-design`。本文件只管 CLI 命令。

仓库：`velxio/cli`。入口：`./bin/velxio`。

## 通用流程

1. `parts list` / `parts show` / `boards list` 查能力
2. `example list --query …` 找示例，或 `project init --board <kind>` 空白工程
3. `example export <id> -o x.vlx` 得到 IR
4. `circuit add|wire|rm|unwire|validate -p x.vlx` 改电路
5. `kit apply -p x.vlx --kit arm-3dof` 按角色补目录内执行器（不接线）
6. `code set -p x.vlx --file sketch.ino|script.py --from …`
7. `compile -p x.vlx`（Pi → ready；Arduino/ESP → 后端；`--demo` 不打 HTTP）
8. `sim spice -p x.vlx --drive … --assert current:… --assert voltage:…`
9. `circuit design --board esp32 --part led:2 --part button:4`：目录选型并按规则接线（LED 串 220Ω，id 无连字符）

## 命令

```
velxio --demo doctor
velxio version
velxio parts list --category motors --query led --format json
velxio parts show dc-motor
velxio boards list
velxio example list --board raspberry-pi-5 --format json
velxio example show blink-led
velxio example export <id> -o out.vlx
velxio project init --board arduino-uno -o uno.vlx
velxio project show -p uno.vlx
velxio circuit add -p uno.vlx --part led --id led1
velxio circuit wire -p uno.vlx --from arduino-uno:D13 --to led1:A
velxio circuit list -p uno.vlx
velxio circuit rm -p uno.vlx --id led1
velxio circuit unwire -p uno.vlx --from arduino-uno:D13 --to led1:A
velxio circuit validate -p uno.vlx
velxio circuit design --board esp32 --part led:2 --part button:4 -o out.vlx
velxio code set -p uno.vlx --file sketch.ino --from ./sketch.ino
velxio code list -p uno.vlx
velxio code get -p uno.vlx --file sketch.ino
velxio kit list
velxio kit detect -p arm.vlx
velxio kit apply -p arm.vlx --kit arm-3dof
velxio vap list
velxio vap show vap-chat
velxio --demo vap health
velxio studio columns --example esp32cam-ai-arm
velxio compile -p uno.vlx
velxio sim spice -p out.vlx --drive D13:1 --assert voltage:led1>1V
velxio sim qemu -p x.vlx --expect ready   # 本机已有镜像时启动树莓派虚拟机
velxio exec diagnose --host pi.local
velxio --demo exec run -p x.vlx --target sim --expect ready
velxio exec run -p x.vlx --target esp32 --port /dev/cu.usbserial-10 --expect "boot ok"
velxio exec run -p x.vlx --target pi --host pi.local --start "python3 main.py" --expect ok
velxio exec boundary
velxio 3dm kits
velxio 3dm fk --mech arm-3dof --q 'sv_base=90,sv_shld=90,sv_elbw=90'
cli/scripts/draw-ai-vision-arm.sh   # ESP32-CAM + 4 舵机视觉臂
cli/scripts/draw-ai-chat-bot.sh     # ESP32 AI 对话机器人（Mock）
cli/scripts/draw-speaker-agent.sh   # ESP32 小米音箱耳机孔接超级AI（Mock）
cli/scripts/draw-pi5-3dof-arm.sh    # Raspberry Pi 5 + 3 舵机摆臂
```

全局：`--format json`、`--demo`（= `VELXIO_MOCK_MODE=true`）。日志在 stderr。

Exit：0 成功；1 校验/断言失败；2 后端或 QEMU/求解器不可用。

电路 IR 是 `.vlx`。元件 **实例 id** 禁止连字符（ngspice 会截断）；示例 id（如 `blink-led`）可以有连字符。
