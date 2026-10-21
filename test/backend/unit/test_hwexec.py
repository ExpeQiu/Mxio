"""硬件执行服务：固件校验、任务锁、ESP32 / SSH 闭环、部署边界。"""

from __future__ import annotations

import asyncio
import base64
import struct
import subprocess
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.exec import router
from app.mcp.server import list_esp32_devices
from app.services.hwexec.boundary import authorize
from app.services.hwexec.image import inspect_firmware
from app.services.hwexec.pi_canvas import LevelTracker, PiCanvasHub, classify_line
from app.services.hwexec.pi_ssh import validate_target
from app.services.hwexec.runner import execute
from app.services.hwexec.sim import run_simulation
from app.services.hwexec.tasks import TaskStore, reset_store


def _merged_esp32() -> bytes:
    size = 0x20000
    buf = bytearray(b"\xff" * size)
    buf[0x1000] = 0xE9
    entry = struct.pack(
        "<HBBII16sI",
        0x50AA,
        0x00,
        0x00,
        0x10000,
        0x10000,
        b"app0".ljust(16, b"\x00"),
        0,
    )
    buf[0x8000:0x8000 + 32] = entry
    buf[0x10000] = 0xE9
    return bytes(buf)


def _app_only() -> bytes:
    return b"\xe9" + b"\x00" * 31


class _Compiler:
    def __init__(self, payload: dict):
        self.payload = payload

    async def compile(self, files, board):
        return self.payload


class _Esp:
    def __init__(self):
        self.address = None
        self.flashed = 0

    async def flash(self, port, image, address, chip, on_pid=None, timeout=90):
        self.address = address
        self.flashed += 1
        return {"ok": True, "logs": "Hash of data verified.", "error": None}

    async def capture(self, port, baud, duration_s, serial_input):
        echoed = serial_input or ""
        return {"ok": True, "logs": f"boot ok\n{echoed}ready\n", "error": None}

    async def reset(self, port, chip, on_pid=None, timeout=20):
        return {"ok": True, "logs": "Hard resetting", "error": None}


class _Pi:
    def __init__(self, logs="PASS\n", exit_code=0, ok=True):
        self.logs = logs
        self.exit_code = exit_code
        self.ok = ok
        self.deployed = None

    async def deploy(self, **kwargs):
        self.deployed = kwargs["files"]
        return {"ok": True, "logs": "uploaded\n", "exit_code": 0, "error": None}

    async def run_test(self, **kwargs):
        return {
            "ok": self.ok,
            "logs": self.logs,
            "exit_code": self.exit_code,
            "error": None if self.ok else f"远程命令退出 {self.exit_code}",
        }

    async def start(self, **kwargs):
        return {"ok": True, "logs": "started\n", "exit_code": 0, "error": None}

    async def stop(self, **kwargs):
        return {"ok": True, "logs": "stopped\n", "exit_code": 0, "error": None}

    async def logs(self, **kwargs):
        return {"ok": True, "logs": self.logs, "exit_code": 0, "error": None}


@pytest.fixture
def store(tmp_path: Path) -> TaskStore:
    return TaskStore(tmp_path / "exec.sqlite")


@pytest.fixture(autouse=True)
def _clear_exec_env(monkeypatch: pytest.MonkeyPatch):
    for key in (
        "VELXIO_EXEC_TOKEN",
        "VELXIO_DEVICE_ALLOW",
        "VELXIO_HARDWARE_LOCAL",
        "VELXIO_SSH_ACCEPT_NEW",
    ):
        monkeypatch.delenv(key, raising=False)


def test_merged_image_flash_address_and_partitions():
    report = inspect_firmware(_merged_esp32(), "esp32:esp32:esp32")
    assert report["ok"] is True
    assert report["format"] == "merged"
    assert report["flash_address"] == 0
    assert report["bootloader_offset"] == 0x1000
    assert report["partitions"][0]["name"] == "app0"
    assert report["partitions"][0]["offset"] == 0x10000


def test_app_image_uses_application_address():
    report = inspect_firmware(_app_only(), "esp32")
    assert report["ok"] is True
    assert report["format"] == "app"
    assert report["flash_address"] == 0x10000


def test_c3_bootloader_lives_at_zero():
    image = bytearray(b"\xff" * 0x20000)
    image[0] = 0xE9
    entry = struct.pack(
        "<HBBII16sI",
        0x50AA,
        0x00,
        0x00,
        0x10000,
        0x10000,
        b"app0".ljust(16, b"\x00"),
        0,
    )
    image[0x8000:0x8020] = entry
    image[0x10000] = 0xE9
    report = inspect_firmware(bytes(image), "esp32c3")
    assert report["ok"] is True
    assert report["bootloader_offset"] == 0


def test_rejects_ihex_and_misaligned_app():
    assert inspect_firmware(b":00000001FF\n", "esp32")["format"] == "ihex"
    shifted = bytearray(_merged_esp32())
    struct.pack_into("<I", shifted, 0x8000 + 4, 0x11000)
    bad = inspect_firmware(bytes(shifted), "esp32")
    assert bad["ok"] is False
    assert any("64KB" in item for item in bad["errors"])


@pytest.mark.asyncio
async def test_esp32_cycle_flashes_validated_address(store: TaskStore):
    encoded = base64.b64encode(_merged_esp32()).decode()
    board = _Esp()
    result = await execute(
        files=[{"name": "sketch.ino", "content": "void setup(){}"}],
        board="esp32:esp32:esp32",
        target="esp32",
        port="/dev/ttyUSB0",
        expect=["ready"],
        serial_input="ping",
        compiler=_Compiler(
            {
                "success": True,
                "binary_content": encoded,
                "hex_content": None,
                "stdout": "compiled",
                "stderr": "",
                "error": None,
            }
        ),
        esp32=board,
        store=store,
        via="mcp",
    )
    assert result["success"] is True
    assert result["status"] == "succeeded"
    assert board.address == 0
    assert board.flashed == 1
    assert result["image"]["format"] == "merged"
    assert any(item["passed"] for item in result["assertions"])


@pytest.mark.asyncio
async def test_esp32_refuses_invalid_image_before_flash(store: TaskStore):
    board = _Esp()
    encoded = base64.b64encode(b":00000001FF\n").decode()
    result = await execute(
        files=[{"name": "sketch.ino", "content": "void setup(){}"}],
        board="esp32:esp32:esp32",
        target="esp32",
        port="/dev/ttyUSB0",
        compiler=_Compiler(
            {
                "success": True,
                "binary_content": encoded,
                "hex_content": None,
                "stdout": "",
                "stderr": "",
                "error": None,
            }
        ),
        esp32=board,
        store=store,
        via="mcp",
    )
    assert result["success"] is False
    assert result["error_code"] == "IMAGE"
    assert board.flashed == 0


@pytest.mark.asyncio
async def test_app_image_flashes_at_0x10000(store: TaskStore):
    board = _Esp()
    encoded = base64.b64encode(_app_only()).decode()
    result = await execute(
        firmware_b64=encoded,
        board="esp32:esp32:esp32",
        target="esp32",
        port="/dev/ttyUSB0",
        expect=["ready"],
        esp32=board,
        store=store,
        via="mcp",
    )
    assert result["success"] is True
    assert board.address == 0x10000


@pytest.mark.asyncio
async def test_pi_cycle_checks_exit_and_log(store: TaskStore):
    pi = _Pi()
    result = await execute(
        files=[{"name": "main.py", "content": "print('PASS')\n"}],
        target="pi",
        expect=["PASS"],
        pi={"host": "pi.local", "start_cmd": "python3 main.py", "action": "cycle"},
        pi_runner=pi,
        store=store,
        via="mcp",
    )
    assert result["success"] is True
    assert result["exit_code"] == 0
    assert pi.deployed[0]["name"] == "main.py"


@pytest.mark.asyncio
async def test_pi_nonzero_exit_fails(store: TaskStore):
    result = await execute(
        files=[{"name": "main.py", "content": "raise SystemExit(2)\n"}],
        target="pi",
        pi={"host": "pi.local", "start_cmd": "python3 main.py"},
        pi_runner=_Pi(logs="boom\n", exit_code=2, ok=False),
        store=store,
        via="mcp",
    )
    assert result["success"] is False
    assert result["error_code"] == "EXIT"
    assert result["exit_code"] == 2


@pytest.mark.asyncio
async def test_sim_runner_returns_serial_and_assertions(store: TaskStore):
    async def sim_runner(**kwargs):
        assert kwargs["board"].startswith("esp32")
        return {"ran": True, "engine": "qemu", "logs": "tick\n", "error": None}

    result = await execute(
        files=[{"name": "sketch.ino", "content": "void setup(){}"}],
        board="esp32:esp32:esp32",
        target="sim",
        expect=["tick"],
        compiler=_Compiler(
            {
                "success": True,
                "binary_content": base64.b64encode(b"\xe9\x00").decode(),
                "hex_content": None,
                "stdout": "",
                "stderr": "",
                "error": None,
            }
        ),
        sim_runner=sim_runner,
        store=store,
        via="mcp",
    )
    assert result["success"] is True
    assert result["simulation_ready"] is True
    assert result["engine"] == "qemu"


@pytest.mark.asyncio
async def test_qemu_serial_capture_without_binary():
    async def spawn(*argv, stdout=None, stderr=None):
        token = next(part for part in argv if isinstance(part, str) and part.startswith("tcp:"))
        port = int(token.split(",")[0].rsplit(":", 1)[1])
        ready = asyncio.Event()

        async def handle(_reader, writer):
            writer.write(b"qemu-serial-ok\n")
            await writer.drain()
            await asyncio.sleep(0.4)
            writer.close()

        async def serve():
            server = await asyncio.start_server(handle, "127.0.0.1", port)
            ready.set()
            await asyncio.sleep(1)
            server.close()
            await server.wait_closed()

        asyncio.create_task(serve())
        await ready.wait()

        class _Proc:
            pid = 0
            stderr = None
            returncode = None

            async def wait(self):
                self.returncode = 0
                return 0

        return _Proc()

    result = await run_simulation(
        board="esp32:esp32:esp32",
        firmware_b64=base64.b64encode(b"\xff" * 16).decode(),
        hex_content=None,
        duration_s=0.3,
        serial_input="",
        spawn=spawn,
    )
    assert result["ran"] is True
    assert "qemu-serial-ok" in result["logs"]
    assert result["engine"] == "qemu"


@pytest.mark.asyncio
async def test_timeout_marks_task(store: TaskStore):
    async def slow(**kwargs):
        await asyncio.sleep(5)
        return {"ran": True, "engine": "qemu", "logs": "", "error": None}

    result = await execute(
        files=[{"name": "sketch.ino", "content": "void setup(){}"}],
        board="arduino:avr:uno",
        target="sim",
        timeout_s=0.2,
        compiler=_Compiler(
            {
                "success": True,
                "hex_content": ":00000001FF",
                "binary_content": None,
                "stdout": "",
                "stderr": "",
                "error": None,
            }
        ),
        sim_runner=slow,
        store=store,
        via="mcp",
    )
    assert result["status"] == "timeout"
    saved = store.get(result["task_id"])
    assert saved is not None
    assert saved["status"] == "timeout"


def test_device_lock_and_recover(tmp_path: Path):
    path = tmp_path / "exec.sqlite"
    store = TaskStore(path)
    owner = store.create("esp32", "/dev/ttyUSB0")
    store.mark(owner, "running")
    assert store.acquire("/dev/ttyUSB0", owner) is True
    other = store.create("esp32", "/dev/ttyUSB0")
    assert store.acquire("/dev/ttyUSB0", other) is False

    proc = subprocess.Popen(["sleep", "30"], start_new_session=True)
    store.set_pid(owner, proc.pid)
    revived = TaskStore(path)
    saved = revived.get(owner)
    assert saved is not None
    assert saved["status"] == "failed"
    assert saved["error"] == "进程重启时中断"
    proc.wait(timeout=2)


def test_cancel_kills_process_group(store: TaskStore):
    proc = subprocess.Popen(["sleep", "30"], start_new_session=True)
    task_id = store.create("pi", "pi.local")
    store.mark(task_id, "running")
    store.set_pid(task_id, proc.pid)
    cancelled = store.cancel(task_id)
    assert cancelled is not None
    assert cancelled["status"] == "cancelled"
    proc.wait(timeout=2)


def test_real_pi_lines_split_serial_and_gpio():
    tracker = LevelTracker()
    serial, changes = classify_line("##VELXIO_LEV## 1 0 - 1", tracker)
    assert serial is None
    assert changes == [(0, 1), (1, 0), (3, 1)]
    again, same = classify_line("##VELXIO_LEV## 1 0 - 1", tracker)
    assert again is None and same == []
    text, pins = classify_line("velxio-pi-ok", tracker)
    assert text == "velxio-pi-ok\n"
    assert pins == []


@pytest.mark.asyncio
async def test_canvas_hub_forwards_gpio_to_subscribers():
    seen: list[tuple[str, dict]] = []

    async def callback(event_type: str, data: dict):
        seen.append((event_type, data))

    board = PiCanvasHub()
    board.subscribe("192.168.0.194", "tab-1", callback)
    await board.emit("192.168.0.194", "serial_output", {"data": "hi\n"})
    await board.emit("192.168.0.194", "gpio_change", {"pin": 17, "state": 1})
    board.unsubscribe("tab-1")
    await board.emit("192.168.0.194", "gpio_change", {"pin": 17, "state": 0})
    assert seen == [
        ("serial_output", {"data": "hi\n"}),
        ("gpio_change", {"pin": 17, "state": 1}),
    ]


def test_diagnosis_names_the_python_error():
    from app.services.hwexec.diagnose import explain

    report = explain("start\nTraceback (most recent call last):\nValueError: bad pin\n", 1, [(17, 1), (18, 0)])
    assert report["gpio_high"] == [17]
    assert "ValueError: bad pin" in report["summary"]
    assert "退出码是 1" in report["summary"]


@pytest.mark.asyncio
async def test_pi_sim_uses_virtual_guest(store: TaskStore, monkeypatch: pytest.MonkeyPatch):
    async def guest(**kwargs):
        assert kwargs["board"] == "raspberry-pi-3"
        return {"ran": True, "engine": "pi-qemu", "logs": "booted\nready\n", "error": None, "board": "raspberry-pi-3"}

    monkeypatch.setattr("app.services.hwexec.runner.run_pi_virtual", guest)
    result = await execute(
        files=[{"name": "main.py", "content": "print('ready')\n"}],
        board="raspberry-pi-3",
        target="sim",
        expect=["ready"],
        store=store,
        via="mcp",
    )
    assert result["success"] is True
    assert result["engine"] == "pi-qemu"
    assert result["simulation_ready"] is True


@pytest.mark.asyncio
async def test_esp32_serial_reaches_canvas_channel(store: TaskStore):
    from app.services.hwexec.runner import _publish_console

    seen: list[tuple[str, dict]] = []

    async def callback(event_type: str, data: dict):
        seen.append((event_type, data))

    from app.services.hwexec.pi_canvas import hub

    hub.subscribe("esp32:/dev/ttyUSB0", "tab", callback)
    await _publish_console("esp32:/dev/ttyUSB0", "boot\nGPIO 2 1\n")
    hub.unsubscribe("tab")
    assert seen[0] == ("serial_output", {"data": "boot\nGPIO 2 1\n"})
    assert seen[1] == ("gpio_change", {"pin": 2, "state": 1})
    _ = store


def test_ssh_target_rejects_shell_metacharacters():
    assert validate_target("pi.local", "pi", "/tmp/velxio") is None
    assert validate_target("pi.local;rm", "pi", "/tmp/velxio") is not None
    assert validate_target("pi.local", "pi", "/tmp/../etc") is not None


def test_remote_requires_token_and_device_allow(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("VELXIO_EXEC_TOKEN", "secret")
    monkeypatch.setenv("VELXIO_DEVICE_ALLOW", "/dev/ttyUSB0,pi.local")
    ok = authorize(
        via="http",
        target="esp32",
        device="/dev/ttyUSB0",
        client_host="10.1.1.8",
        authorization="Bearer secret",
    )
    assert ok.ok is True
    missing = authorize(
        via="http",
        target="esp32",
        device="/dev/ttyUSB0",
        client_host="10.1.1.8",
        authorization=None,
    )
    assert missing.error_code == "AUTH"
    foreign = authorize(
        via="http",
        target="esp32",
        device="/dev/ttyUSB1",
        client_host="10.1.1.8",
        authorization="Bearer secret",
    )
    assert foreign.error_code == "BOUNDARY"


def test_container_blocks_usb_but_allows_sim(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("VELXIO_HARDWARE_LOCAL", "0")
    usb = authorize(
        via="mcp",
        target="esp32",
        device="/dev/ttyUSB0",
        client_host=None,
        authorization=None,
    )
    sim = authorize(via="mcp", target="sim", device=None, client_host=None, authorization=None)
    assert usb.error_code == "BOUNDARY"
    assert sim.ok is True


@pytest.mark.asyncio
async def test_container_device_list_is_refused(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("VELXIO_HARDWARE_LOCAL", "0")
    result = await list_esp32_devices()
    assert result["ok"] is False
    assert result["devices"] == []


def test_http_demo_and_usb_boundary(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setenv("VELXIO_EXEC_DB", str(tmp_path / "http.sqlite"))
    monkeypatch.setenv("VELXIO_HARDWARE_LOCAL", "0")
    reset_store()
    app = FastAPI()
    app.include_router(router, prefix="/api/exec")
    client = TestClient(app)
    denied = client.post(
        "/api/exec/run",
        json={
            "target": "esp32",
            "port": "/dev/ttyUSB0",
            "board": "esp32:esp32:esp32",
            "files": [{"name": "sketch.ino", "content": "void setup(){}"}],
        },
    )
    assert denied.status_code == 403
    demo = client.post(
        "/api/exec/run",
        json={
            "target": "sim",
            "demo": True,
            "expect": ["ready"],
            "files": [{"name": "sketch.ino", "content": "void setup(){}"}],
        },
    )
    assert demo.status_code == 200
    body = demo.json()
    assert body["success"] is True
    assert "ready" in body["logs"]
    listed = client.get("/api/exec/esp32/devices")
    assert listed.status_code == 403


@pytest.mark.asyncio
async def test_jtag_is_explicitly_unsupported(store: TaskStore):
    result = await execute(target="jtag", via="mcp", store=store)
    assert result["success"] is False
    assert result["error_code"] == "UNSUPPORTED"
    assert "JTAG" in result["error"]
