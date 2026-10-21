"""限时 QEMU 串口采集。命令行与 EspQemuManager 的 UART TCP 方式一致。"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import shutil
import socket
import tempfile
from typing import Any, Awaitable, Callable

from app.services.hwexec.image import esp_board_type
from app.services.hwexec.proc import kill_group

logger = logging.getLogger("velxio.hwexec")

QEMU_XTENSA = os.environ.get("QEMU_ESP32_BINARY", "qemu-system-xtensa")
QEMU_RISCV32 = os.environ.get("QEMU_RISCV32_BINARY", "qemu-system-riscv32")
_MACHINE = {
    "esp32": (QEMU_XTENSA, "esp32"),
    "esp32-s3": (QEMU_XTENSA, "esp32s3"),
    "esp32-c3": (QEMU_RISCV32, "esp32c3"),
}

Spawn = Callable[..., Awaitable[asyncio.subprocess.Process]]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def qemu_available(board_type: str) -> str | None:
    pair = _MACHINE.get(board_type)
    if not pair:
        return None
    binary = pair[0]
    if os.path.isfile(binary) or shutil.which(binary):
        return binary
    return None


async def run_simulation(
    *,
    board: str,
    firmware_b64: str | None,
    hex_content: str | None,
    duration_s: float,
    serial_input: str,
    on_pid=None,
    spawn: Spawn | None = None,
) -> dict[str, Any]:
    """真正拉起仿真并收集串口。没有对应引擎时明确返回未执行。"""
    board_type = esp_board_type(board)
    if board_type is None:
        if hex_content:
            logger.info("AVR 仿真只在浏览器里跑，board=%s", board)
            return {
                "ran": False,
                "engine": "avr-browser",
                "logs": "",
                "error": "AVR 仿真在浏览器中执行，当前执行器没有无头 AVR",
            }
        return {
            "ran": False,
            "engine": "none",
            "logs": "",
            "error": f"没有适合 {board} 的无头仿真",
        }

    binary = qemu_available(board_type)
    if spawn is None and binary is None:
        logger.warning("QEMU 不可用 board=%s", board_type)
        return {
            "ran": False,
            "engine": "qemu",
            "logs": "",
            "error": "qemu_unavailable",
        }
    if not firmware_b64:
        return {
            "ran": False,
            "engine": "qemu",
            "logs": "",
            "error": "编译结果没有可加载的固件",
        }

    firmware_path = _write_firmware(firmware_b64)
    serial_port = _free_port()
    qemu_bin, machine = _MACHINE[board_type]
    argv = [
        binary or qemu_bin,
        "-nographic",
        "-machine",
        machine,
        "-serial",
        f"tcp:127.0.0.1:{serial_port},server=on,wait=off",
        "-drive",
        f"file={firmware_path},if=mtd,format=raw",
    ]
    logger.info("启动 QEMU 仿真 machine=%s port=%s duration=%s", machine, serial_port, duration_s)
    starter = spawn or _spawn
    proc = await starter(*argv, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    if on_pid and proc.pid:
        on_pid(proc.pid)
    logs = ""
    error = None
    connected = False
    try:
        connected, logs = await _capture_serial(serial_port, duration_s, serial_input)
        if not connected:
            error = "无法连接 QEMU 串口"
            stderr = ""
            if proc.stderr:
                try:
                    raw = await asyncio.wait_for(proc.stderr.read(4000), 0.2)
                    stderr = raw.decode("utf-8", "replace")
                except TimeoutError:
                    stderr = ""
            if stderr:
                error = f"{error}: {stderr[:500]}"
    finally:
        kill_group(proc.pid)
        try:
            await asyncio.wait_for(proc.wait(), 2)
        except TimeoutError:
            logger.warning("QEMU 退出超时 pid=%s", proc.pid)
        try:
            os.unlink(firmware_path)
        except OSError:
            logger.warning("删除临时固件失败 path=%s", firmware_path)
    logger.info("QEMU 结束 connected=%s log_bytes=%d", connected, len(logs))
    return {"ran": connected, "engine": "qemu", "logs": logs, "error": error}


def _write_firmware(firmware_b64: str) -> str:
    raw = base64.b64decode(firmware_b64)
    handle = tempfile.NamedTemporaryFile(suffix=".bin", delete=False)
    handle.write(raw)
    handle.close()
    return handle.name


async def _spawn(*argv, stdout, stderr) -> asyncio.subprocess.Process:
    return await asyncio.create_subprocess_exec(
        *argv,
        stdout=stdout,
        stderr=stderr,
        stdin=asyncio.subprocess.DEVNULL,
        start_new_session=True,
    )


async def _capture_serial(port: int, duration_s: float, serial_input: str) -> tuple[bool, str]:
    deadline = asyncio.get_running_loop().time() + max(0.2, duration_s)
    reader = None
    writer = None
    for _ in range(20):
        if asyncio.get_running_loop().time() >= deadline:
            break
        try:
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            break
        except (ConnectionRefusedError, OSError):
            await asyncio.sleep(0.1)
    if reader is None or writer is None:
        return False, ""
    chunks: list[str] = []
    try:
        if serial_input:
            writer.write(serial_input.encode("utf-8", "replace"))
            await writer.drain()
        while asyncio.get_running_loop().time() < deadline:
            remain = deadline - asyncio.get_running_loop().time()
            try:
                data = await asyncio.wait_for(reader.read(1024), min(0.2, max(0.05, remain)))
            except TimeoutError:
                continue
            if not data:
                break
            chunks.append(data.decode("utf-8", "replace"))
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            logger.debug("关闭 QEMU 串口连接", exc_info=True)
    return True, "".join(chunks)
