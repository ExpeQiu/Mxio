# 综合窗口（Center / Studio）

模板：6（Velxio 宿主）+ 1（管道）+ 4-lite 注册表。ADR：`ADR/ADR-015-center-studio.md`。

代码在 `center/web/`，编辑器经 `@center` 引用。工具栏「综合」或打开视觉臂示例自动进入。

视觉臂：http://127.0.0.1:5173/example/esp32cam-ai-arm

Pi 5 三轴摆臂：http://127.0.0.1:5173/example/pi5-3dof-arm （运动栏自动识别 `arm-3dof`，无 VAP）

| 栏 | 内容 |
|---|---|
| 左 硬件 | 电路画布；底栏可展开固件 |
| 中 虚拟遥控器 | 屏上停靠对话/视觉；方向键与 Z/X 联动键盘；顶栏三键绑定本机摄像头/麦/喇叭 |
| 右 运动 | 3Dm 视口（需 5174）；只消费 pose |

无 VAP 或无舵机/电机时对应栏折叠。Blink 仍走代码|电路。`./start.sh` 会一并拉起 3Dm；若运动栏空白，先确认 `http://127.0.0.1:5174`。

## 运动栏 Kit

右侧可选模型组合：单舵机、三轴臂、四轴臂、两驱、四驱、**四轴机器狗**、**简易人形**。缺件点「补缺件」会把目录内舵机/电机加到画布（不自动接线）。「生成」可参数化出串联 n 轴、轮式、四足 8 轴等。

```bash
./bin/3dm generate --kind serial --n 5
./bin/3dm generate --kind quadruped --legs 4 --dof 2
./bin/3dm bom --kit quad-4dof
```

决策：`ADR/ADR-017-motion-kit.md`。
