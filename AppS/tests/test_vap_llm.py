from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
sys.path.insert(0, str(ROOT.parent / "backend"))

from vap_llm import GUEST_LLM_URL, mock_reply, mock_transcript, openai_envelope
from vap_routes import guest_router, router as vap_router


def test_mock_reply_keywords() -> None:
    assert "宿主" in mock_reply("你好")
    assert "网关" in mock_reply("你的名字")
    assert "host-mock" in mock_reply("随便说一句")


def test_openai_envelope_has_content_for_firmware() -> None:
    body = openai_envelope("hello-content", model="mock", mock=True)
    raw = json.dumps(body, ensure_ascii=False)
    assert '"content"' in raw
    assert body["choices"][0]["message"]["content"] == "hello-content"
    assert body["velxio"]["mock"] is True


def test_guest_url_is_slirp_gateway() -> None:
    assert GUEST_LLM_URL.startswith("http://192.168.4.2/")


def _vap_client() -> TestClient:
    app = FastAPI()
    app.include_router(vap_router, prefix="/api/vap")
    app.include_router(guest_router, prefix="/v1")
    return TestClient(app)


def test_vap_health_and_completions_mock() -> None:
    client = _vap_client()
    health = client.get("/api/vap/health")
    assert health.status_code == 200
    assert health.json()["mock"] is True
    payload = {"messages": [{"role": "user", "content": "你好"}]}
    browser = client.post("/api/vap/v1/chat/completions", json=payload)
    assert browser.status_code == 200
    assert "content" in browser.text
    assert "宿主" in browser.json()["choices"][0]["message"]["content"]
    guest = client.post("/v1/chat/completions", json=payload)
    assert guest.status_code == 200
    assert guest.json()["choices"][0]["message"]["content"]


def test_vap_stt_default_does_not_fake_hello() -> None:
    client = _vap_client()
    ok = client.post("/api/vap/stt", content=b"x" * 200)
    assert ok.status_code == 200
    assert ok.json()["text"] == ""


def test_vap_stt_mock_flag() -> None:
    from app.core.config import settings

    assert mock_transcript(10) == ""
    assert mock_transcript(200) == "你好"
    old = settings.STT_MOCK
    settings.STT_MOCK = True
    try:
        client = _vap_client()
        empty = client.post("/api/vap/stt", content=b"x")
        assert empty.json()["text"] == ""
        mocked = client.post("/api/vap/stt", content=b"x" * 200)
        assert mocked.json()["text"] == "你好"
    finally:
        settings.STT_MOCK = old


if __name__ == "__main__":
    test_mock_reply_keywords()
    test_openai_envelope_has_content_for_firmware()
    test_guest_url_is_slirp_gateway()
    test_vap_health_and_completions_mock()
    test_vap_stt_default_does_not_fake_hello()
    test_vap_stt_mock_flag()
    print("ok")
