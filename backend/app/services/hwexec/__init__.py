"""Codex 可调用的硬件执行服务。

编译与仿真可以在容器里跑；USB 烧录只在插着开发板的本地执行器上跑。
CLI、MCP、HTTP 都调用 ``runner.execute``。
"""

from app.services.hwexec.runner import compile_sketch, execute

__all__ = ["compile_sketch", "execute"]
