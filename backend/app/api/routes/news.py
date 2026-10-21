"""产品动态接口。本地安装不向外网拉取更新。"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/feed")
async def news_feed() -> list[dict]:
    return []
