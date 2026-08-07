import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest

from src.api import tasks as tasks_api
from src.auth import service as auth_service
from src.auth.service import authenticate_user, create_user
from src.persistence.app_database import AppDatabase
from src.persistence import chat_store, task_store


@pytest.fixture(autouse=True)
def isolated_app_db(tmp_path, monkeypatch):
    db = AppDatabase(tmp_path / "app.sqlite3")
    monkeypatch.setattr(auth_service, "app_db", db)
    monkeypatch.setattr(chat_store, "app_db", db)
    monkeypatch.setattr(task_store, "app_db", db)


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
    assert record.name.endswith("_hello")
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


def test_task_api_returns_task_session_hierarchy():
    username = f"user_{uuid4().hex[:12]}"
    user = create_user(username, "correct-horse-battery", "Task User")
    request = SimpleNamespace(state=SimpleNamespace(current_user=user))
    task_id = f"task_{uuid4().hex}"
    session_id = f"session_{uuid4().hex}"

    asyncio.run(tasks_api.create_task(
        tasks_api.TaskCreateRequest(id=task_id, name="经营分析"),
        request,
    ))
    before_session = asyncio.run(tasks_api.list_tasks(request))
    asyncio.run(tasks_api.create_task_session(
        task_id,
        tasks_api.TaskSessionCreateRequest(id=session_id),
        request,
    ))
    after_session = asyncio.run(tasks_api.list_tasks(request))

    assert before_session["tasks"][0]["id"] == task_id
    assert before_session["tasks"][0]["sessions"] == []
    assert after_session["tasks"][0]["sessions"][0]["task_id"] == task_id
    assert after_session["tasks"][0]["sessions"][0]["id"] == session_id


def test_create_task_does_not_create_session():
    username = f"user_{uuid4().hex[:12]}"
    user = create_user(username, "correct-horse-battery", "Task User")
    task_id = f"task_{uuid4().hex}"
    task = task_store.create_task(user.id, task_id, "经营分析")

    assert task.name == "经营分析"
    assert chat_store.list_sessions(user.id, task.id) == []


def test_task_contains_multiple_automatically_named_sessions():
    username = f"user_{uuid4().hex[:12]}"
    user = create_user(username, "correct-horse-battery", "Task User")
    task_id = f"task_{uuid4().hex}"
    first_session_id = f"session_{uuid4().hex}"
    second_session_id = f"session_{uuid4().hex}"

    task_store.create_task(user.id, task_id, "季度经营分析")
    first = chat_store.ensure_session(user.id, first_session_id, "New session", task_id=task_id)
    second = chat_store.ensure_session(user.id, second_session_id, "New session", task_id=task_id)
    named = chat_store.update_ui_transcript(
        user.id,
        first.id,
        [{"id": "u1", "role": "user", "content": "分析一季度\n销售情况"}],
    )

    assert named.task_id == task_id
    assert named.name.endswith("_分析一季度 销售情况")
    assert len(chat_store.list_sessions(user.id, task_id)) == 2
    assert second.name == "New session"


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
