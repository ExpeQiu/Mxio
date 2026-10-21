from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """OSS settings — stateless deployment.

    Auth, DB, OAuth, billing, mail relay etc. moved to the velxio-prod
    private overlay during the Phase 1-4 OSS/pro split. The overlay
    physically replaces this file at Docker build time with a richer
    Settings class that ADDS those fields on top of FRONTEND_URL (see
    pro/backend/app/core/config.py).

    Adding a setting here means the stateless OSS image will read it.
    If the new setting only makes sense with an auth/DB stack (e.g.
    SMTP creds, third-party API keys for analytics), add it to the
    overlay's config.py instead so the OSS image stays minimal.
    """

    # CORS — used by main.py to whitelist the SPA origin during local dev
    # and to build redirect URLs from auth routes in the overlay.
    FRONTEND_URL: str = "http://localhost:5173"

    # VAP LLM 网关（P1）。默认 Mock；Key 只进 .env，不回给浏览器。
    AI_MOCK_MODE: bool = True
    LLM_BASE_URL: str = ""
    LLM_API_KEY: str = ""
    LLM_MODEL: str = "mock"
    # QEMU slirp guestfwd：板内 192.168.4.2:80 → 本机此地址
    LLM_GUESTFWD: str = "127.0.0.1:8001"
    # STT：浏览器识别优先；宿主可接 FunASR。STT_MOCK=true 才用假「你好」。
    STT_MOCK: bool = False
    FUNASR_BASE_URL: str = ""
    WHISPER_MODEL: str = "base"

    # 硬件执行服务。空字符串表示走代码里的默认（本机自动、容器关闭 USB）。
    # 远程 HTTP 必须带 Bearer；USB 只在连接开发板的本地执行器上开放。
    VELXIO_EXEC_TOKEN: str = ""
    VELXIO_DEVICE_ALLOW: str = ""
    VELXIO_HARDWARE_LOCAL: str = ""
    VELXIO_EXEC_DB: str = ""
    VELXIO_SSH_ACCEPT_NEW: bool = False

    # extra="ignore": tolerate legacy keys (DATA_DIR, SECRET_KEY, DATABASE_URL, …)
    # left over from pre-split .env files or from the velxio-prod overlay so the
    # OSS image starts cleanly instead of crashing with extra_forbidden.
    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()
