from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from src.persistence.app_database import app_db, now_ts

PASSWORD_ITERATIONS = 260_000
SESSION_TTL_SECONDS = 30 * 24 * 3600


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    username: str
    display_name: str


class AuthError(ValueError):
    pass


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_ITERATIONS,
    )
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations_raw, salt_raw, digest_raw = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_raw)
        salt = base64.urlsafe_b64decode(salt_raw + "===")
        expected = base64.urlsafe_b64decode(digest_raw + "===")
    except Exception:
        return False

    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(actual, expected)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _row_to_user(row: Any) -> AuthenticatedUser:
    return AuthenticatedUser(
        id=str(row["id"]),
        username=str(row["username"]),
        display_name=str(row["display_name"]),
    )


def user_count() -> int:
    with app_db.connect() as conn:
        row = conn.execute("SELECT COUNT(*) AS total FROM users WHERE username != ?", ("local",)).fetchone()
        return int(row["total"])


def can_register_user() -> bool:
    if user_count() == 0:
        return True
    return os.getenv("DATA_AGENT_ALLOW_REGISTRATION", "").lower() in {"1", "true", "yes"}


def create_user(username: str, password: str, display_name: str | None = None) -> AuthenticatedUser:
    username = username.strip().lower()
    if len(username) < 3:
        raise AuthError("Username must be at least 3 characters")
    if len(password) < 8:
        raise AuthError("Password must be at least 8 characters")

    user_id = f"user_{uuid4().hex}"
    ts = now_ts()
    try:
        with app_db.connect() as conn:
            conn.execute(
                """
                INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, username, hash_password(password), display_name or username, ts, ts),
            )
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    except Exception as exc:
        if "UNIQUE" in str(exc).upper():
            raise AuthError("Username already exists") from exc
        raise
    return _row_to_user(row)


def authenticate_user(username: str, password: str) -> AuthenticatedUser:
    with app_db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ? AND is_active = 1",
            (username.strip().lower(),),
        ).fetchone()
    if row is None or not verify_password(password, str(row["password_hash"])):
        raise AuthError("Invalid username or password")
    return _row_to_user(row)


def create_auth_session(user_id: str) -> tuple[str, float]:
    token = secrets.token_urlsafe(32)
    ts = now_ts()
    expires_at = ts + SESSION_TTL_SECONDS
    with app_db.connect() as conn:
        conn.execute(
            """
            INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (f"auth_{uuid4().hex}", user_id, _hash_token(token), ts, expires_at),
        )
    return token, expires_at


def get_user_by_token(token: str | None) -> AuthenticatedUser | None:
    if not token:
        return None
    ts = now_ts()
    with app_db.connect() as conn:
        row = conn.execute(
            """
            SELECT users.*
            FROM auth_sessions
            JOIN users ON users.id = auth_sessions.user_id
            WHERE auth_sessions.token_hash = ?
              AND auth_sessions.revoked_at IS NULL
              AND auth_sessions.expires_at > ?
              AND users.is_active = 1
            """,
            (_hash_token(token), ts),
        ).fetchone()
    return _row_to_user(row) if row is not None else None


def revoke_token(token: str) -> None:
    with app_db.connect() as conn:
        conn.execute(
            "UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
            (now_ts(), _hash_token(token)),
        )


def ensure_local_user() -> AuthenticatedUser:
    with app_db.connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", ("local",)).fetchone()
        if row is not None:
            return _row_to_user(row)

        ts = now_ts()
        conn.execute(
            """
            INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("local", "local", hash_password(secrets.token_urlsafe(18)), "Local User", ts, ts),
        )
        row = conn.execute("SELECT * FROM users WHERE id = ?", ("local",)).fetchone()
    return _row_to_user(row)
