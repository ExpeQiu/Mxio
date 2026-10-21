"""树莓派 SSH 执行器：部署、启停、日志、退出码。"""

from __future__ import annotations

import logging
import os
import re
import shlex
import tempfile
from pathlib import Path
from typing import Any

from app.services.hwexec.boundary import ssh_accept_new
from app.services.hwexec.proc import run_argv

logger = logging.getLogger("velxio.hwexec")

HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$")
USER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]{0,31}$")
DIR_RE = re.compile(r"^/[A-Za-z0-9._/-]{1,200}$")


def validate_target(host: str, user: str, remote_dir: str) -> str | None:
    if not HOST_RE.match(host or "") or host.startswith("-"):
        return f"非法主机 {host!r}"
    if not USER_RE.match(user or ""):
        return f"非法用户 {user!r}"
    if not DIR_RE.match(remote_dir or "") or ".." in remote_dir.split("/"):
        return f"非法远程目录 {remote_dir!r}"
    return None


def _ssh_base(host: str, user: str, identity: str | None) -> list[str]:
    checking = "accept-new" if ssh_accept_new() else "yes"
    argv = [
        "ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        f"StrictHostKeyChecking={checking}",
        "-o",
        "ConnectTimeout=8",
    ]
    if identity:
        argv.extend(["-i", identity])
    argv.append(f"{user}@{host}")
    return argv


def _scp_base(identity: str | None) -> list[str]:
    checking = "accept-new" if ssh_accept_new() else "yes"
    argv = [
        "scp",
        "-o",
        "BatchMode=yes",
        "-o",
        f"StrictHostKeyChecking={checking}",
        "-o",
        "ConnectTimeout=8",
    ]
    if identity:
        argv.extend(["-i", identity])
    return argv


class OpenSshPi:
    async def deploy(
        self,
        *,
        host: str,
        user: str,
        identity: str | None,
        remote_dir: str,
        files: list[dict[str, str]],
        on_pid=None,
        timeout: float = 60,
    ) -> dict[str, Any]:
        problem = validate_target(host, user, remote_dir)
        if problem:
            return {"ok": False, "logs": "", "exit_code": None, "error": problem}
        if identity and not Path(identity).is_file():
            return {"ok": False, "logs": "", "exit_code": None, "error": "SSH 私钥不存在"}

        logger.info("部署到 %s@%s:%s files=%d", user, host, remote_dir, len(files))
        mkdir = _ssh_base(host, user, identity) + [f"mkdir -p {shlex.quote(remote_dir)}"]
        try:
            code, logs = await run_argv(mkdir, timeout=timeout, on_pid=on_pid)
        except TimeoutError:
            return {"ok": False, "logs": "", "exit_code": None, "error": "创建远程目录超时"}
        if code != 0:
            return {"ok": False, "logs": logs, "exit_code": code, "error": "创建远程目录失败"}

        with tempfile.TemporaryDirectory(prefix="velxio-pi-") as tmp:
            local_files = _materialize(Path(tmp), files)
            if isinstance(local_files, str):
                return {"ok": False, "logs": logs, "exit_code": None, "error": local_files}
            for local, rel in local_files:
                parent = str(Path(rel).parent)
                if parent and parent != ".":
                    nested = _ssh_base(host, user, identity) + [
                        f"mkdir -p {shlex.quote(remote_dir + '/' + parent)}"
                    ]
                    code, more = await run_argv(nested, timeout=timeout, on_pid=on_pid)
                    logs += more
                    if code != 0:
                        return {"ok": False, "logs": logs, "exit_code": code, "error": "创建远程子目录失败"}
                remote = f"{user}@{host}:{remote_dir}/{rel}"
                argv = _scp_base(identity) + [str(local), remote]
                try:
                    code, more = await run_argv(argv, timeout=timeout, on_pid=on_pid)
                except TimeoutError:
                    return {"ok": False, "logs": logs, "exit_code": None, "error": "上传超时"}
                logs += more
                if code != 0:
                    logger.warning("上传失败 file=%s code=%s", local.name, code)
                    return {"ok": False, "logs": logs, "exit_code": code, "error": f"上传失败 {local.name}"}
        return {"ok": True, "logs": logs, "exit_code": 0, "error": None}

    async def start(
        self,
        *,
        host: str,
        user: str,
        identity: str | None,
        remote_dir: str,
        start_cmd: str,
        on_pid=None,
        timeout: float = 30,
    ) -> dict[str, Any]:
        problem = _check_cmd(host, user, remote_dir, start_cmd)
        if problem:
            return {"ok": False, "logs": "", "exit_code": None, "error": problem}
        script = (
            f"cd {shlex.quote(remote_dir)} && "
            "printf '%s\\n' " + shlex.quote(start_cmd) + " > velxio-run.sh && "
            "chmod +x velxio-run.sh && "
            "nohup sh ./velxio-run.sh > velxio.log 2>&1 & echo $! > velxio.pid"
        )
        logger.info("启动远程程序 %s@%s", user, host)
        return await self._ssh(host, user, identity, script, on_pid=on_pid, timeout=timeout)

    async def stop(
        self,
        *,
        host: str,
        user: str,
        identity: str | None,
        remote_dir: str,
        on_pid=None,
        timeout: float = 20,
    ) -> dict[str, Any]:
        problem = validate_target(host, user, remote_dir)
        if problem:
            return {"ok": False, "logs": "", "exit_code": None, "error": problem}
        script = (
            f"cd {shlex.quote(remote_dir)} && "
            "if [ -f velxio.pid ]; then kill $(cat velxio.pid) || true; rm -f velxio.pid; fi"
        )
        logger.info("停止远程程序 %s@%s", user, host)
        return await self._ssh(host, user, identity, script, on_pid=on_pid, timeout=timeout)

    async def logs(
        self,
        *,
        host: str,
        user: str,
        identity: str | None,
        remote_dir: str,
        on_pid=None,
        timeout: float = 20,
    ) -> dict[str, Any]:
        problem = validate_target(host, user, remote_dir)
        if problem:
            return {"ok": False, "logs": "", "exit_code": None, "error": problem}
        script = f"cd {shlex.quote(remote_dir)} && tail -c 65536 velxio.log"
        return await self._ssh(host, user, identity, script, on_pid=on_pid, timeout=timeout)

    async def run_test(
        self,
        *,
        host: str,
        user: str,
        identity: str | None,
        remote_dir: str,
        start_cmd: str,
        on_pid=None,
        timeout: float = 60,
    ) -> dict[str, Any]:
        """前台执行并带回退出码，供自动测试判断。"""
        problem = _check_cmd(host, user, remote_dir, start_cmd)
        if problem:
            return {"ok": False, "logs": "", "exit_code": None, "error": problem}
        script = (
            f"cd {shlex.quote(remote_dir)} && "
            "printf '%s\\n' " + shlex.quote(start_cmd) + " > velxio-run.sh && "
            "chmod +x velxio-run.sh && sh ./velxio-run.sh"
        )
        logger.info("远程测试 %s@%s", user, host)
        return await self._ssh(host, user, identity, script, on_pid=on_pid, timeout=timeout)

    async def _ssh(
        self,
        host: str,
        user: str,
        identity: str | None,
        remote_cmd: str,
        *,
        on_pid,
        timeout: float,
    ) -> dict[str, Any]:
        if identity and not Path(identity).is_file():
            return {"ok": False, "logs": "", "exit_code": None, "error": "SSH 私钥不存在"}
        argv = _ssh_base(host, user, identity) + [remote_cmd]
        try:
            code, logs = await run_argv(argv, timeout=timeout, on_pid=on_pid)
        except TimeoutError:
            logger.warning("SSH 超时 host=%s", host)
            return {"ok": False, "logs": "", "exit_code": None, "error": "SSH 超时"}
        return {
            "ok": code == 0,
            "logs": logs,
            "exit_code": code,
            "error": None if code == 0 else f"远程命令退出 {code}",
        }


def _check_cmd(host: str, user: str, remote_dir: str, start_cmd: str) -> str | None:
    problem = validate_target(host, user, remote_dir)
    if problem:
        return problem
    if not start_cmd or "\x00" in start_cmd or len(start_cmd) > 2000:
        return "启动命令为空或过长"
    return None


def _materialize(root: Path, files: list[dict[str, str]]) -> list[tuple[Path, str]] | str:
    written: list[tuple[Path, str]] = []
    for item in files:
        name = str(item.get("name") or "")
        if not name or name.startswith("/") or ".." in Path(name).parts:
            return f"非法文件名 {name!r}"
        dest = (root / name).resolve()
        if not str(dest).startswith(str(root.resolve()) + os.sep):
            return f"非法文件名 {name!r}"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(str(item.get("content") or ""), encoding="utf-8")
        written.append((dest, Path(name).as_posix()))
    if not written:
        return "没有可部署的文件"
    return written
