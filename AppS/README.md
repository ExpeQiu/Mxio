# 虚拟应用平台（AppS）

模板：6（Velxio 宿主）+ 1（采集→管道→展示）；应用清单为 4-lite 注册表。  
参考：`ADR/ADR-014-virtual-app-platform.md`

所有 VAP 代码在本目录，编辑器经 `@apps` 引用，后端把 `AppS/server` 挂到 `/api/vap`。

```
PC 窗口 / STT  →  Host 桥  →  UART0  →  固件状态机  →  OLED / 蜂鸣 / LED / 喇叭
```

| 路径 | 内容 |
|------|------|
| `web/` | 虚拟遥控器、对话/视觉窗口、协议、注册表、软件→硬件跑道图 |
| `server/` | 宿主 LLM / STT 网关 |
| `tests/` | 网关单测 |

示例：http://127.0.0.1:5173/example/esp32-ai-chat
