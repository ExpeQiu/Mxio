# ESP32 按键接入豆包语音

## 当前状态

软件适配与 29 项相关测试已完成。豆包真实鉴权、音频回复和 ESP32 扬声器实播尚未验证；仍待用户提供已配置语音凭据的绝对路径。现有运行中的小智 / 管家通道尚未切换。

第一版为按键单轮问答：待机短按 BOOT → 聆听并在停顿后结束录音 → 上传原始录音至豆包 S2S 实时语音接口 → 流式接收豆包语音 → ESP32 播放 → 回到待机。录音最长 12 秒，停止录音后再上传；不是持续全双工模式。豆包通道跳过本地 SenseVoice 和 macOS 语音合成，正常回复音频由豆包生成。

“你好小智”仍走原小智，“你好管家”仍走 AgentCenter。本次不添加新的唤醒词、不写设备固件或资源分区。豆包只接管可切换的 BOOT 入口。

## 凭据

使用火山引擎已开通的“端到端实时语音大模型”服务凭据。示例为 `cli/fixtures/doubao-voice.env.example`，实际密钥应留在私有配置文件中，勿提交或发送到聊天。客户端接受 `.env` 或 JSON，JSON 对应字段为 `api_key`，或 `app_id` + `access_token`，以及可选 `model`、`speaker`。

默认协议为官方 S2S 二进制 WebSocket，地址 `wss://openspeech.bytedance.com/api/v3/realtime/dialogue`，资源 `volc.speech.dialog`，模型 `1.2.1.1`（O2.0）。本适配不实现 Seeduplex 3.0 的 JSON 协议；若账号只开通 3.0，需要另行选择对应协议，不可混用。

旧版凭据使用 APP ID / Access Token；新版 Speech API Key 使用 `X-Api-Key`。仅有方舟文字模型 API Key 不代表拥有语音服务权限，必须实测服务鉴权与 SessionStarted 回执。错误状态和服务拒绝不触发自动重试，避免重复收费请求。

## 启动与切换

通过 `VELXIO_DOUBAO_CONFIG` 指定凭据路径，网关启动时只验证字段，不声称鉴权已成功。保留原 AgentCenter 与模型环境变量，另加：

```bash
export VELXIO_DOUBAO_CONFIG="/absolute/path/to/doubao-voice.env"
export VELXIO_BUTTON_ROUTE=doubao
```

再按 [原语音网关启动方式](agentcenter-voice.md) 启动新版本网关。后端也需加载新增的 `/api/exec/esp32/voice-route`。运行期间可切换下一次 BOOT 对话的服务，不中断当前对话：

```bash
cli/bin/velxio device voice --button-route doubao
cli/bin/velxio device voice --button-route agentcenter
```

未配置豆包服务时切换会失败，避免把按钮导向无法工作的通道。配置验证失败时应保留原运行进程，勿先停止旧服务。

## 音频与验证

设备麦克风音频经 AES-CTR / Opus 解码成 16 kHz、单声道 PCM16，小端序；按 20ms 分包上传。豆包输出明确请求 24 kHz PCM16，小端序；通过持续的 Opus 编码器分帧，再按设备音频格式重采样、加密并实时播放。处理流式包边界和末帧填充，接收 TTSEnded 后等待 FinishSession 回执并释放云端连接。

测试 `test/backend/unit/test_doubao_voice.py` 使用模拟 WebSocket 服务，不代表豆包真实服务可用。验收必须分别确认实际 WebSocket 鉴权、SessionStarted、非空回复音频、设备唤醒/按键入口，以及用户听到回复。报告 `cli/logs/doubao-voice-validation.json` 明确区分软件验证与真实验证。

协议依据：[官方端到端实时语音接口](https://www.volcengine.com/docs/6561/1594356)。
