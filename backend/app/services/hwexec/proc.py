"""子进程启动与进程组清理。"""

from __future__ import annotations

import asyncio
import logging
import os
import signal

logger = logging.getLogger("velxio.hwexec")


def kill_group(pid: int | None) -> None:
    if not pid or pid < 2:
        return
    logger.info("结束进程组 pid=%s", pid)
    try:
        if os.name == "nt":
            os.kill(pid, signal.SIGTERM)
            return
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except OSError as exc:
        logger.warning("结束进程组失败 pid=%s err=%s", pid, exc)


async def run_argv(
    argv: list[str],
    *,
    timeout: float,
    on_pid=None,
    cwd: str | None = None,
) -> tuple[int, str]:
    logger.info("执行命令 %s", argv)
    proc = await asyncio.create_subprocess_exec(
        *argv,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        stdin=asyncio.subprocess.DEVNULL,
        cwd=cwd,
        start_new_session=True,
    )
    if on_pid and proc.pid:
        on_pid(proc.pid)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout)
    except (TimeoutError, asyncio.CancelledError):
        kill_group(proc.pid)
        raise
    text = (out or b"").decode("utf-8", "replace")
    code = proc.returncode if proc.returncode is not None else 1
    logger.info("命令结束 code=%s bytes=%d", code, len(text))
    return code, text
