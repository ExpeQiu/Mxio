"""CLI、MCP、HTTP 共用的编译与运行入口。"""

from __future__ import annotations

import asyncio
import base64
import logging
import re
from typing import Any

from app.services.hwexec.boundary import authorize
from app.services.hwexec.esp32 import Esp32Usb, valid_port
from app.services.hwexec.image import inspect_firmware
from app.services.hwexec.pi_canvas import hub, stream_pi_command
from app.services.hwexec.pi_ssh import OpenSshPi
from app.services.hwexec.pi_virtual import pi_board_name, run_pi_virtual
from app.services.hwexec.sim import run_simulation
from app.services.hwexec.tasks import TaskStore, get_store

logger = logging.getLogger("velxio.hwexec")

_compiler: Any = None


def set_compiler(compiler: Any) -> None:
    global _compiler
    _compiler = compiler


def get_compiler() -> Any:
    global _compiler
    if _compiler is None:
        from app.services.arduino_cli import ArduinoCLIService

        _compiler = ArduinoCLIService()
    return _compiler


async def compile_sketch(files: list[dict[str, str]], board: str, compiler: Any = None) -> dict[str, Any]:
    tool = compiler or get_compiler()
    logger.info("编译开始 board=%s files=%s", board, [item.get("name") for item in files])
    result = await tool.compile(files, board)
    logger.info(
        "编译结束 board=%s success=%s error=%s",
        board,
        result.get("success"),
        result.get("error"),
    )
    return result


def judge_logs(logs: str, expect: list[str]) -> list[dict[str, Any]]:
    verdicts = []
    for pattern in expect:
        if pattern.startswith("re:"):
            try:
                passed = re.search(pattern[3:], logs) is not None
            except re.error:
                logger.warning("断言正则无效 pattern=%s", pattern)
                passed = False
        else:
            passed = pattern in logs
        verdicts.append({"pattern": pattern, "passed": passed})
    return verdicts


async def execute(
    *,
    files: list[dict[str, str]] | None = None,
    board: str = "arduino:avr:uno",
    target: str = "sim",
    duration_s: float = 5,
    expect: list[str] | None = None,
    port: str | None = None,
    baud: int = 115200,
    firmware_b64: str | None = None,
    serial_input: str = "",
    pi: dict[str, Any] | None = None,
    demo: bool = False,
    via: str = "http",
    client_host: str | None = "127.0.0.1",
    authorization: str | None = None,
    store: TaskStore | None = None,
    compiler: Any = None,
    sim_runner=None,
    esp32: Esp32Usb | None = None,
    pi_runner: OpenSshPi | None = None,
    timeout_s: float | None = None,
) -> dict[str, Any]:
    """跑通一次：编译，然后仿真、烧录或 SSH，并给出日志和断言。"""
    files = list(files or [])
    expect = list(expect or [])
    duration_s = min(120.0, max(0.2, float(duration_s)))
    pi = dict(pi or {})
    device = _auth_device(target, port, pi)
    decision = authorize(
        via=via,
        target=target,
        device=device,
        client_host=client_host,
        authorization=authorization,
    )
    if not decision.ok:
        return _denied(decision)

    for item in files:
        if "name" not in item or "content" not in item:
            return _denied_message("每个文件都要有 name 和 content")

    task_store = store or get_store()
    lock_name = device or (f"sim:{board}" if target == "sim" else None)
    task_id = task_store.create(target, lock_name)
    held = False
    logger.info("执行任务 id=%s target=%s device=%s demo=%s", task_id, target, lock_name, demo)

    def on_pid(pid: int) -> None:
        task_store.set_pid(task_id, pid)

    try:
        if lock_name and not demo and not task_store.acquire(lock_name, task_id):
            result = _shell(
                task_id,
                target,
                success=False,
                status="failed",
                error="设备正被其他任务占用",
                error_code="DEVICE_BUSY",
            )
            task_store.finish(task_id, "failed", _slim(result), result["error"])
            return result
        if lock_name and not demo:
            held = True
        task_store.mark(task_id, "running")
        budget = timeout_s
        if budget is None:
            if target == "sim" and pi_board_name(board):
                extra = 100.0
            elif target == "esp32":
                extra = 90.0
            else:
                extra = 45.0
            budget = min(300.0, duration_s + extra)
        try:
            result = await asyncio.wait_for(
                _pipeline(
                    task_store=task_store,
                    task_id=task_id,
                    files=files,
                    board=board,
                    target=target,
                    duration_s=duration_s,
                    expect=expect,
                    port=port,
                    baud=baud,
                    firmware_b64=firmware_b64,
                    serial_input=serial_input,
                    pi=pi,
                    demo=demo,
                    compiler=compiler,
                    sim_runner=sim_runner,
                    esp32=esp32 or Esp32Usb(),
                    pi_runner=pi_runner or OpenSshPi(),
                    on_pid=on_pid,
                ),
                budget,
            )
        except TimeoutError:
            logger.warning("任务超时 id=%s budget=%s", task_id, budget)
            current = task_store.get(task_id)
            if current and current.get("pid"):
                from app.services.hwexec.proc import kill_group

                kill_group(current["pid"])
            result = _shell(
                task_id,
                target,
                success=False,
                status="timeout",
                error="任务超时",
                error_code="TIMEOUT",
            )
        except Exception as exc:
            logger.exception("任务异常 id=%s", task_id)
            result = _shell(
                task_id,
                target,
                success=False,
                status="failed",
                error=str(exc),
                error_code="ERROR",
            )
        if _is_cancelled(task_store, task_id):
            result["status"] = "cancelled"
            result["success"] = False
            result["error"] = result.get("error") or "已取消"
            result["error_code"] = "CANCELLED"
        task_store.finish(task_id, result["status"], _slim(result), result.get("error"))
        logger.info(
            "执行结束 id=%s status=%s success=%s error=%s",
            task_id,
            result["status"],
            result["success"],
            result.get("error"),
        )
        return result
    finally:
        if held:
            task_store.release(lock_name, task_id)


async def _pipeline(**kwargs: Any) -> dict[str, Any]:
    target = kwargs["target"]
    task_id = kwargs["task_id"]
    if kwargs["demo"]:
        return _demo(task_id, target, kwargs["expect"])
    if target == "jtag":
        logger.info("JTAG/GDB 尚未实现 task=%s", task_id)
        return _shell(
            task_id,
            target,
            success=False,
            status="failed",
            error="JTAG/GDB 深度调试尚未实现",
            error_code="UNSUPPORTED",
            engine="jtag",
        )
    if target == "sim":
        return await _run_sim(**kwargs)
    if target == "esp32":
        return await _run_esp32(**kwargs)
    if target == "pi":
        return await _run_pi(**kwargs)
    return _shell(
        task_id,
        target,
        success=False,
        status="failed",
        error=f"未知目标 {target}",
        error_code="USAGE",
    )


async def _run_sim(**kwargs: Any) -> dict[str, Any]:
    task_id = kwargs["task_id"]
    board = kwargs["board"]
    if pi_board_name(board):
        logger.info("树莓派改为虚拟机运行 board=%s", board)
        sim = await run_pi_virtual(
            board=board,
            files=kwargs["files"],
            duration_s=min(30.0, kwargs["duration_s"]),
            serial_input=kwargs["serial_input"],
        )
        assertions = judge_logs(sim.get("logs") or "", kwargs["expect"])
        ran = bool(sim.get("ran"))
        passed = ran and all(item["passed"] for item in assertions)
        return _shell(
            task_id,
            "sim",
            success=passed,
            status="succeeded" if passed else "failed",
            logs=sim.get("logs") or "",
            assertions=assertions,
            error=None if passed else (sim.get("error") or "仿真未执行"),
            error_code=None if passed else ("ASSERT_FAILED" if ran else "UNAVAILABLE"),
            engine=sim.get("engine"),
            simulation_ready=passed,
            trace=[{"phase": "pi-qemu", "ok": ran, "board": sim.get("board")}],
        )
    compiled = await compile_sketch(kwargs["files"], board, kwargs["compiler"])
    if not compiled.get("success"):
        return _with_compile(
            task_id,
            "sim",
            compiled,
            success=False,
            status="failed",
            error=compiled.get("error") or "编译失败",
            error_code="COMPILE_ERROR",
        )
    if _is_cancelled(kwargs["task_store"], task_id):
        return _cancelled(task_id, "sim", compiled)
    runner = kwargs["sim_runner"] or run_simulation
    sim = await runner(
        board=kwargs["board"],
        firmware_b64=compiled.get("binary_content") or kwargs["firmware_b64"],
        hex_content=compiled.get("hex_content"),
        duration_s=kwargs["duration_s"],
        serial_input=kwargs["serial_input"],
        on_pid=kwargs["on_pid"],
    )
    assertions = judge_logs(sim.get("logs") or "", kwargs["expect"])
    ran = bool(sim.get("ran"))
    passed = ran and all(item["passed"] for item in assertions)
    error = None if passed else (sim.get("error") or ("断言未通过" if ran else "仿真未执行"))
    return _with_compile(
        task_id,
        "sim",
        compiled,
        success=passed,
        status="succeeded" if passed else "failed",
        logs=sim.get("logs") or "",
        assertions=assertions,
        error=error,
        error_code=None if passed else ("ASSERT_FAILED" if ran else "UNAVAILABLE"),
        engine=sim.get("engine"),
        simulation_ready=passed,
        trace=[{"phase": "compile", "ok": True}, {"phase": "sim", "ok": ran}],
    )


async def _run_esp32(**kwargs: Any) -> dict[str, Any]:
    task_id = kwargs["task_id"]
    port = kwargs["port"] or ""
    if not valid_port(port):
        return _shell(task_id, "esp32", success=False, status="failed", error="需要合法串口", error_code="USAGE")
    compiled = None
    raw: bytes | None = None
    if kwargs["files"]:
        compiled = await compile_sketch(kwargs["files"], kwargs["board"], kwargs["compiler"])
        if not compiled.get("success"):
            return _with_compile(
                task_id,
                "esp32",
                compiled,
                success=False,
                status="failed",
                error=compiled.get("error") or "编译失败",
                error_code="COMPILE_ERROR",
            )
        if compiled.get("binary_content"):
            raw = _b64(compiled["binary_content"])
    if raw is None and kwargs["firmware_b64"]:
        raw = _b64(kwargs["firmware_b64"])
    if raw is None:
        return _with_compile(
            task_id,
            "esp32",
            compiled,
            success=False,
            status="failed",
            error="没有 ESP32 固件可烧录",
            error_code="COMPILE_ERROR",
        )
    report = inspect_firmware(raw, kwargs["board"])
    if not report["ok"] or report["flash_address"] is None:
        logger.warning("固件未通过校验 task=%s errors=%s", task_id, report["errors"])
        return _with_compile(
            task_id,
            "esp32",
            compiled,
            success=False,
            status="failed",
            error="；".join(report["errors"]) or "固件校验失败",
            error_code="IMAGE",
            image=report,
        )
    if _is_cancelled(kwargs["task_store"], task_id):
        return _cancelled(task_id, "esp32", compiled, image=report)
    flashed = await kwargs["esp32"].flash(
        port,
        raw,
        int(report["flash_address"]),
        report["chip"],
        on_pid=kwargs["on_pid"],
    )
    if not flashed["ok"]:
        return _with_compile(
            task_id,
            "esp32",
            compiled,
            success=False,
            status="failed",
            logs=flashed.get("logs") or "",
            error=flashed.get("error") or "烧录失败",
            error_code="FLASH",
            image=report,
            trace=[{"phase": "flash", "ok": False, "address": report["flash_address"]}],
        )
    if _is_cancelled(kwargs["task_store"], task_id):
        return _cancelled(task_id, "esp32", compiled, image=report)
    captured = await kwargs["esp32"].capture(port, kwargs["baud"], kwargs["duration_s"], kwargs["serial_input"])
    logs = captured.get("logs") or ""
    await _publish_console(f"esp32:{port}", logs)
    assertions = judge_logs(logs, kwargs["expect"])
    passed = bool(captured.get("ok")) and all(item["passed"] for item in assertions)
    return _with_compile(
        task_id,
        "esp32",
        compiled,
        success=passed,
        status="succeeded" if passed else "failed",
        logs=logs,
        assertions=assertions,
        error=None if passed else (captured.get("error") or "断言未通过"),
        error_code=None if passed else ("ASSERT_FAILED" if captured.get("ok") else "SERIAL"),
        image=report,
        device=port,
        trace=[
            {"phase": "flash", "ok": True, "address": report["flash_address"]},
            {"phase": "capture", "ok": bool(captured.get("ok"))},
        ],
    )


async def _run_pi(**kwargs: Any) -> dict[str, Any]:
    task_id = kwargs["task_id"]
    pi = kwargs["pi"]
    host = str(pi.get("host") or "")
    user = str(pi.get("user") or "pi")
    identity = pi.get("identity") or None
    remote_dir = str(pi.get("remote_dir") or "/tmp/velxio")
    start_cmd = str(pi.get("start_cmd") or "")
    action = str(pi.get("action") or "cycle")
    runner = kwargs["pi_runner"]
    common = dict(host=host, user=user, identity=identity, remote_dir=remote_dir, on_pid=kwargs["on_pid"])
    logs = ""
    trace: list[dict[str, Any]] = []
    if action in {"cycle", "start", "test"} and kwargs["files"]:
        deployed = await runner.deploy(**common, files=kwargs["files"])
        logs += deployed.get("logs") or ""
        trace.append({"phase": "deploy", "ok": bool(deployed.get("ok"))})
        if not deployed.get("ok"):
            return _shell(
                task_id,
                "pi",
                success=False,
                status="failed",
                logs=logs,
                error=deployed.get("error") or "部署失败",
                error_code="DEPLOY",
                device=host,
                trace=trace,
            )
    if _is_cancelled(kwargs["task_store"], task_id):
        return _cancelled(task_id, "pi")
    if action == "stop":
        outcome = await runner.stop(**common)
    elif action == "logs":
        outcome = await runner.logs(**common)
    elif action == "start":
        outcome = await runner.start(**common, start_cmd=start_cmd)
    elif isinstance(runner, OpenSshPi):
        async def _to_canvas(event_type: str, data: dict[str, Any]) -> None:
            await hub.emit(host, event_type, data)

        logger.info("树莓派输出转发到画布 host=%s", host)
        outcome = await stream_pi_command(
            host=host,
            user=user,
            identity=identity,
            remote_dir=remote_dir,
            start_cmd=start_cmd,
            on_event=_to_canvas,
            timeout=kwargs["duration_s"] + 30,
            on_pid=kwargs["on_pid"],
        )
    else:
        outcome = await runner.run_test(**common, start_cmd=start_cmd, timeout=kwargs["duration_s"] + 30)
    logs += outcome.get("logs") or ""
    assertions = judge_logs(logs, kwargs["expect"])
    exit_code = outcome.get("exit_code")
    ran_ok = bool(outcome.get("ok")) and (exit_code in (0, None) or action == "logs")
    passed = ran_ok and all(item["passed"] for item in assertions)
    trace.append({"phase": action, "ok": bool(outcome.get("ok")), "exit_code": exit_code})
    error = None
    error_code = None
    if not passed:
        if not outcome.get("ok"):
            error = outcome.get("error") or "远程执行失败"
            error_code = "EXIT" if exit_code not in (0, None) else "SSH"
        else:
            error = "断言未通过"
            error_code = "ASSERT_FAILED"
    return _shell(
        task_id,
        "pi",
        success=passed,
        status="succeeded" if passed else "failed",
        logs=logs,
        assertions=assertions,
        exit_code=exit_code,
        error=error,
        error_code=error_code,
        device=host,
        trace=trace,
    )


def _demo(task_id: str, target: str, expect: list[str]) -> dict[str, Any]:
    if target == "jtag":
        return _shell(
            task_id,
            target,
            success=False,
            status="failed",
            error="JTAG/GDB 深度调试尚未实现",
            error_code="UNSUPPORTED",
            engine="jtag",
        )
    lines = ["velxio hwexec demo", *[item for item in expect if not item.startswith("re:")]]
    logs = "\n".join(lines) + "\n"
    assertions = judge_logs(logs, expect)
    passed = all(item["passed"] for item in assertions) if expect else True
    logger.info("demo 执行 target=%s passed=%s", target, passed)
    return _shell(
        task_id,
        target,
        success=passed,
        status="succeeded" if passed else "failed",
        logs=logs,
        assertions=assertions,
        exit_code=0 if passed else 1,
        error=None if passed else "断言未通过",
        error_code=None if passed else "ASSERT_FAILED",
        engine="demo",
        simulation_ready=target == "sim" and passed,
    )


def _auth_device(target: str, port: str | None, pi: dict[str, Any]) -> str | None:
    if target == "esp32":
        return port or None
    if target == "pi":
        return str(pi.get("host") or "") or None
    return None


def _is_cancelled(store: TaskStore, task_id: str) -> bool:
    row = store.get(task_id)
    return bool(row and row["status"] == "cancelled")


def _cancelled(task_id: str, target: str, compiled: dict | None = None, **extra: Any) -> dict[str, Any]:
    return _with_compile(
        task_id,
        target,
        compiled,
        success=False,
        status="cancelled",
        error="已取消",
        error_code="CANCELLED",
        **extra,
    )


def _b64(payload: str) -> bytes:
    pad = "=" * (-len(payload) % 4)
    return base64.b64decode(payload + pad)


async def _publish_console(device: str, text: str) -> None:
    """真机串口进画布；固件若打印 GPIO <脚> <0|1>，同步成引脚变化。"""
    if not text:
        return
    await hub.emit(device, "serial_output", {"data": text})
    for line in text.splitlines():
        parts = line.strip().split()
        if len(parts) == 3 and parts[0] == "GPIO" and parts[1].isdigit() and parts[2] in {"0", "1"}:
            await hub.emit(
                device,
                "gpio_change",
                {"pin": int(parts[1]), "state": int(parts[2])},
            )
            logger.info("ESP32 真机 GPIO pin=%s state=%s", parts[1], parts[2])


def _denied(decision: Any) -> dict[str, Any]:
    return {
        "success": False,
        "status": "failed",
        "task_id": None,
        "simulation_ready": False,
        "logs": "",
        "assertions": [],
        "error": decision.message,
        "error_code": decision.error_code,
        "http_status": decision.http_status,
    }


def _denied_message(message: str) -> dict[str, Any]:
    return {
        "success": False,
        "status": "failed",
        "task_id": None,
        "simulation_ready": False,
        "logs": "",
        "assertions": [],
        "error": message,
        "error_code": "USAGE",
    }


def _shell(task_id: str, target: str, **fields: Any) -> dict[str, Any]:
    body = {
        "success": False,
        "status": "failed",
        "task_id": task_id,
        "target": target,
        "simulation_ready": False,
        "logs": "",
        "assertions": [],
        "exit_code": None,
        "device": None,
        "error": None,
        "error_code": None,
        "engine": None,
        "image": None,
        "compile": None,
        "hex_content": None,
        "binary_content": None,
        "stdout": "",
        "stderr": "",
        "trace": [],
    }
    body.update(fields)
    return body


def _with_compile(task_id: str, target: str, compiled: dict | None, **fields: Any) -> dict[str, Any]:
    body = _shell(task_id, target, **fields)
    if compiled:
        body["compile"] = compiled
        body["hex_content"] = compiled.get("hex_content")
        body["binary_content"] = compiled.get("binary_content")
        body["stdout"] = compiled.get("stdout") or ""
        body["stderr"] = compiled.get("stderr") or ""
    return body


def _slim(result: dict[str, Any]) -> dict[str, Any]:
    slim = dict(result)
    slim.pop("hex_content", None)
    slim.pop("binary_content", None)
    compiled = slim.get("compile")
    if isinstance(compiled, dict):
        slim["compile"] = {
            key: compiled.get(key) for key in ("success", "error", "binary_type", "stdout", "stderr")
        }
    slim["logs"] = (slim.get("logs") or "")[:65536]
    return slim
