# Pi 5 按键切换 LED

交付工程：`cli/fixtures/pi5-button-led.vlx`。Python 程序已内嵌为 `main.py`，真源为 `frontend/src/data/sketches/pi5-button-led.py`。

本地图库：[打开示例](http://127.0.0.1:5173/example/pi5-button-led)。也可以在编辑器中导入 `.vlx`。

## 接线

全程使用 BCM 编号，外设都是已有 OSS 目录元件。

- LED 输出：Pi GPIO17（物理脚 11）→ `rled:1`，220Ω 电阻 `rled:2` → `led:A`，`led:C` → GND（物理脚 6）。
- 按键输入：Pi GPIO27（物理脚 13）→ `btn:1.l`，`btn:2.l` → GND。
- 上拉：Pi 3V3（物理脚 1）→ 10kΩ 电阻 `rpull:1`，`rpull:2` → `btn:1.l`。
- 四脚按键同侧的 `1.l/1.r` 常通，`2.l/2.r` 常通，按下时跨组导通。接线使用不同组。

真机可以直接使用普通红色 LED、220Ω 电阻、10kΩ 电阻和四脚轻触按键。GPIO 信号按 3.3V 验证；独立 5V 电源轨没有接到按键输入。

## 行为

启动时 LED 熄灭；按钮连续稳定按下 50ms 后切换一次 LED。长按不重复切换，稳定松开后才接受下一次按下。结束时关灯并释放 GPIO。

Mock 和 live 使用同一个 `ToggleController.sample()` 状态机，差异仅在引脚工厂与时钟。默认 Mock 模式会运行有限演示后退出；硬件初始化失败不会伪装成仿真成功。

## 本机验证

Python 环境需有 `gpiozero==2.0.1`。建议使用独立虚拟环境：

```bash
python3 -m venv /tmp/velxio-pi5-check
/tmp/velxio-pi5-check/bin/pip install gpiozero==2.0.1
VELXIO_PYTHON=/tmp/velxio-pi5-check/bin/python bash cli/scripts/draw-pi5-button-led.sh
```

脚本通过 CLI 重新导出工程、做 demo compile，然后执行完整验证。验证器从 `.vlx` 提取实际嵌入的 `main.py`，检查 Python 语法并运行官方 `MockFactory`，覆盖按键抖动、稳定按下、长按、松开及第二次按下。随后按程序轨迹生成四种临时电路快照，使用真实 ngspice 求解，断言 GPIO 电压、上拉状态及 LED 电流。

报告：`cli/logs/pi5-button-led-validation.json`。电路验证、Python 语法检查、两次有效切换与四种 SPICE 状态均需成功，否则脚本退出失败。`compile` 对 Pi 返回 `ready / no compilation needed`，它不检查 Python 语法；语法检查由验证器独立执行。

这属于 GPIO 行为仿真加电气快照回放，未做 Python 与 SPICE 同步闭环仿真，也未证明真机或完整树莓派操作系统已运行。

## 真机运行

树莓派 OS 环境需要 `python3-gpiozero` 和 `python3-lgpio`；Pi 5 使用 `LGPIOFactory`。把工程里的 `main.py` 保存到树莓派后：

```bash
python3 main.py --mode live
# 有限验收运行（期间实际按键）：
python3 main.py --mode live --duration 15
```

从 CLI 经 SSH 部署并验收（先将 `pi.local` 与用户替换为实际设备信息）：

```bash
cli/bin/velxio exec run -p cli/fixtures/pi5-button-led.vlx \
  --target pi --host pi.local --user pi --action test --duration 15 \
  --start 'python3 -u main.py --mode live --duration 15' \
  --expect '"state": "READY"' --expect '"state": "TOGGLE"' --expect '"state": "STOP"'
```

需要可用 SSH 认证和已确认的主机密钥。该命令会部署程序并要求测试期间按键至少一次；须先完成接线与 live 模式依赖安装。

### 后续 SSH 验证（2026-10-10）

已通过 `pi@192.168.0.194` 连接实体 Raspberry Pi 5 Model B Rev 1.0，使用已有 SSH 密钥认证。程序部署在 `/home/pi/velxio/pi5-button-led/main.py`；独立 `.venv` 安装 `gpiozero==2.0.1`，Python 语法检查与 Mock 引脚演示通过，包含两次有效切换、抖动与长按测试。尚未接线，未运行 live 模式或驱动真实 GPIO。该设备系统 Python 尚缺 `gpiozero` 和 `lgpio`；当前 `.venv` 仅满足 Mock 验证。

远端复验命令：

```bash
ssh pi@192.168.0.194 'cd /home/pi/velxio/pi5-button-led && .venv/bin/python main.py --mode mock'
```

本地 SSH 验证报告：`cli/logs/pi5-button-led-ssh-validation.json`。账号密码不保存在工程或报告中。

## QEMU 与执行接口

当前后端 `/api/exec/boundary` 已恢复，源码原本已有路由，重启后加载成功。完整 Pi 虚拟机仍需要 `qemu-system-aarch64` 与缓存的引导镜像；本机目前缺少该 QEMU，因此未报告 QEMU 通过。CLI 的 `exec run --target sim` 会明确返回不可用。

参考：[树莓派 GPIO 文档](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html)、[GPIO Zero 引脚工厂与 MockFactory](https://gpiozero.readthedocs.io/en/stable/api_pins.html)。
