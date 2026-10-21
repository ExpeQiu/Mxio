"""部署边界：远程认证，以及 USB 与容器的隔离。"""

from __future__ import annotations

import logging
import os
import secrets
from dataclasses import dataclass
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger("velxio.hwexec")

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost", "testclient"})


@dataclass(frozen=True)
class AuthDecision:
    ok: bool
    message: str = ""
    error_code: str = ""
    http_status: int = 200


def _setting(name: str, default: str = "") -> str:
    if name in os.environ:
        return os.environ.get(name, default) or ""
    return str(getattr(settings, name, default) or "")


def hardware_local() -> bool:
    """容器里默认不做 USB。本机没写开关时，看到 /.dockerenv 就关掉。"""
    raw = _setting("VELXIO_HARDWARE_LOCAL").strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return not Path("/.dockerenv").exists()


def exec_token() -> str:
    return _setting("VELXIO_EXEC_TOKEN").strip()


def device_allowlist() -> set[str]:
    raw = _setting("VELXIO_DEVICE_ALLOW")
    return {item.strip() for item in raw.split(",") if item.strip()}


def ssh_accept_new() -> bool:
    raw = _setting("VELXIO_SSH_ACCEPT_NEW").strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return bool(getattr(settings, "VELXIO_SSH_ACCEPT_NEW", False))


def _bearer_matches(authorization: str | None, token: str) -> bool:
    if not authorization or not token:
        return False
    header = authorization.strip()
    prefix = "bearer "
    if not header.lower().startswith(prefix):
        return False
    got = header[len(prefix):].strip()
    if len(got) != len(token):
        return False
    return secrets.compare_digest(got, token)


def _is_local(via: str, client_host: str | None) -> bool:
    if via == "mcp":
        return True
    return (client_host or "") in LOOPBACK_HOSTS


def authorize(
    *,
    via: str,
    target: str,
    device: str | None,
    client_host: str | None,
    authorization: str | None,
) -> AuthDecision:
    """远程调用要令牌；远程真机还要设备在授权列表里。USB 只能在本地执行器。"""
    local = _is_local(via, client_host)
    allow = device_allowlist()
    token = exec_token()

    if not local:
        if not token or not _bearer_matches(authorization, token):
            logger.warning(
                "拒绝远程执行 target=%s host=%s：缺少有效令牌",
                target,
                client_host,
            )
            return AuthDecision(
                False,
                "远程执行需要 Authorization: Bearer <VELXIO_EXEC_TOKEN>",
                "AUTH",
                401,
            )
        if device and device not in allow:
            logger.warning(
                "拒绝远程设备 target=%s device=%s：不在授权列表",
                target,
                device,
            )
            return AuthDecision(
                False,
                "远程设备必须出现在 VELXIO_DEVICE_ALLOW",
                "BOUNDARY",
                403,
            )

    if target == "esp32" and not hardware_local():
        logger.warning("拒绝 USB：当前进程不是本地硬件执行器 host=%s", client_host)
        return AuthDecision(
            False,
            "USB 烧录和串口由连接开发板的本地执行器承担；容器或远端只做编译和仿真",
            "BOUNDARY",
            403,
        )

    if local and allow and device and device not in allow:
        logger.warning("拒绝设备 %s：不在 VELXIO_DEVICE_ALLOW", device)
        return AuthDecision(False, "设备不在 VELXIO_DEVICE_ALLOW", "BOUNDARY", 403)

    if target == "esp32" and not token:
        logger.info("USB 执行未配置 VELXIO_EXEC_TOKEN，仅限本机进程使用")

    return AuthDecision(True)


def boundary_report() -> dict:
    allow = sorted(device_allowlist())
    return {
        "hardware_local": hardware_local(),
        "usb": "local-executor" if hardware_local() else "disabled",
        "compile_and_sim": "container-or-remote",
        "remote_auth": "bearer" if exec_token() else "required-when-remote",
        "device_allow": allow,
        "ssh_accept_new": ssh_accept_new(),
        "jtag": "not-implemented",
    }
