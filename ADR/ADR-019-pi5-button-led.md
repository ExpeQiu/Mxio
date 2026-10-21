# ADR-019：Pi 5 按键 LED 的可重复验收

状态：已实现（2026-10-10）。

## 目标与选择

交付树莓派 5 + LED + 按键的图库与 `.vlx` 工程，使用现有 `led`、`resistor`、`pushbutton` 元件。采集 GPIO27 → 50ms 稳态消抖 → 切换 GPIO17。LED 串 220Ω；按键接地，外接 10kΩ 上拉至 3V3。

Python 真源独立保存，以 `?raw` 内嵌到图库与导出的 `main.py`。MockFactory 和真机 LGPIOFactory 共用状态机；默认有限 Mock 演示，不在真机初始化失败时偷偷降级。

## 验收层次

- CLI export 与 circuit validate 验证 IR 结构。
- Pi compile 只返回 ready；独立 `py_compile` 检查导出程序语法。
- 执行导出程序并驱动官方 MockPin，验证抖动、长按和两次有效按下。
- 从程序轨迹回放四种电气状态，真实 SPICE 检查输入上拉、3.3V GPIO 与 LED 开关电流。
- 前端回归覆盖 Pi 3/4/5 的 3.3V PWM 与独立 5V 电源轨。

验收脚本 `cli/scripts/verify-pi5-button-led.py` 缺少依赖或求解失败时直接失败，不将 demo、ready 或缺少 QEMU 计为真实运行通过。

## 相关修复

树莓派 SPICE 配置原先将板上 5V 电源当作 GPIO 逻辑电压；现在主逻辑轨为 3.3V、5V 为辅助轨，使 CLI 数字驱动、PWM、内部上拉及前端输出一致。

现有后端进程未加载 `/api/exec` 路由；确认源码已包含接口后重启进程恢复，不修改认证逻辑。

CLI 执行请求原先将所有 Pi 型号折叠为 `raspberry-pi`，后端会默认选择 Pi 3。现在保留准确板型；回归覆盖 Pi 5/4/2/Zero，避免仿真时启动错误 CPU 配置。

## 非目标与限制

不新增板卡、操作系统镜像或 GPIO 仿真引擎。本次未连接实体树莓派，未安装 QEMU，GPIO 模拟与 SPICE 是分层回放而非实时协同仿真。完整系统与 SSH 真机验收作为有依赖的后续动作。
