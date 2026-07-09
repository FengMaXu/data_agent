from uuid import uuid4

import pytest

from src.auth import service as auth_service
from src.auth.service import authenticate_user, create_user
from src.persistence.app_database import AppDatabase
from src.persistence import chat_store


@pytest.fixture(autouse=True)
def isolated_app_db(tmp_path, monkeypatch):
    db = AppDatabase(tmp_path / "app.sqlite3")
    monkeypatch.setattr(auth_service, "app_db", db)
    monkeypatch.setattr(chat_store, "app_db", db)


def test_create_and_authenticate_user():
    username = f"user_{uuid4().hex[:12]}"
    password = "correct-horse-battery"

    created = create_user(username, password, "Test User")
    authenticated = authenticate_user(username, password)

    assert authenticated.id == created.id
    assert authenticated.display_name == "Test User"


def test_chat_session_persists_transcript_and_context():
    username = f"user_{uuid4().hex[:12]}"
    user = create_user(username, "correct-horse-battery", "Chat User")
    session_id = f"session_{uuid4().hex}"

    chat_store.ensure_session(user.id, session_id, "Analysis")
    chat_store.update_ui_transcript(
        user.id,
        session_id,
        [{"id": "u1", "role": "user", "content": "hello"}],
        ["session/file.csv"],
    )
    chat_store.update_context_snapshot(
        user.id,
        session_id,
        [{"role": "user", "content": "hello"}],
        [],
    )

    record = chat_store.get_session(user.id, session_id)

    assert record is not None
    assert record.name == "Analysis"
    assert record.ui_transcript[0]["content"] == "hello"
    assert record.context_messages[0]["role"] == "user"
    assert record.attached_files == ["session/file.csv"]


def test_ensure_session_is_idempotent_for_existing_session():
    username = f"user_{uuid4().hex[:12]}"
    user = create_user(username, "correct-horse-battery", "Chat User")
    session_id = f"session_{uuid4().hex}"

    first = chat_store.ensure_session(user.id, session_id, "Analysis")
    second = chat_store.ensure_session(user.id, session_id, "Analysis")

    assert second.id == first.id
    assert second.name == "Analysis"


def test_clear_session_content_resets_context_and_increments_version():
    username = f"user_{uuid4().hex[:12]}"
    user = create_user(username, "correct-horse-battery", "Chat User")
    session_id = f"session_{uuid4().hex}"

    chat_store.ensure_session(user.id, session_id, "Analysis")
    chat_store.update_ui_transcript(
        user.id,
        session_id,
        [{"id": "u1", "role": "user", "content": "hello"}],
        ["session/file.csv"],
    )
    chat_store.update_context_snapshot(
        user.id,
        session_id,
        [{"role": "user", "content": "hello"}],
        [{"name": "dashboard"}],
    )
    before = chat_store.get_session(user.id, session_id)

    cleared = chat_store.clear_session_content(user.id, session_id)

    assert before is not None
    assert cleared.conversation_version == before.conversation_version + 1
    assert cleared.ui_transcript == []
    assert cleared.context_messages == []
    assert cleared.active_skills == []
    assert cleared.attached_files == []


def test_stale_transcript_write_is_rejected_after_clear():
    username = f"user_{uuid4().hex[:12]}"
    user = create_user(username, "correct-horse-battery", "Chat User")
    session_id = f"session_{uuid4().hex}"

    created = chat_store.ensure_session(user.id, session_id, "Analysis")
    cleared = chat_store.clear_session_content(user.id, session_id)

    with pytest.raises(chat_store.StaleConversationVersion):
        chat_store.update_ui_transcript(
            user.id,
            session_id,
            [{"id": "old", "role": "user", "content": "old"}],
            conversation_version=created.conversation_version,
        )

    current = chat_store.get_session(user.id, session_id)
    assert current is not None
    assert current.conversation_version == cleared.conversation_version
    assert current.ui_transcript == []
