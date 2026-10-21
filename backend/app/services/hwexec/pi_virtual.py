"""Codex 拉起的树莓派虚拟机。有本地镜像才启动 QEMU，并把串口和 GPIO 送到画布。"""

from __future__ import annotations

import asyncio
import logging
import shutil
import uuid
from typing import Any

from app.services.hwexec.pi_canvas import hub

logger = logging.getLogger("velxio.hwexec")

_BOOT_MARKERS = ("login on 'hvc0'", ":~$", ":~# ")


def pi_board_name(board: str) -> str | None:
    text = (board or "").lower()
    if "pico" in text:
        return None
    if "raspberry-pi" not in text and not text.startswith("pi"):
        return None
    for name in (
        "raspberry-pi-zero",
        "raspberry-pi-5",
        "raspberry-pi-4",
        "raspberry-pi-3",
        "raspberry-pi-2",
        "raspberry-pi-1",
    ):
        if name in text:
            return name
    if "raspberry-pi" in text:
        return "raspberry-pi-3"
    return None


def guest_availability(board: str) -> dict[str, Any]:
    """不下载镜像。缺 QEMU 或本地引导文件时直接说明原因。"""
    name = pi_board_name(board)
    if name is None:
        return {"ok": False, "error": f"{board} 不是可虚拟启动的树莓派"}
    from app.services.qemu_manager import PI_CONFIGS, qemu_manager

    cfg = PI_CONFIGS[name]
    qemu_bin = cfg["qemu"]
    if not (shutil.which(qemu_bin) or shutil.which(qemu_bin.split("/")[-1])):
        logger.warning("树莓派虚拟机缺少 %s", qemu_bin)
        return {"ok": False, "board": name, "error": f"未找到 {qemu_bin}"}
    image_set = cfg["image_set"]
    if not qemu_manager._get_provider().is_cached(image_set):
        logger.info("树莓派引导镜像不在本地 set=%s", image_set)
        return {
            "ok": False,
            "board": name,
            "error": f"引导镜像 {image_set} 尚未缓存，虚拟机不会启动",
        }
    return {"ok": True, "board": name, "image_set": image_set}


def _script_file(files: list[dict[str, str]]) -> tuple[str, str] | None:
    py = [item for item in files if str(item.get("name", "")).endswith(".py")]
    if not py:
        return None
    chosen = next((item for item in py if item["name"] in {"main.py", "script.py"}), py[0])
    return str(chosen["name"]), str(chosen.get("content") or "")


async def run_pi_virtual(
    *,
    board: str,
    files: list[dict[str, str]],
    duration_s: float,
    serial_input: str = "",
) -> dict[str, Any]:
    status = guest_availability(board)
    if not status["ok"]:
        return {
            "ran": False,
            "engine": "pi-qemu",
            "logs": "",
            "error": status["error"],
            "board": status.get("board"),
        }
    name = status["board"]
    channel = f"qemu:{name}"
    script = _script_file(files)
    logs: list[str] = []
    ready = asyncio.Event()
    failed: list[str] = []

    async def on_event(event_type: str, data: dict[str, Any]) -> None:
        if event_type in {"serial_output", "gpio_change", "gpio_pwm", "error"}:
            await hub.emit(channel, event_type, data)
        if event_type == "serial_output":
            text = str(data.get("data") or "")
            logs.append(text)
            if any(marker in text for marker in _BOOT_MARKERS):
                ready.set()
        elif event_type == "error":
            failed.append(str(data.get("message") or "虚拟机错误"))
            ready.set()

    from app.services.qemu_manager import qemu_manager

    client_id = f"codex-pi-{uuid.uuid4().hex[:8]}"
    logger.info("启动树莓派虚拟机 board=%s client=%s", name, client_id)
    qemu_manager.start_instance(client_id, name, on_event)
    try:
        await asyncio.wait_for(ready.wait(), 75)
    except TimeoutError:
        logger.warning("树莓派虚拟机启动超时 client=%s", client_id)
        qemu_manager.stop_instance(client_id)
        return {
            "ran": False,
            "engine": "pi-qemu",
            "logs": "".join(logs)[-8000:],
            "error": "树莓派虚拟机在 75 秒内没有进入系统",
            "board": name,
        }
    if failed and not any(marker in "".join(logs) for marker in _BOOT_MARKERS):
        qemu_manager.stop_instance(client_id)
        return {
            "ran": False,
            "engine": "pi-qemu",
            "logs": "".join(logs)[-8000:],
            "error": failed[-1],
            "board": name,
        }
    if script:
        _name, content = script
        marker = "VELXIO_PY_EOF"
        while marker in content:
            marker += "X"
        command = (
            f"cat > /tmp/velxio-run.py << '{marker}'\n{content}\n{marker}\n"
            "python3 -u /tmp/velxio-run.py\n"
        )
        if serial_input:
            command = serial_input + command
        logger.info("向虚拟机写入并运行 %s", _name)
        await qemu_manager.send_serial_bytes(client_id, command.encode("utf-8"))
    await asyncio.sleep(max(0.5, duration_s))
    qemu_manager.stop_instance(client_id)
    text = "".join(logs)[-8000:]
    logger.info("树莓派虚拟机结束 board=%s bytes=%d", name, len(text))
    return {"ran": True, "engine": "pi-qemu", "logs": text, "error": None, "board": name}
