"""VAP 宿主网关：OpenAI 兼容 /v1/chat/completions + STT。"""

from typing import Any

from fastapi import APIRouter, Body, Request

from vap_llm import complete, health, transcribe

router = APIRouter()
guest_router = APIRouter()


@router.get("/health")
def vap_health() -> dict[str, Any]:
    return health()


@router.post("/v1/chat/completions")
async def chat_completions(body: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    return await complete(body or {})


@router.post("/stt")
async def stt(request: Request) -> dict[str, Any]:
    data = await request.body()
    return await transcribe(data or b"")


@guest_router.post("/chat/completions")
async def guest_chat_completions(
    body: dict[str, Any] = Body(default_factory=dict),
) -> dict[str, Any]:
    return await complete(body or {})
