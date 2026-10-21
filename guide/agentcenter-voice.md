# 小智 / AgentCenter 双唤醒词通道

设备为 ESP32-S3 Touch LCD 1.85C，固件 2.4.0。资源索引添加两条 MultiNet 中文指令：

- `你好小智`：保留原小智云端问答。
- `你好管家`（说话时可带停顿）：选择 AgentCenter 设备对话通道。
- 待机按 BOOT 键：选择 AgentCenter，便于排查唤醒识别问题。

每次对话固定一个通道；管家回复结束后回到待机。下一次可以换唤醒词。录音停顿后进入识别，最长录音窗口为 12 秒；完全没有麦克风数据时也会超时返回待机，不无限聆听。语音打断时应停止当前播放；管家通道不将后续麦克风语音或 listen 指令转给小智云端。

## 实现

ESP32 离线识别唤醒词 → Wi-Fi MQTT `listen/detect` → Velxio 路由 → 本机解密并解码 Opus 麦克风音频 → SenseVoice 中文识别 → AgentCenter `/api/super-ai/device/turn` → 本机中文语音合成 → Opus/AES-CTR UDP → ESP32 扬声器。

建立音频会话仍通过原小智云端 hello 握手；握手后音频 UDP 经本机路由。说“你好小智”时正常转发原云端音频。说“你好管家”时在本机处理后续录音，屏蔽该会话的云端回复和设备工具调用，防止两边同时回复。原云端可能收到握手前上传的唤醒词音频。

AgentCenter 地址为 `http://47.113.225.93:8080`，设备已使用项目已有注册凭据注册。设备令牌位于 `logs/agentcenter-device.json`，权限 600、被 Git 忽略，不应分享。该 HTTP 地址的令牌与文字传输未加密；部署 HTTPS 后应同步更新适配地址。

当前 AgentCenter 健康接口返回 `mock_mode: true`，设备通道用于验证路由、系统查询、任务确认流程；不代表真实 OpenClaw/Hermes 模型对话已接通。测试可说“查看系统状态”。创建任务返回的确认单保留在内存中，后续用户语音确认后才交给服务端处理，不自动确认。

已完成一次真实设备端到端验收：用户说“你好管家”后唤醒，本机识别“查看系统状态。”，AgentCenter 返回系统查询回复，本机发送 123 个语音包，用户确认听到回复。回复中的“定时异常 1”是 AgentCenter 的业务状态，语音通道此次传输成功。首轮暴露的旧连接阻塞、录音超时及播放后重复启动录音问题已修复，相关 23 项测试通过。

最终资源使用官方默认识别阈值 0.2。用户也已确认“你好小智，现在几点了”收到原小智回复，两个唤醒路由均通过实测。原小智回答后继续显示“聆听”属于连续对话状态；管家通道按一次请求回复后回到待机。

## 启动依赖

网关 `backend/app/services/hwexec/xiaozhi_wifi.py` 复用原 MQTT 中转。语音模块为 `agentcenter_voice.py`；模型复用本机缓存 `/Users/qiubin/.cache/modelscope/hub/models/iic/SenseVoiceSmall`。运行依赖位于 `/private/tmp/velxio-sensevoice-deps`，还有本机 ffmpeg、libopus 和 macOS Tingting 语音。

```bash
cd backend
PYTHONPATH=/private/tmp/velxio-sensevoice-deps \
VELXIO_XIAOZHI_LAN_IP=192.168.0.196 \
VELXIO_AGENTCENTER_DEVICE_CONFIG=/Users/qiubin/gitcom/velxio/logs/agentcenter-device.json \
VELXIO_VOICE_ASR_BACKEND=sensevoice \
VELXIO_VOICE_ASR_MODEL=/Users/qiubin/.cache/modelscope/hub/models/iic/SenseVoiceSmall \
python -m app.services.hwexec.xiaozhi_wifi
```

首次接入需重启小智，以获取本机 MQTT 配置。中转把上游地址和两个路由主题保存在 `logs/xiaozhi-wifi-routing.json`，不保存 MQTT 账号密码；后续中转重启可接受设备自动重连，同一设备的旧 TCP 会话会被新连接替换。当前未安装开机自启，临时依赖目录删除后需重新安装。端口 1883 为设备 MQTT、8767 为音频 UDP、8766 为设备配置和本机控制；`/voice/status` 只允许本机读取，包含音频包计数、语音处理阶段、最近一次文字识别与回复，调试状态仅存内存。

## 资源与恢复

`cli/scripts/xiaozhi-dual-wake.py` 生成并检查资源包，保留原界面、字体、原 WakeNet 模型，仅增加 MultiNet/FST 模型及双唤醒指令。原资源分区完整备份为 `logs/xiaozhi-assets-before-guanjia.bin`。恢复时将该备份写回资源地址 `0x800000`；不需要替换程序固件。旧连接配置备份见 [小智通道说明](xiaozhi-channel.md)。

测试：`test/backend/unit/test_agentcenter_voice.py` 验证唤醒词路由、通道隔离及真实 Opus 编解码。硬件和语音验收记录位于 `cli/logs/agentcenter-wake-validation.json`；`voice_end_to_end_verified` 只有设备唤醒、识别、服务回复及用户确认听到播放后才置为 true。
