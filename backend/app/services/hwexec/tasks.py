"""持久化任务、超时状态、取消和设备独占锁。"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from app.services.hwexec.proc import kill_group

logger = logging.getLogger("velxio.hwexec")

ACTIVE = ("queued", "running")


def default_db_path() -> Path:
    from app.services.hwexec.boundary import _setting

    configured = _setting("VELXIO_EXEC_DB").strip()
    if configured:
        return Path(configured)
    if os.environ.get("PYTEST_CURRENT_TEST"):
        root = Path(tempfile.gettempdir()) / "velxio-hwexec-tests"
        root.mkdir(parents=True, exist_ok=True)
        return root / f"hwexec-{os.getpid()}.sqlite"
    return Path.home() / ".velxio" / "hwexec.sqlite"


class TaskStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    device TEXT,
                    status TEXT NOT NULL,
                    pid INTEGER,
                    error TEXT,
                    result_json TEXT,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS locks (
                    device TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    acquired_at REAL NOT NULL
                );
                """
            )
        self.recover()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=5, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def recover(self) -> int:
        """启动时把残留的运行中任务标成失败，并清掉对应进程和锁。"""
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT id, pid FROM tasks WHERE status IN ('queued', 'running')"
            ).fetchall()
            for row in rows:
                logger.warning("恢复中断任务 id=%s pid=%s", row["id"], row["pid"])
                kill_group(row["pid"])
            if rows:
                conn.execute(
                    """
                    UPDATE tasks
                    SET status='failed', error='进程重启时中断', updated_at=?
                    WHERE status IN ('queued', 'running')
                    """,
                    (time.time(),),
                )
            conn.execute("DELETE FROM locks")
            conn.commit()
        if rows:
            logger.info("已恢复 %d 个中断任务", len(rows))
        return len(rows)

    def create(self, kind: str, device: str | None) -> str:
        task_id = uuid.uuid4().hex
        now = time.time()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO tasks (id, kind, device, status, created_at, updated_at)
                VALUES (?, ?, ?, 'queued', ?, ?)
                """,
                (task_id, kind, device, now, now),
            )
            conn.commit()
        logger.info("创建任务 id=%s kind=%s device=%s", task_id, kind, device)
        return task_id

    def mark(self, task_id: str, status: str, error: str | None = None) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "UPDATE tasks SET status=?, error=?, updated_at=? WHERE id=?",
                (status, error, time.time(), task_id),
            )
            conn.commit()
        logger.info("任务状态 id=%s status=%s error=%s", task_id, status, error)

    def set_pid(self, task_id: str, pid: int) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "UPDATE tasks SET pid=?, updated_at=? WHERE id=?",
                (pid, time.time(), task_id),
            )
            conn.commit()
        logger.info("任务进程 id=%s pid=%s", task_id, pid)

    def finish(self, task_id: str, status: str, result: dict[str, Any], error: str | None = None) -> None:
        payload = json.dumps(result, ensure_ascii=False)
        with self._lock, self._connect() as conn:
            current = conn.execute("SELECT status FROM tasks WHERE id=?", (task_id,)).fetchone()
            if current and current["status"] == "cancelled" and status != "cancelled":
                status = "cancelled"
            conn.execute(
                """
                UPDATE tasks
                SET status=?, error=?, result_json=?, pid=NULL, updated_at=?
                WHERE id=?
                """,
                (status, error, payload, time.time(), task_id),
            )
            conn.commit()
        logger.info("任务结束 id=%s status=%s", task_id, status)

    def get(self, task_id: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return _row_to_task(row) if row else None

    def list_tasks(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?",
                (max(1, min(limit, 200)),),
            ).fetchall()
        return [_row_to_task(row) for row in rows]

    def acquire(self, device: str, task_id: str) -> bool:
        now = time.time()
        with self._lock, self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT task_id FROM locks WHERE device=?", (device,)).fetchone()
            if row:
                owner = conn.execute(
                    "SELECT status FROM tasks WHERE id=?",
                    (row["task_id"],),
                ).fetchone()
                if owner and owner["status"] in ACTIVE and row["task_id"] != task_id:
                    conn.commit()
                    logger.warning("设备占用 device=%s owner=%s requester=%s", device, row["task_id"], task_id)
                    return False
            conn.execute(
                """
                INSERT INTO locks (device, task_id, acquired_at) VALUES (?, ?, ?)
                ON CONFLICT(device) DO UPDATE SET task_id=excluded.task_id, acquired_at=excluded.acquired_at
                """,
                (device, task_id, now),
            )
            conn.commit()
        logger.info("设备加锁 device=%s task=%s", device, task_id)
        return True

    def release(self, device: str | None, task_id: str) -> None:
        if not device:
            return
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM locks WHERE device=? AND task_id=?", (device, task_id))
            conn.commit()
        logger.info("设备解锁 device=%s task=%s", device, task_id)

    def cancel(self, task_id: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT status, pid FROM tasks WHERE id=?", (task_id,)).fetchone()
            if row is None:
                return None
            status = row["status"]
            pid = row["pid"]
            if status in ACTIVE:
                conn.execute(
                    """
                    UPDATE tasks
                    SET status='cancelled', error='已取消', updated_at=?
                    WHERE id=?
                    """,
                    (time.time(), task_id),
                )
                conn.execute("DELETE FROM locks WHERE task_id=?", (task_id,))
                conn.commit()
        if status in ACTIVE:
            kill_group(pid)
            logger.info("取消任务 id=%s pid=%s", task_id, pid)
        return self.get(task_id)


def _row_to_task(row: sqlite3.Row) -> dict[str, Any]:
    result = None
    if row["result_json"]:
        try:
            result = json.loads(row["result_json"])
        except json.JSONDecodeError:
            result = None
    return {
        "id": row["id"],
        "kind": row["kind"],
        "device": row["device"],
        "status": row["status"],
        "pid": row["pid"],
        "error": row["error"],
        "result": result,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


_STORE: TaskStore | None = None


def get_store() -> TaskStore:
    global _STORE
    path = default_db_path()
    if _STORE is None or _STORE.path != path:
        _STORE = TaskStore(path)
    return _STORE


def reset_store() -> None:
    global _STORE
    _STORE = None
