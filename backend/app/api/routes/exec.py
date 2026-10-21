"""硬件执行 HTTP 接口。与 MCP、CLI 共用 runner.execute。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.hooks import register_lifespan_startup
from app.services.hwexec.boundary import authorize, boundary_report
from app.services.hwexec.esp32 import list_serial_ports
from app.services.hwexec.image import inspect_firmware
from app.services.hwexec.runner import execute
from app.services.hwexec.tasks import get_store

logger = logging.getLogger("velxio.hwexec")
router = APIRouter()


class ChannelBody(BaseModel):
    port: str
    action: str = Field(pattern='^(observe|restart)$')
    duration_s: float = Field(default=15, ge=1, le=30)


class WifiChannelBody(BaseModel):
    action: str = Field(default='status', pattern='^(status|volume|brightness)$')
    value: int | None = Field(default=None, ge=0, le=100, strict=True)


class VoiceRouteBody(BaseModel):
    route: str = Field(pattern='^(agentcenter|doubao)$')


@router.post('/esp32/voice-route')
async def esp32_voice_route(body: VoiceRouteBody, request: Request) -> dict:
    import asyncio
    import json
    import urllib.request
    import urllib.error
    decision = authorize(via='http', target='wifi', device='84:C7:BB:60:21:94',
                         client_host=_host(request), authorization=request.headers.get('authorization'))
    if not decision.ok:
        raise HTTPException(status_code=decision.http_status, detail=decision.message)

    def change():
        req = urllib.request.Request('http://127.0.0.1:8766/voice/button-route',
            data=json.dumps(body.model_dump()).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.load(response)

    try:
        return await asyncio.to_thread(change)
    except urllib.error.URLError:
        raise HTTPException(503, 'Voice service unavailable or credentials not configured') from None


@router.post('/esp32/wifi')
async def esp32_wifi(body: WifiChannelBody, request: Request) -> dict:
    import asyncio
    import json
    import urllib.request
    import urllib.error
    decision = authorize(via='http', target='wifi', device='84:C7:BB:60:21:94',
                         client_host=_host(request), authorization=request.headers.get('authorization'))
    if not decision.ok:
        raise HTTPException(status_code=decision.http_status, detail=decision.message)
    if (body.action == 'status' and body.value is not None) or (body.action != 'status' and body.value is None):
        raise HTTPException(400, 'volume/brightness require value; status takes no value')
    tool, key = {'status': ('self.get_device_status', None),
                 'volume': ('self.audio_speaker.set_volume', 'volume'),
                 'brightness': ('self.screen.set_brightness', 'brightness')}[body.action]
    payload = {'name': tool, 'arguments': {key: body.value} if key else {}}

    def call():
        req = urllib.request.Request('http://127.0.0.1:8766/call',
            data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.load(response)

    try:
        return await asyncio.to_thread(call)
    except (urllib.error.URLError, TimeoutError):
        raise HTTPException(503, 'Wi-Fi gateway or device reply unavailable') from None


@router.post('/esp32/channel')
async def esp32_channel(body: ChannelBody, request: Request) -> dict:
    from app.services.hwexec.device_channel import device_channel
    from app.services.hwexec.esp32 import valid_port
    if not valid_port(body.port):
        raise HTTPException(status_code=400, detail='Invalid serial port')
    decision = authorize(via='http', target='esp32', device=body.port,
                         client_host=_host(request), authorization=request.headers.get('authorization'))
    if not decision.ok:
        raise HTTPException(status_code=decision.http_status, detail=decision.message)
    result = await device_channel(body.port, body.action, body.duration_s)
    if result.get('error_code') == 'DEVICE_BUSY':
        raise HTTPException(status_code=409, detail=result)
    return result


class SketchFile(BaseModel):
    name: str
    content: str


class PiTarget(BaseModel):
    host: str
    user: str = "pi"
    identity: str | None = None
    remote_dir: str = "/tmp/velxio"
    start_cmd: str = ""
    action: str = "cycle"


class RunBody(BaseModel):
    files: list[SketchFile] = Field(default_factory=list)
    board: str = "arduino:avr:uno"
    target: str = "sim"
    duration_s: float = 5
    expect: list[str] = Field(default_factory=list)
    port: str | None = None
    baud: int = 115200
    firmware_b64: str | None = None
    serial_input: str = ""
    pi: PiTarget | None = None
    demo: bool = False


class InspectBody(BaseModel):
    firmware_b64: str
    chip: str = "esp32"


def _host(request: Request) -> str:
    if request.client and request.client.host:
        return request.client.host
    return ""


@router.get("/boundary")
def exec_boundary() -> dict:
    report = boundary_report()
    logger.info("边界查询 usb=%s hardware_local=%s", report["usb"], report["hardware_local"])
    return report


@router.post("/run")
async def exec_run(body: RunBody, request: Request) -> dict:
    result = await execute(
        files=[item.model_dump() for item in body.files],
        board=body.board,
        target=body.target,
        duration_s=body.duration_s,
        expect=body.expect,
        port=body.port,
        baud=body.baud,
        firmware_b64=body.firmware_b64,
        serial_input=body.serial_input,
        pi=body.pi.model_dump() if body.pi else None,
        demo=body.demo,
        via="http",
        client_host=_host(request),
        authorization=request.headers.get("authorization"),
    )
    status = int(result.get("http_status") or 200)
    if status in {401, 403} and not result.get("task_id"):
        raise HTTPException(status_code=status, detail=result)
    if result.get("error_code") == "DEVICE_BUSY":
        raise HTTPException(status_code=409, detail=result)
    return result


class DiagnoseBody(BaseModel):
    host: str | None = None
    port: str | None = None
    command: str | None = None
    user: str = "pi"


@router.post("/diagnose")
async def exec_diagnose(body: DiagnoseBody, request: Request) -> dict:
    from app.services.hwexec.diagnose import diagnose

    device = body.host or body.port
    decision = authorize(
        via="http",
        target="pi" if body.host else "esp32",
        device=device,
        client_host=_host(request),
        authorization=request.headers.get("authorization"),
    )
    if body.host is None and body.port is None:
        raise HTTPException(status_code=400, detail="需要 host 或 port")
    if not decision.ok:
        logger.warning("拒绝诊断 device=%s: %s", device, decision.message)
        raise HTTPException(status_code=decision.http_status, detail=decision.message)
    logger.info("诊断请求 host=%s port=%s", body.host, body.port)
    return await diagnose(host=body.host, port=body.port, command=body.command, user=body.user)


@router.get("/esp32/devices")
def esp32_devices(request: Request) -> dict:
    decision = authorize(
        via="http",
        target="esp32",
        device=None,
        client_host=_host(request),
        authorization=request.headers.get("authorization"),
    )
    if not decision.ok:
        logger.warning("拒绝枚举串口: %s", decision.message)
        raise HTTPException(status_code=decision.http_status, detail=decision.message)
    found = list_serial_ports()
    logger.info("枚举 ESP32 串口 count=%s", len(found.get("devices") or []))
    return found


@router.post("/esp32/inspect")
def esp32_inspect(body: InspectBody) -> dict:
    import base64

    try:
        raw = base64.b64decode(body.firmware_b64)
    except Exception as exc:
        logger.warning("固件 base64 无法解码: %s", exc)
        raise HTTPException(status_code=400, detail="firmware_b64 无法解码") from exc
    if len(raw) > 16 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="固件超过 16MB")
    return inspect_firmware(raw, body.chip)


@router.get("/tasks")
def list_tasks(limit: int = 50) -> dict:
    tasks = get_store().list_tasks(limit)
    return {"tasks": tasks}


@router.get("/tasks/{task_id}")
def get_task(task_id: str) -> dict:
    task = get_store().get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


@router.post("/tasks/{task_id}/cancel")
def cancel_task(task_id: str) -> dict:
    task = get_store().cancel(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    logger.info("HTTP 取消任务 id=%s status=%s", task_id, task.get("status"))
    return task


async def _recover_tasks() -> None:
    count = get_store().recover()
    logger.info("启动时检查中断任务 recovered=%s", count)


register_lifespan_startup(_recover_tasks)
