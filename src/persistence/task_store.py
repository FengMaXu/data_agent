from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.persistence.app_database import app_db, now_ts


@dataclass(frozen=True)
class TaskRecord:
    id: str
    user_id: str
    name: str
    created_at: float
    updated_at: float


def _row_to_record(row: Any) -> TaskRecord:
    return TaskRecord(
        id=str(row["id"]),
        user_id=str(row["user_id"]),
        name=str(row["name"]),
        created_at=float(row["created_at"]),
        updated_at=float(row["updated_at"]),
    )


def create_task(user_id: str, task_id: str, name: str = "New task") -> TaskRecord:
    ts = now_ts()
    clean_name = name.strip() or "New task"
    with app_db.connect() as conn:
        conn.execute(
            """
            INSERT INTO tasks (id, user_id, name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (task_id, user_id, clean_name, ts, ts),
        )
    record = get_task(user_id, task_id)
    if record is None:
        raise KeyError(task_id)
    return record


def get_task(user_id: str, task_id: str) -> TaskRecord | None:
    with app_db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM tasks WHERE user_id = ? AND id = ? AND deleted_at IS NULL",
            (user_id, task_id),
        ).fetchone()
    return _row_to_record(row) if row is not None else None


def list_tasks(user_id: str) -> list[TaskRecord]:
    with app_db.connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM tasks
            WHERE user_id = ? AND deleted_at IS NULL
            ORDER BY updated_at DESC
            """,
            (user_id,),
        ).fetchall()
    return [_row_to_record(row) for row in rows]


def update_task_name(user_id: str, task_id: str, name: str) -> TaskRecord:
    clean_name = name.strip() or "New task"
    with app_db.connect() as conn:
        cursor = conn.execute(
            """
            UPDATE tasks SET name = ?, updated_at = ?
            WHERE user_id = ? AND id = ? AND deleted_at IS NULL
            """,
            (clean_name, now_ts(), user_id, task_id),
        )
    if cursor.rowcount == 0:
        raise KeyError(task_id)
    record = get_task(user_id, task_id)
    if record is None:
        raise KeyError(task_id)
    return record


def touch_task(user_id: str, task_id: str) -> None:
    with app_db.connect() as conn:
        conn.execute(
            """
            UPDATE tasks SET updated_at = ?
            WHERE user_id = ? AND id = ? AND deleted_at IS NULL
            """,
            (now_ts(), user_id, task_id),
        )


def delete_task(user_id: str, task_id: str) -> None:
    ts = now_ts()
    with app_db.connect() as conn:
        conn.execute(
            """
            UPDATE tasks SET deleted_at = ?, updated_at = ?
            WHERE user_id = ? AND id = ? AND deleted_at IS NULL
            """,
            (ts, ts, user_id, task_id),
        )
        conn.execute(
            """
            UPDATE chat_sessions SET deleted_at = ?, updated_at = ?
            WHERE user_id = ? AND task_id = ? AND deleted_at IS NULL
            """,
            (ts, ts, user_id, task_id),
        )
