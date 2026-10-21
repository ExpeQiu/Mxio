"""把树莓派真机的标准输出和 GPIO 电平送进画布。

画布只认仿真 WebSocket 上的两类消息：`serial_output` 和 `gpio_change`。
这里把 SSH 上的程序输出原样转成前者，把 `pinctrl lev` 的电平变化转成后者。
"""

from __future__ import annotations

import asyncio
import logging
import shlex
from collections.abc import Awaitable, Callable
from typing import Any

from app.services.hwexec.pi_ssh import _ssh_base, validate_target
from app.services.hwexec.proc import kill_group

logger = logging.getLogger("velxio.hwexec")

LEV_MARK = "##VELXIO_LEV##"
EventCallback = Callable[[str, dict[str, Any]], Awaitable[None]]


class LevelTracker:
    """只在电平变化时上报，避免画布被重复的 gpio_change 刷屏。"""

    def __init__(self) -> None:
        self.last: dict[int, int] = {}

    def changes(self, samples: list[tuple[int, int]]) -> list[tuple[int, int]]:
        found: list[tuple[int, int]] = []
        for pin, level in samples:
            if self.last.get(pin) == level:
                continue
            self.last[pin] = level
            found.append((pin, level))
        return found


def parse_level_row(payload: str) -> list[tuple[int, int]]:
    """`pinctrl lev` 的一行：下标是 BCM 编号，`-` 表示该脚不可读。"""
    samples: list[tuple[int, int]] = []
    for index, token in enumerate(payload.split()):
        if token in {"0", "1"}:
            samples.append((index, int(token)))
    return samples


def classify_line(line: str, tracker: LevelTracker) -> tuple[str | None, list[tuple[int, int]]]:
    """程序输出进串口；电平行只产生 GPIO 变化，不写进串口监视器。"""
    if line.startswith(LEV_MARK):
        payload = line[len(LEV_MARK):].strip()
        return None, tracker.changes(parse_level_row(payload))
    return line + "\n", []


class PiCanvasHub:
    """按主机把真机事件分发给正在看这块板的画布连接。"""

    def __init__(self) -> None:
        self._subs: dict[str, dict[str, EventCallback]] = {}
        self._tasks: dict[str, asyncio.subprocess.Process] = {}

    def subscribe(self, host: str, client_id: str, callback: EventCallback) -> None:
        self._subs.setdefault(host, {})[client_id] = callback
        logger.info("画布订阅真机 host=%s client=%s", host, client_id)

    def unsubscribe(self, client_id: str) -> None:
        for host, listeners in list(self._subs.items()):
            if listeners.pop(client_id, None) is not None:
                logger.info("画布取消订阅 host=%s client=%s", host, client_id)
            if not listeners:
                self._subs.pop(host, None)

    def attach_process(self, client_id: str, proc: asyncio.subprocess.Process) -> None:
        self._tasks[client_id] = proc

    def stop(self, client_id: str) -> None:
        proc = self._tasks.pop(client_id, None)
        if proc and proc.pid:
            logger.info("停止真机画面会话 client=%s pid=%s", client_id, proc.pid)
            kill_group(proc.pid)
        self.unsubscribe(client_id)

    async def emit(self, host: str, event_type: str, data: dict[str, Any]) -> None:
        listeners = list(self._subs.get(host, {}).values())
        if not listeners:
            return
        logger.info(
            "推送画布 host=%s event=%s listeners=%d",
            host,
            event_type,
            len(listeners),
        )
        for callback in listeners:
            try:
                await callback(event_type, data)
            except Exception:
                logger.exception("画布回调失败 host=%s event=%s", host, event_type)


hub = PiCanvasHub()


def _remote_script(remote_dir: str, start_cmd: str) -> str:
    directory = shlex.quote(remote_dir)
    command = shlex.quote(start_cmd)
    mark = shlex.quote(LEV_MARK)
    return (
        f"cd {directory} || exit 1\n"
        f"printf '%s\\n' {command} > velxio-run.sh\n"
        "(\n"
        "  prev=\n"
        "  while true; do\n"
        "    now=$(pinctrl lev 2>/dev/null | head -n 1 || true)\n"
        "    if [ -n \"$now\" ] && [ \"$now\" != \"$prev\" ]; then\n"
        f"      printf '%s %s\\n' {mark} \"$now\"\n"
        "      prev=$now\n"
        "    fi\n"
        "    sleep 0.1\n"
        "  done\n"
        ") &\n"
        "gpid=$!\n"
        "sh velxio-run.sh\n"
        "code=$?\n"
        "kill $gpid 2>/dev/null || true\n"
        "exit $code\n"
    )


async def stream_pi_command(
    *,
    host: str,
    user: str,
    identity: str | None,
    remote_dir: str,
    start_cmd: str,
    on_event: EventCallback,
    timeout: float = 60,
    on_pid=None,
    client_id: str | None = None,
) -> dict[str, Any]:
    """跑远端命令，并把标准输出、GPIO 变化交给 on_event。"""
    problem = validate_target(host, user, remote_dir)
    if problem:
        return {"ok": False, "logs": "", "exit_code": None, "error": problem}
    if not start_cmd or "\x00" in start_cmd or len(start_cmd) > 2000:
        return {"ok": False, "logs": "", "exit_code": None, "error": "启动命令为空或过长"}

    argv = _ssh_base(host, user, identity) + [_remote_script(remote_dir, start_cmd)]
    logger.info("真机串流 %s@%s dir=%s", user, host, remote_dir)
    proc = await asyncio.create_subprocess_exec(
        *argv,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        stdin=asyncio.subprocess.DEVNULL,
        start_new_session=True,
    )
    if on_pid and proc.pid:
        on_pid(proc.pid)
    if client_id:
        hub.attach_process(client_id, proc)

    tracker = LevelTracker()
    logs: list[str] = []
    assert proc.stdout is not None
    try:
        raw = await asyncio.wait_for(_pump(proc.stdout, tracker, on_event, logs), timeout)
    except TimeoutError:
        kill_group(proc.pid)
        logger.warning("真机串流超时 host=%s", host)
        return {"ok": False, "logs": "".join(logs), "exit_code": None, "error": "SSH 超时"}
    code = await proc.wait()
    text = "".join(logs)
    if raw:
        text += raw
    logger.info("真机串流结束 host=%s code=%s bytes=%d", host, code, len(text))
    return {
        "ok": code == 0,
        "logs": text,
        "exit_code": code,
        "error": None if code == 0 else f"远程命令退出 {code}",
    }


async def _pump(
    stdout: asyncio.StreamReader,
    tracker: LevelTracker,
    on_event: EventCallback,
    logs: list[str],
) -> str:
    pending = ""
    while True:
        chunk = await stdout.read(1024)
        if not chunk:
            break
        pending += chunk.decode("utf-8", "replace")
        while "\n" in pending:
            line, pending = pending.split("\n", 1)
            await _dispatch(line.rstrip("\r"), tracker, on_event, logs)
    if pending:
        await _dispatch(pending.rstrip("\r"), tracker, on_event, logs)
        pending = ""
    return pending


async def _dispatch(
    line: str,
    tracker: LevelTracker,
    on_event: EventCallback,
    logs: list[str],
) -> None:
    serial, changes = classify_line(line, tracker)
    if serial is not None:
        logs.append(serial)
        await on_event("serial_output", {"data": serial})
    for pin, level in changes:
        logger.info("真机 GPIO pin=%s state=%s", pin, level)
        await on_event("gpio_change", {"pin": pin, "state": level})


async def publish(host: str, event_type: str, data: dict[str, Any]) -> None:
    await hub.emit(host, event_type, data)
