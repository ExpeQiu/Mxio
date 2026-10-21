"""宿主 LLM 网关：Mock First，OpenAI 兼容 JSON，供固件 HTTPClient 解析。"""

from __future__ import annotations

import asyncio
import hashlib
import io
import logging
import os
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

GUEST_LLM_URL = "http://192.168.4.2/v1/chat/completions"
_WHISPER_SHA = {
    "tiny": "65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9",
    "base": "ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e",
}
_WHISPER_MIN = {
    "tiny": 70_000_000,
    "base": 130_000_000,
}
_whisper_ok_cache: dict[str, bool] = {}


def _which(name: str) -> str:
    extra = ["/opt/homebrew/bin", "/usr/local/bin", str(Path.home() / ".local/bin")]
    found = shutil.which(name)
    if found:
        return found
    for folder in extra:
        cand = Path(folder) / name
        if cand.is_file() and os.access(cand, os.X_OK):
            return str(cand)
    return ""


def _stt_backend() -> str:
    if settings.STT_MOCK:
        return "mock"
    if settings.FUNASR_BASE_URL:
        return "funasr"
    if _which("whisper"):
        return "whisper"
    return "browser"


def mock_enabled() -> bool:
    if settings.AI_MOCK_MODE:
        return True
    return not (settings.LLM_BASE_URL and settings.LLM_API_KEY)


def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "mock": mock_enabled(),
        "has_upstream": bool(settings.LLM_BASE_URL),
        "has_key": bool(settings.LLM_API_KEY),
        "guest_url": GUEST_LLM_URL,
        "model": settings.LLM_MODEL or "mock",
        "stt": _stt_backend(),
    }


def _user_text(body: dict[str, Any]) -> str:
    messages = body.get("messages")
    if isinstance(messages, list):
        for msg in reversed(messages):
            if isinstance(msg, dict) and msg.get("role") == "user":
                content = msg.get("content")
                if isinstance(content, str):
                    return content.strip()
    prompt = body.get("prompt")
    if isinstance(prompt, str):
        return prompt.strip()
    return ""


def mock_reply(text: str) -> str:
    q = text.lower()
    if "hello" in q or "你好" in text:
        return "你好，我是宿主网关（mock）。"
    if "name" in q or "名字" in text:
        return "我是 Velxio 宿主 LLM 网关。"
    if "help" in q or "帮助" in text:
        return "窗口切 Live，固件走 192.168.4.2/v1/chat/completions。"
    if not text:
        return "（mock）空输入。"
    return f"收到: {text} (host-mock)"


def mock_transcript(nbytes: int) -> str:
    if nbytes < 80:
        return ""
    return "你好"


def _wav_stats(wav: bytes) -> tuple[int, float]:
    """Return (duration_ms, peak 0..1) for PCM WAV."""
    try:
        with wave.open(io.BytesIO(wav), "rb") as fh:
            n = fh.getnframes()
            rate = fh.getframerate() or 16000
            raw = fh.readframes(n)
            width = fh.getsampwidth() or 2
        if n <= 0 or not raw:
            return 0, 0.0
        peak = 0
        if width == 2:
            for i in range(0, len(raw) - 1, 2):
                sample = int.from_bytes(raw[i : i + 2], "little", signed=True)
                abs_s = -sample if sample < 0 else sample
                if abs_s > peak:
                    peak = abs_s
            return int(n * 1000 / rate), peak / 32768.0
        return int(n * 1000 / rate), 0.0
    except Exception:
        return 0, 0.0


def _to_wav(data: bytes) -> bytes | None:
    if not data:
        return None
    try:
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as inp:
            inp.write(data)
            in_path = inp.name
        out_path = in_path + ".wav"
        try:
            proc = subprocess.run(
                [_which("ffmpeg") or "ffmpeg", "-y", "-i", in_path, "-ar", "16000", "-ac", "1", out_path],
                capture_output=True,
                timeout=20,
            )
            if proc.returncode != 0 or not Path(out_path).is_file():
                err = (proc.stderr or b"").decode("utf-8", errors="replace")[-200:]
                logger.warning("vap_stt ffmpeg_fail rc=%s err=%s", proc.returncode, err)
                return None
            return Path(out_path).read_bytes()
        finally:
            for p in (in_path, out_path):
                try:
                    os.unlink(p)
                except OSError:
                    pass
    except Exception as exc:
        logger.warning("vap_stt ffmpeg_exc err=%s", type(exc).__name__)
        return None


def _whisper_model_ok(name: str) -> bool:
    cached = _whisper_ok_cache.get(name)
    if cached is not None:
        return cached
    path = Path.home() / ".cache" / "whisper" / f"{name}.pt"
    if not path.is_file():
        logger.warning("vap_stt whisper_model_missing path=%s", path)
        _whisper_ok_cache[name] = False
        return False
    expected = _WHISPER_SHA.get(name)
    size = path.stat().st_size
    min_bytes = _WHISPER_MIN.get(name, 1_000_000)
    if size < min_bytes:
        logger.warning("vap_stt whisper_model_truncated bytes=%d", size)
        _whisper_ok_cache[name] = False
        return False
    if expected:
        digest = hashlib.sha256()
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != expected:
            logger.warning("vap_stt whisper_model_sha_mismatch bytes=%d", size)
            _whisper_ok_cache[name] = False
            return False
    _whisper_ok_cache[name] = True
    return True


async def transcribe(data: bytes) -> dict[str, Any]:
    if settings.STT_MOCK:
        text = mock_transcript(len(data))
        logger.info("vap_stt mock=1 bytes=%d chars=%d", len(data), len(text))
        return {"text": text, "mock": True, "bytes": len(data)}

    url = (settings.FUNASR_BASE_URL or "").rstrip("/")
    if url and data:
        wav = _to_wav(data) or data
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    f"{url}/v1/audio/transcriptions",
                    files={"file": ("utter.wav", wav, "audio/wav")},
                    data={"model": "sensevoice", "language": "zh"},
                )
                resp.raise_for_status()
                payload = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
                text = ""
                if isinstance(payload, dict):
                    text = str(payload.get("text") or "").strip()
                logger.info("vap_stt funasr=1 chars=%d", len(text))
                return {"text": text, "mock": False, "bytes": len(data)}
        except Exception as exc:
            logger.warning("vap_stt funasr_fail err=%s", type(exc).__name__)

    if not data or len(data) < 1500:
        logger.info("vap_stt skip bytes=%d reason=silence", len(data))
        return {"text": "", "mock": False, "bytes": len(data), "error": "silence"}

    if _which("whisper"):
        model = settings.WHISPER_MODEL or "base"
        if not _whisper_model_ok(model):
            logger.warning("vap_stt skip bytes=%d reason=model", len(data))
            return {"text": "", "mock": False, "bytes": len(data), "error": "model"}
        wav = _to_wav(data)
        if not wav:
            logger.info("vap_stt skip bytes=%d reason=ffmpeg", len(data))
            return {"text": "", "mock": False, "bytes": len(data), "error": "ffmpeg"}
        dur_ms, peak = _wav_stats(wav)
        logger.info("vap_stt wav bytes=%d ms=%d peak=%.4f", len(data), dur_ms, peak)
        if dur_ms < 250 or peak < 0.02:
            logger.info(
                "vap_stt skip bytes=%d reason=silence ms=%d peak=%.4f",
                len(data),
                dur_ms,
                peak,
            )
            return {"text": "", "mock": False, "bytes": len(data), "error": "silence"}
        text = await asyncio.to_thread(_whisper_transcribe, wav)
        if text:
            logger.info("vap_stt whisper=1 chars=%d bytes=%d text=%s", len(text), len(data), text[:40])
            return {"text": text, "mock": False, "bytes": len(data)}
        logger.info("vap_stt skip bytes=%d reason=whisper ms=%d peak=%.4f", len(data), dur_ms, peak)
        return {"text": "", "mock": False, "bytes": len(data), "error": "whisper"}

    logger.info("vap_stt skip bytes=%d reason=no_backend", len(data))
    return {"text": "", "mock": False, "bytes": len(data), "error": "no_backend"}


def _clean_transcript(text: str) -> str:
    raw = " ".join(text.strip().split())
    if not raw:
        return ""
    compact = raw.replace(" ", "")
    if len(compact) >= 4 and len(set(compact)) == 1:
        return ""
    parts = raw.split()
    if len(parts) >= 4 and len(set(parts)) == 1:
        return ""
    return raw


def _whisper_transcribe(wav: bytes) -> str:
    bin_path = _which("whisper")
    if not bin_path or not wav:
        return ""
    work = tempfile.mkdtemp(prefix="vap-stt-")
    wav_path = str(Path(work) / "utter.wav")
    try:
        Path(wav_path).write_bytes(wav)
        proc = subprocess.run(
            [
                bin_path,
                wav_path,
                "--language",
                "zh",
                "--model",
                settings.WHISPER_MODEL or "base",
                "--model_dir",
                str(Path.home() / ".cache" / "whisper"),
                "--output_format",
                "txt",
                "--output_dir",
                work,
                "--fp16",
                "False",
                "--verbose",
                "False",
                "--temperature",
                "0",
                "--condition_on_previous_text",
                "False",
                "--initial_prompt",
                "简体中文短句。天气如何。你好。",
            ],
            capture_output=True,
            timeout=120,
        )
        if proc.returncode != 0:
            err = (proc.stderr or b"").decode("utf-8", errors="replace")[-300:]
            logger.warning("vap_stt whisper_fail rc=%s err=%s", proc.returncode, err)
            return ""
        texts = list(Path(work).glob("*.txt"))
        if not texts:
            return ""
        return _clean_transcript(texts[0].read_text(encoding="utf-8"))
    except subprocess.TimeoutExpired:
        logger.warning("vap_stt whisper_exc err=TimeoutExpired")
        return ""
    except Exception as exc:
        logger.warning("vap_stt whisper_exc err=%s", type(exc).__name__)
        return ""
    finally:
        shutil.rmtree(work, ignore_errors=True)


def openai_envelope(content: str, *, model: str, mock: bool) -> dict[str, Any]:
    return {
        "id": "vap-llm",
        "object": "chat.completion",
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        "velxio": {"mock": mock},
    }


async def complete(body: dict[str, Any]) -> dict[str, Any]:
    text = _user_text(body)
    if mock_enabled():
        logger.info("vap_llm mock=1 chars=%d", len(text))
        return openai_envelope(mock_reply(text), model=settings.LLM_MODEL or "mock", mock=True)

    url = settings.LLM_BASE_URL.rstrip("/")
    if not url.endswith("/chat/completions"):
        url = f"{url}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.LLM_API_KEY}",
    }
    payload = {
        "model": body.get("model") or settings.LLM_MODEL or "gpt-4o-mini",
        "messages": body.get("messages") or [{"role": "user", "content": text}],
    }
    logger.info("vap_llm mock=0 upstream_post chars=%d", len(text))
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict) and data.get("choices"):
                return data
            return openai_envelope(str(data)[:200], model=payload["model"], mock=False)
    except Exception as exc:
        logger.warning("vap_llm upstream_fail err=%s", type(exc).__name__)
        return openai_envelope(f"上游失败，回退 mock。{mock_reply(text)}", model="mock", mock=True)
