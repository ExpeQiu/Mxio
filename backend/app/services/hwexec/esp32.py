"""ESP32 本机 USB：发现、烧录、复位、串口读写和限时日志。"""

from __future__ import annotations

import asyncio
import logging
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

from app.services.hwexec.image import chip_name
from app.services.hwexec.proc import run_argv

logger = logging.getLogger("velxio.hwexec")

PORT_RE = re.compile(r"^((/dev/(cu|tty)[\w.-]+)|COM[0-9]{1,3})$", re.IGNORECASE)
ESP_VIDS = {0x303A, 0x10C4, 0x1A86, 0x0403}
FLASH_BAUD = 460800


def valid_port(port: str) -> bool:
    return bool(port) and ".." not in port and bool(PORT_RE.match(port))


def esptool_bin() -> str | None:
    for name in ("esptool", "esptool.py"):
        found = shutil.which(name)
        if found:
            return found
    return None


def list_serial_ports() -> dict[str, Any]:
    try:
        from serial.tools import list_ports
    except ImportError:
        logger.error("pyserial 不可用，无法枚举串口")
        return {"ok": False, "error": "pyserial 未安装", "devices": []}

    devices = []
    for port in list_ports.comports():
        vid = getattr(port, "vid", None)
        item = {
            "port": port.device,
            "description": port.description or "",
            "hwid": port.hwid or "",
            "vid": vid,
            "likely_esp32": vid in ESP_VIDS,
        }
        devices.append(item)
        logger.info("发现串口 port=%s likely_esp32=%s", port.device, item["likely_esp32"])
    return {"ok": True, "devices": devices}


class Esp32Usb:
    """通过 esptool 和 pyserial 操作插在本机上的 ESP32。"""

    async def flash(
        self,
        port: str,
        image: bytes,
        address: int,
        chip: str,
        *,
        on_pid=None,
        timeout: float = 90,
    ) -> dict[str, Any]:
        if not valid_port(port):
            return {"ok": False, "logs": "", "error": f"非法串口 {port}"}
        if address < 0 or address >= 16 * 1024 * 1024 or address % 0x1000 != 0:
            return {"ok": False, "logs": "", "error": f"烧录地址非法 0x{address:X}"}
        tool = esptool_bin()
        if tool is None:
            logger.error("未找到 esptool")
            return {"ok": False, "logs": "", "error": "esptool 未安装"}

        path = _dump_image(image)
        argv = [
            tool,
            "--chip",
            chip_name(chip),
            "--port",
            port,
            "--baud",
            str(FLASH_BAUD),
            "write_flash",
            f"0x{address:X}",
            path,
        ]
        logger.info("烧录 port=%s address=0x%X bytes=%d", port, address, len(image))
        try:
            code, logs = await run_argv(argv, timeout=timeout, on_pid=on_pid)
        except TimeoutError:
            logger.warning("烧录超时 port=%s", port)
            return {"ok": False, "logs": "", "error": "烧录超时"}
        finally:
            Path(path).unlink(missing_ok=True)
        ok = code == 0
        if not ok:
            logger.warning("烧录失败 port=%s code=%s", port, code)
        return {"ok": ok, "logs": logs, "error": None if ok else f"esptool 退出 {code}"}

    async def reset(self, port: str, chip: str, *, on_pid=None, timeout: float = 20) -> dict[str, Any]:
        if not valid_port(port):
            return {"ok": False, "logs": "", "error": f"非法串口 {port}"}
        tool = esptool_bin()
        if tool is None:
            return {"ok": False, "logs": "", "error": "esptool 未安装"}
        argv = [tool, "--chip", chip_name(chip), "--port", port, "run"]
        logger.info("复位 port=%s chip=%s", port, chip)
        try:
            code, logs = await run_argv(argv, timeout=timeout, on_pid=on_pid)
        except TimeoutError:
            return {"ok": False, "logs": "", "error": "复位超时"}
        return {"ok": code == 0, "logs": logs, "error": None if code == 0 else f"esptool 退出 {code}"}

    async def capture(
        self,
        port: str,
        baud: int,
        duration_s: float,
        serial_input: str,
        reset: bool = True,
    ) -> dict[str, Any]:
        if not valid_port(port):
            return {"ok": False, "logs": "", "error": f"非法串口 {port}"}
        if baud < 9600 or baud > 2_000_000:
            return {"ok": False, "logs": "", "error": f"波特率非法 {baud}"}
        logger.info("采集串口 port=%s baud=%s duration=%s", port, baud, duration_s)
        try:
            logs = await asyncio.to_thread(_capture_blocking, port, baud, duration_s, serial_input, reset)
        except Exception as exc:
            logger.warning("串口采集失败 port=%s err=%s", port, exc)
            return {"ok": False, "logs": "", "error": str(exc)}
        return {"ok": True, "logs": logs, "error": None}


def _dump_image(image: bytes) -> str:
    handle = tempfile.NamedTemporaryFile(suffix=".bin", delete=False)
    handle.write(image)
    handle.close()
    return handle.name


def _capture_blocking(port: str, baud: int, duration_s: float, serial_input: str, reset: bool = True) -> str:
    import time

    import serial

    ser = serial.Serial(port=None, baudrate=baud, timeout=0.2)
    ser.dtr = False
    ser.rts = False
    ser.port = port
    try:
        ser.open()
        # 打开端口时拉一下 DTR，很多开发板会由此复位，从而抓到启动日志。
        if reset:
            ser.dtr = False
            time.sleep(0.05)
            ser.dtr = True
        if serial_input:
            ser.write(serial_input.encode("utf-8", "replace"))
            ser.flush()
        end = time.monotonic() + duration_s
        chunks: list[bytes] = []
        while time.monotonic() < end:
            chunks.append(ser.read(4096))
        return b"".join(chunks).decode("utf-8", "replace")
    finally:
        if ser.is_open:
            ser.close()
