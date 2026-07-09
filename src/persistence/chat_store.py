from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Any

from src.persistence.app_database import app_db, dumps_json, loads_json, now_ts


@dataclass(frozen=True)
class ChatSessionRecord:
    id: str
    user_id: str
    name: str
    ui_transcript: list[dict[str, Any]]
    context_messages: list[dict[str, Any]]
    active_skills: list[dict[str, Any]]
    attached_files: list[str]
    conversation_version: int
    created_at: float
    updated_at: float


class StaleConversationVersion(Exception):
    pass


def _row_to_record(row: Any) -> ChatSessionRecord:
    return ChatSessionRecord(
        id=str(row["id"]),
        user_id=str(row["user_id"]),
        name=str(row["name"]),
        ui_transcript=loads_json(row["ui_transcript_json"], []),
        context_messages=loads_json(row["context_messages_json"], []),
        active_skills=loads_json(row["active_skills_json"], []),
        attached_files=loads_json(row["attached_files_json"], []),
        conversation_version=int(row["conversation_version"]),
        created_at=float(row["created_at"]),
        updated_at=float(row["updated_at"]),
    )


def ensure_session(user_id: str, session_id: str, name: str | None = None) -> ChatSessionRecord:
    ts = now_ts()
    with app_db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM chat_sessions WHERE user_id = ? AND id = ? AND deleted_at IS NULL",
            (user_id, session_id),
        ).fetchone()
        if row is None:
            try:
                conn.execute(
                    """
                    INSERT INTO chat_sessions (id, user_id, name, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (session_id, user_id, name or "New workspace", ts, ts),
                )
            except sqlite3.IntegrityError:
                conn.execute(
                    """
                    UPDATE chat_sessions
                    SET name = ?,
                        ui_transcript_json = '[]',
                        context_messages_json = '[]',
                        active_skills_json = '[]',
                        attached_files_json = '[]',
                        conversation_version = conversation_version + 1,
                        updated_at = ?,
                        deleted_at = NULL
                    WHERE user_id = ? AND id = ?
                    """,
                    (name or "New workspace", ts, user_id, session_id),
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


def list_sessions(user_id: str) -> list[ChatSessionRecord]:
    with app_db.connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM chat_sessions
            WHERE user_id = ? AND deleted_at IS NULL
            ORDER BY updated_at DESC
            """,
            (user_id,),
        ).fetchall()
    return [_row_to_record(row) for row in rows]


def update_session_name(user_id: str, session_id: str, name: str) -> ChatSessionRecord:
    name = name.strip() or "New workspace"
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
    params: tuple[Any, ...]
    if attached_files is None:
        sql = """
            UPDATE chat_sessions
            SET ui_transcript_json = ?, updated_at = ?
            WHERE user_id = ? AND id = ? AND deleted_at IS NULL
        """
        params = (dumps_json(transcript), now_ts(), user_id, session_id)
    else:
        sql = """
            UPDATE chat_sessions
            SET ui_transcript_json = ?, attached_files_json = ?, updated_at = ?
            WHERE user_id = ? AND id = ? AND deleted_at IS NULL
        """
        params = (dumps_json(transcript), dumps_json(attached_files), now_ts(), user_id, session_id)
    with app_db.connect() as conn:
        conn.execute(sql, params)
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
