# 虚拟应用平台（VAP）

代码在 `AppS/`（窗口、协议、网关、跑道图）。ADR：`ADR/ADR-014-virtual-app-platform.md`。

对话：http://127.0.0.1:5173/example/esp32-ai-chat  
视觉：http://127.0.0.1:5173/example/esp32cam-ai-arm （自动进入综合窗口，见 `guide/center.md`）

先运行，再打字或按住说话。综合窗口中栏是虚拟遥控器：屏上仍是本窗口，方向键滚动，Z 发送，X 按住说话；顶栏蓝/白/红键绑定本机摄像头、麦克风、喇叭。

窗口上的四行跑道图显示：软件 → UART → 固件状态机 → OLED/蜂鸣/LED/喇叭。
