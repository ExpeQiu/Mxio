"""失败后的远程诊断：最近一次任务、日志尾巴、当前电平。"""

from __future__ import annotations

import logging
from typing import Any

from app.services.hwexec.pi_canvas import parse_level_row
from app.services.hwexec.pi_ssh import OpenSshPi
from app.services.hwexec.tasks import TaskStore, get_store

logger = logging.getLogger("velxio.hwexec")


def explain(logs: str, exit_code: int | None, levels: list[tuple[int, int]]) -> dict[str, Any]:
    """根据日志、退出码和电平给出可执行的判断，不替代调试器。"""
    hints: list[str] = []
    high = [pin for pin, level in levels if level == 1]
    low = [pin for pin, level in levels if level == 0]
    if exit_code not in (0, None):
        hints.append(f"最近一次退出码是 {exit_code}")
    traceback = _traceback_line(logs)
    if traceback:
        hints.append(f"Python 异常：{traceback}")
    if "qemu_unavailable" in logs or "引导镜像" in logs:
        hints.append("虚拟机镜像或 QEMU 不在本机，画布里的 Linux 模式同样起不来")
    if "断言未通过" in logs:
        hints.append("程序跑完了，但输出里没有期望的文本")
    if not logs.strip():
        hints.append("没有读到标准输出。树莓派确认进程已启动；ESP32 确认波特率和串口")
    if high:
        hints.append("当前高电平 BCM：" + ",".join(str(pin) for pin in high[:12]))
    summary = "；".join(hints) if hints else "日志和电平里没有明显故障"
    return {"summary": summary, "hints": hints, "gpio_high": high, "gpio_low": low[:12]}


def _traceback_line(logs: str) -> str:
    lines = logs.splitlines()
    for line in reversed(lines):
        stripped = line.strip()
        if stripped and ("Error" in stripped or stripped.startswith("Exception")):
            return stripped[:240]
    return ""


def _last_task(store: TaskStore, device: str | None) -> dict[str, Any] | None:
    if not device:
        return None
    for task in store.list_tasks(50):
        if task.get("device") == device or (task.get("result") or {}).get("device") == device:
            return task
    return None


async def diagnose(
    *,
    host: str | None = None,
    port: str | None = None,
    command: str | None = None,
    user: str = "pi",
    store: TaskStore | None = None,
    runner: OpenSshPi | None = None,
) -> dict[str, Any]:
    task_store = store or get_store()
    device = host or port
    last = _last_task(task_store, device)
    result = (last or {}).get("result") or {}
    logs = str(result.get("logs") or "")
    exit_code = result.get("exit_code")
    levels: list[tuple[int, int]] = []
    probe_logs = ""
    error = None

    if host:
        if command and ("\n" in command or "\x00" in command or len(command) > 500):
            return {"success": False, "error": "诊断命令过长或含换行", "error_code": "USAGE"}
        remote = command or "pinctrl lev"
        logger.info("诊断树莓派 host=%s cmd=%s", host, remote.split()[0])
        ssh = runner or OpenSshPi()
        probed = await ssh.run_test(
            host=host,
            user=user,
            identity=None,
            remote_dir="/tmp",
            start_cmd=remote,
            timeout=20,
        )
        probe_logs = str(probed.get("logs") or "")
        if not probed.get("ok"):
            error = probed.get("error")
        if not command:
            levels = parse_level_row(probe_logs.replace("\n", " "))
    report = explain(logs + ("\n" + probe_logs if probe_logs else ""), exit_code, levels)
    logger.info("诊断结果 device=%s summary=%s", device, report["summary"])
    return {
        "success": error is None,
        "device": device,
        "host": host,
        "port": port,
        "last_task": None
        if last is None
        else {
            "id": last.get("id"),
            "status": last.get("status"),
            "error": last.get("error"),
            "exit_code": exit_code,
        },
        "logs_tail": (logs + ("\n" + probe_logs if probe_logs else ""))[-4000:],
        "probe": probe_logs[-2000:],
        "error": error,
        **report,
    }
