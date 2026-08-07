from __future__ import annotations

import json
import os
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator


def _default_database_path() -> Path:
    configured = os.getenv("DATA_AGENT_APP_DB")
    if configured:
        return Path(configured).expanduser()
    return Path.cwd() / ".data_agent" / "app.sqlite3"


class AppDatabase:
    def __init__(self, path: Path | None = None):
        self.path = path or _default_database_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def initialize(self) -> None:
        with sqlite3.connect(self.path) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS auth_sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    token_hash TEXT NOT NULL UNIQUE,
                    created_at REAL NOT NULL,
                    expires_at REAL NOT NULL,
                    revoked_at REAL
                );

                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT NOT NULL,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    deleted_at REAL,
                    PRIMARY KEY (user_id, id)
                );

                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id TEXT NOT NULL,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    task_id TEXT,
                    name TEXT NOT NULL,
                    ui_transcript_json TEXT NOT NULL DEFAULT '[]',
                    context_messages_json TEXT NOT NULL DEFAULT '[]',
                    active_skills_json TEXT NOT NULL DEFAULT '[]',
                    attached_files_json TEXT NOT NULL DEFAULT '[]',
                    conversation_version INTEGER NOT NULL DEFAULT 1,
                    started_at REAL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    deleted_at REAL,
                    PRIMARY KEY (user_id, id)
                );

                CREATE INDEX IF NOT EXISTS idx_auth_sessions_token
                    ON auth_sessions(token_hash);
                CREATE INDEX IF NOT EXISTS idx_tasks_user_updated
                    ON tasks(user_id, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated
                    ON chat_sessions(user_id, updated_at DESC);
                """
            )
            columns = {
                row[1]
                for row in conn.execute("PRAGMA table_info(chat_sessions)").fetchall()
            }
            if "conversation_version" not in columns:
                conn.execute(
                    "ALTER TABLE chat_sessions "
                    "ADD COLUMN conversation_version INTEGER NOT NULL DEFAULT 1"
                )
            if "task_id" not in columns:
                conn.execute("ALTER TABLE chat_sessions ADD COLUMN task_id TEXT")
            if "started_at" not in columns:
                conn.execute("ALTER TABLE chat_sessions ADD COLUMN started_at REAL")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_chat_sessions_task "
                "ON chat_sessions(user_id, task_id, created_at DESC)"
            )

            # Existing workspaces become tasks containing their original conversation.
            legacy_rows = conn.execute(
                "SELECT * FROM chat_sessions WHERE task_id IS NULL"
            ).fetchall()
            for row in legacy_rows:
                task_id = f"task_{row['id']}"
                legacy_task_name = row["name"]
                if legacy_task_name in {"New workspace", "New Workspace", "新建工作区"}:
                    legacy_task_name = "New task"
                conn.execute(
                    """
                    INSERT OR IGNORE INTO tasks (id, user_id, name, created_at, updated_at, deleted_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        task_id,
                        row["user_id"],
                        legacy_task_name,
                        row["created_at"],
                        row["updated_at"],
                        row["deleted_at"],
                    ),
                )
                first_message = ""
                try:
                    transcript = json.loads(row["ui_transcript_json"] or "[]")
                except json.JSONDecodeError:
                    transcript = []
                for message in transcript:
                    if message.get("role") == "user":
                        first_message = " ".join(str(message.get("content", "")).split())
                        break
                if first_message:
                    session_name = f"{datetime.fromtimestamp(row['created_at']):%m月%d日}_{first_message}"
                    started_at = row["created_at"]
                else:
                    session_name = "New session"
                    started_at = None
                conn.execute(
                    """
                    UPDATE chat_sessions
                    SET task_id = ?, name = ?, started_at = ?
                    WHERE user_id = ? AND id = ?
                    """,
                    (task_id, session_name, started_at, row["user_id"], row["id"]),
                )

            conn.execute(
                """
                UPDATE tasks SET name = 'New task'
                WHERE name IN ('New workspace', 'New Workspace', '新建工作区')
                """
            )

            # Remove only the empty initial sessions created by the previous
            # task-creation flow. They share the task's exact creation time;
            # explicitly created sessions use their own timestamp.
            conn.execute(
                """
                UPDATE chat_sessions
                SET deleted_at = COALESCE(deleted_at, updated_at)
                WHERE deleted_at IS NULL
                  AND started_at IS NULL
                  AND name IN ('New session', 'New Session', '新会话')
                  AND ui_transcript_json = '[]'
                  AND context_messages_json = '[]'
                  AND attached_files_json = '[]'
                  AND EXISTS (
                      SELECT 1 FROM tasks
                      WHERE tasks.user_id = chat_sessions.user_id
                        AND tasks.id = chat_sessions.task_id
                        AND tasks.created_at = chat_sessions.created_at
                  )
                """
            )


app_db = AppDatabase()


def now_ts() -> float:
    return time.time()


def dumps_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def loads_json(raw: str | None, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return fallback
