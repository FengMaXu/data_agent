from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from src.persistence.app_database import app_db, dumps_json, loads_json, now_ts


@dataclass(frozen=True)
class ChatSessionRecord:
    id: str
    user_id: str
    task_id: str
    name: str
    ui_transcript: list[dict[str, Any]]
    context_messages: list[dict[str, Any]]
    active_skills: list[dict[str, Any]]
    attached_files: list[str]
    conversation_version: int
    started_at: float | None
    created_at: float
    updated_at: float


class StaleConversationVersion(Exception):
    pass


DEFAULT_SESSION_NAMES = {
    "New session",
    "New Session",
    "新会话",
    "New workspace",
    "New Workspace",
    "新建工作区",
}


def _first_user_content(messages: list[dict[str, Any]]) -> str:
    for message in messages:
        if message.get("role") == "user":
            return re.sub(r"\s+", " ", str(message.get("content", ""))).strip()
    return ""


def _format_session_name(started_at: float, first_message: str) -> str:
    return f"{datetime.fromtimestamp(started_at):%m月%d日}_{first_message}"


def _row_to_record(row: Any) -> ChatSessionRecord:
    return ChatSessionRecord(
        id=str(row["id"]),
        user_id=str(row["user_id"]),
        task_id=str(row["task_id"] or ""),
        name=str(row["name"]),
        ui_transcript=loads_json(row["ui_transcript_json"], []),
        context_messages=loads_json(row["context_messages_json"], []),
        active_skills=loads_json(row["active_skills_json"], []),
        attached_files=loads_json(row["attached_files_json"], []),
        conversation_version=int(row["conversation_version"]),
        started_at=float(row["started_at"]) if row["started_at"] is not None else None,
        created_at=float(row["created_at"]),
        updated_at=float(row["updated_at"]),
    )


def ensure_session(
    user_id: str,
    session_id: str,
    name: str | None = None,
    task_id: str | None = None,
) -> ChatSessionRecord:
    ts = now_ts()
    session_name = name or "New session"
    resolved_task_id = task_id or f"task_{session_id}"
    with app_db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM chat_sessions WHERE user_id = ? AND id = ? AND deleted_at IS NULL",
            (user_id, session_id),
        ).fetchone()
        if row is None:
            task = conn.execute(
                "SELECT id FROM tasks WHERE user_id = ? AND id = ? AND deleted_at IS NULL",
                (user_id, resolved_task_id),
            ).fetchone()
            if task is None:
                if task_id is not None:
                    raise KeyError(task_id)
                task_name = name if name and name not in DEFAULT_SESSION_NAMES else "New task"
                conn.execute(
                    """
                    INSERT OR IGNORE INTO tasks (id, user_id, name, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (resolved_task_id, user_id, task_name, ts, ts),
                )
            try:
                conn.execute(
                    """
                    INSERT INTO chat_sessions (id, user_id, task_id, name, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (session_id, user_id, resolved_task_id, session_name, ts, ts),
                )
            except sqlite3.IntegrityError:
                conn.execute(
                    """
                    UPDATE chat_sessions
                    SET task_id = ?,
                        name = ?,
                        ui_transcript_json = '[]',
                        context_messages_json = '[]',
                        active_skills_json = '[]',
                        attached_files_json = '[]',
                        conversation_version = conversation_version + 1,
                        started_at = NULL,
                        updated_at = ?,
                        deleted_at = NULL
                    WHERE user_id = ? AND id = ?
                    """,
                    (resolved_task_id, session_name, ts, user_id, session_id),
                )
            row = conn.execute(
                "SELECT * FROM chat_sessions WHERE user_id = ? AND id = ? AND deleted_at IS NULL",
                (user_id, session_id),
            ).fetchone()
    return _row_to_record(row)


def get_session(user_id: str, session_id: str) -> ChatSessionRecord | None:
    with app_db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM chat_sessions WHERE user_id = ? AND id = ? AND deleted_at IS NULL",
            (user_id, session_id),
        ).fetchone()
    return _row_to_record(row) if row is not None else None


def list_sessions(user_id: str, task_id: str | None = None) -> list[ChatSessionRecord]:
    where_task = " AND task_id = ?" if task_id is not None else ""
    params: tuple[Any, ...] = (user_id, task_id) if task_id is not None else (user_id,)
    with app_db.connect() as conn:
        rows = conn.execute(
            f"""
            SELECT * FROM chat_sessions
            WHERE user_id = ? AND deleted_at IS NULL{where_task}
            ORDER BY created_at DESC
            """,
            params,
        ).fetchall()
    return [_row_to_record(row) for row in rows]


def update_session_name(user_id: str, session_id: str, name: str) -> ChatSessionRecord:
    name = name.strip() or "New session"
    with app_db.connect() as conn:
        conn.execute(
            """
            UPDATE chat_sessions
            SET name = ?, updated_at = ?
            WHERE user_id = ? AND id = ? AND deleted_at IS NULL
            """,
            (name, now_ts(), user_id, session_id),
        )
    record = get_session(user_id, session_id)
    if record is None:
        raise KeyError(session_id)
    return record


def update_ui_transcript(
    user_id: str,
    session_id: str,
    transcript: list[dict[str, Any]],
    attached_files: list[str] | None = None,
    conversation_version: int | None = None,
) -> ChatSessionRecord:
    ensure_session(user_id, session_id)
    record = get_session(user_id, session_id)
    if record is None:
        raise KeyError(session_id)
    if (
        conversation_version is not None
        and conversation_version != record.conversation_version
    ):
        raise StaleConversationVersion(session_id)
    ts = now_ts()
    first_message = _first_user_content(transcript)
    should_name = bool(first_message) and record.started_at is None
    started_at = ts if first_message and record.started_at is None else record.started_at
    session_name = _format_session_name(started_at, first_message) if should_name and started_at else record.name

    with app_db.connect() as conn:
        if attached_files is None:
            conn.execute(
                """
                UPDATE chat_sessions
                SET ui_transcript_json = ?, name = ?, started_at = ?, updated_at = ?
                WHERE user_id = ? AND id = ? AND deleted_at IS NULL
                """,
                (dumps_json(transcript), session_name, started_at, ts, user_id, session_id),
            )
        else:
            conn.execute(
                """
                UPDATE chat_sessions
                SET ui_transcript_json = ?, attached_files_json = ?, name = ?, started_at = ?, updated_at = ?
                WHERE user_id = ? AND id = ? AND deleted_at IS NULL
                """,
                (
                    dumps_json(transcript),
                    dumps_json(attached_files),
                    session_name,
                    started_at,
                    ts,
                    user_id,
                    session_id,
                ),
            )
        conn.execute(
            "UPDATE tasks SET updated_at = ? WHERE user_id = ? AND id = ? AND deleted_at IS NULL",
            (ts, user_id, record.task_id),
        )
    record = get_session(user_id, session_id)
    if record is None:
        raise KeyError(session_id)
    return record


def update_attached_files(
    user_id: str,
    session_id: str,
    attached_files: list[str],
    conversation_version: int | None = None,
) -> None:
    ensure_session(user_id, session_id)
    record = get_session(user_id, session_id)
    if record is None:
        raise KeyError(session_id)
    if (
        conversation_version is not None
        and conversation_version != record.conversation_version
    ):
        raise StaleConversationVersion(session_id)
    with app_db.connect() as conn:
        conn.execute(
            """
            UPDATE chat_sessions
            SET attached_files_json = ?, updated_at = ?
            WHERE user_id = ? AND id = ? AND deleted_at IS NULL
            """,
            (dumps_json(attached_files), now_ts(), user_id, session_id),
        )


def update_context_snapshot(
    user_id: str,
    session_id: str,
    messages: list[dict[str, Any]],
    active_skills: list[dict[str, Any]],
) -> None:
    ensure_session(user_id, session_id)
    with app_db.connect() as conn:
        conn.execute(
            """
            UPDATE chat_sessions
            SET context_messages_json = ?, active_skills_json = ?, updated_at = ?
            WHERE user_id = ? AND id = ? AND deleted_at IS NULL
            """,
            (dumps_json(messages), dumps_json(active_skills), now_ts(), user_id, session_id),
        )


def clear_session_content(user_id: str, session_id: str) -> ChatSessionRecord:
    ensure_session(user_id, session_id)
    with app_db.connect() as conn:
        conn.execute(
            """
            UPDATE chat_sessions
            SET ui_transcript_json = '[]',
                context_messages_json = '[]',
                active_skills_json = '[]',
                attached_files_json = '[]',
                conversation_version = conversation_version + 1,
                updated_at = ?
            WHERE user_id = ? AND id = ? AND deleted_at IS NULL
            """,
            (now_ts(), user_id, session_id),
        )
    record = get_session(user_id, session_id)
    if record is None:
        raise KeyError(session_id)
    return record


def delete_session(user_id: str, session_id: str) -> None:
    with app_db.connect() as conn:
        conn.execute(
            """
            UPDATE chat_sessions
            SET deleted_at = ?, updated_at = ?
            WHERE user_id = ? AND id = ? AND deleted_at IS NULL
            """,
            (now_ts(), now_ts(), user_id, session_id),
        )
