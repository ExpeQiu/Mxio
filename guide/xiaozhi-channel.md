# 小智设备通道

设备：ESP32-S3 Touch LCD 1.85C，固件 2.4.0，MAC `84:C7:BB:60:21:94`，局域网 IP `192.168.0.200`。

ESP32 设备通道默认选择 Wi-Fi。`velxio device` 等同于 `velxio device wifi --action status`，无需提供串口；Wi-Fi 不可用时会报告失败，不自动改用 USB。USB 观察和重启必须显式使用 `device usb`。固件烧录仍使用其专用 USB 执行入口。

## 已实现的 USB 通道

Velxio CLI → 本机后端 `/api/exec/esp32/channel` → USB 串口。无需 `.vlx` 或固件编译，不烧录。支持 `observe` 和 `restart`：

```bash
cli/bin/velxio device usb --port /dev/cu.usbmodem21101 --action observe --duration 15
cli/bin/velxio device usb --port /dev/cu.usbmodem21101 --action restart --duration 18
```

`observe` 不主动切换复位信号，但部分 USB 驱动/固件在打开串口时仍可能重启设备；不能保证完全无扰动。返回的是采集窗口内日志观测，不是云端 RPC 状态查询。

`restart` 主动切换 DTR，必须读到 ROM/复位日志才报告成功。结果分别给出启动、MQTT 重连和最新状态，不将“串口打开成功”当作重启成功。没有捕获到状态时返回空值，不补写缓存状态。

通道复用部署边界认证和设备白名单，与烧录任务共用串口独占锁；日志仅返回经过敏感信息过滤的启动与协议证据。不支持通过此入口发任意串口命令。

报告：`cli/logs/xiaozhi-channel-live.json`。后端测试：`test/backend/unit/test_device_channel.py`。

## 已验证的 Wi-Fi 双向通道

设备保留官方 2.4.0 固件。`wifi.ota_url` 指向本机 `http://192.168.0.196:8766/ota/`；中转获取原云端连接配置，仅将 MQTT 地址替换为本机 `192.168.0.196:1883`。设备仍连接原云端账号，云端 MQTT 通过验证证书的 TLS 转发，语音 UDP 路径继续由原云端提供。本地设备至中转的 MQTT 使用局域网明文连接。

Velxio CLI → 本机后端 `/api/exec/esp32/wifi` → MQTT 中转 → ESP32 Wi-Fi → 设备端 MCP 工具 → 同编号设备回执。只有收到设备回复才报告成功；断线、超时和设备错误均失败。不使用 USB 日志或缓存状态替代 Wi-Fi 回执。

```bash
cli/bin/velxio device
cli/bin/velxio device --action volume --value 40
cli/bin/velxio device --action brightness --value 75
```

实际验收：亮度 75 → 76 → 75；音量 40 → 41 → 40。每次设置后再次实时读取设备，确认变化与恢复。用户语音调用 Velxio 状态工具也通过新 Wi-Fi 通道获得设备实时回执。报告：`cli/logs/xiaozhi-wifi-validation.json`。

本机中转进程目前运行中，未安装开机自启。必须保持本机及中转服务运行，才能维持这套通信地址下的云端连接。重新启动中转后，设备可以使用保留的路由元数据自动重连；元数据不含 MQTT 账号密码。网关不保存 MQTT 账号、密码或音频数据。

```bash
cd backend
VELXIO_XIAOZHI_LAN_IP=192.168.0.196 python -m app.services.hwexec.xiaozhi_wifi
```

中转仅接受 `192.168.0.200` 的 MQTT，以及该 IP / MAC 对应的 OTA 请求；控制入口仅允许本机访问。CLI/API 只暴露状态、0–100 音量和亮度，不暴露烧录、重启或任意工具。网关源码：`backend/app/services/hwexec/xiaozhi_wifi.py`；离线配置准备：`cli/scripts/xiaozhi-wifi-config.py`。设备配置备份位于 `logs/xiaozhi-nvs-backup.bin`，含原设备凭据，权限为 600，不应分享或提交。

恢复直连云端：停止串口任务后，使用 esptool 将上述 16 KiB 原配置备份写回 `0x9000`，重启小智即可恢复原云端 OTA 地址；无需恢复固件。配置修改仅追加 `wifi.ota_url`，未重建其他 NVS 项，已由写后哈希验证确认。

协议依据：[2.4.0 MQTT 实现](https://github.com/78/xiaozhi-esp32/blob/v2.4.0/main/protocols/mqtt_protocol.cc)、[设备工具实现](https://github.com/78/xiaozhi-esp32/blob/v2.4.0/main/mcp_server.cc)。

## 云端 MCP 到 Velxio 的通道

桥接器：`backend/app/services/hwexec/xiaozhi_bridge.py`，遵循官方示例的出站 WebSocket 接入方式。小智云端可发现并调用 `velxio_device_channel_status`，通过 Wi-Fi 读取小智实时状态，并附带 USB 枚举与最近一次成功的 USB 通道验收。USB 历史状态仍明确标注为历史观测；Wi-Fi 失败时不会用历史状态冒充实时状态。

启动方式（接入点通过环境变量提供，不能提交到仓库）：

```bash
cd backend
python -m app.services.hwexec.xiaozhi_bridge
```

需要 `VELXIO_XIAOZHI_ENDPOINT`（授权的完整 WSS 接入点）、可选 `VELXIO_API_URL`（默认本机 8001），受保护后端使用 `VELXIO_EXEC_TOKEN`。依赖沿用后端的 `websockets`。

本次桥接进程已启动，凭据仅位于进程环境，没有保存到项目文件。状态报告 `cli/logs/xiaozhi-mcp-bridge.json`；进程 ID 在 `logs/xiaozhi-mcp-bridge.pid`，日志在 `logs/xiaozhi-mcp-bridge.log`。进程会在断线后自动重连，电脑重启后需重新提供凭据启动。

这一通道方向是“小智 → 云端 MCP → Velxio → Wi-Fi 实时查询 → 设备回复”。外部 MCP 接入点只提供外部工具接入权；反向设备控制由上面的局域网 MQTT 中转实现。云端工具仍仅查询，不暴露音量、亮度设置或重启。

验收分为 WebSocket 已连接、MCP 初始化、工具发现、实际工具调用四项。四项均已实测通过：用户语音请求后，收到一次真实 `tools/call`，本地查询成功。复验可对小智说“调用 Velxio 设备通道状态工具”。报告的 `tool_calls` 只在收到实际 `tools/call` 后增长，`last_call_ok` 表示本地 Velxio 查询成功。

协议示例：[官方 MCP 桥接程序](https://github.com/78/mcp-calculator)。单元测试：`test/backend/unit/test_xiaozhi_bridge.py`。
