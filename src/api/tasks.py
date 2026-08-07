from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from src.api.sessions import current_user, serialize_session
from src.persistence import chat_store, task_store

router = APIRouter(prefix="/tasks", tags=["tasks"])


class TaskCreateRequest(BaseModel):
    id: str
    name: str = "New task"


class TaskUpdateRequest(BaseModel):
    name: str


class TaskSessionCreateRequest(BaseModel):
    id: str
    name: str = "New session"


def serialize_task(record: task_store.TaskRecord) -> dict[str, Any]:
    return {
        "id": record.id,
        "name": record.name,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


@router.get("")
async def list_tasks(request: Request):
    user = current_user(request)
    tasks = task_store.list_tasks(user.id)
    sessions_by_task: dict[str, list[dict[str, Any]]] = {}
    for session in chat_store.list_sessions(user.id):
        sessions_by_task.setdefault(session.task_id, []).append(serialize_session(session))

    payload = []
    for task in tasks:
        item = serialize_task(task)
        item["sessions"] = sessions_by_task.get(task.id, [])
        payload.append(item)
    return {"tasks": payload}


@router.post("")
async def create_task(req: TaskCreateRequest, request: Request):
    user = current_user(request)
    try:
        task = task_store.create_task(user.id, req.id, req.name)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Task already exists") from exc
    payload = serialize_task(task)
    payload["sessions"] = []
    return payload


@router.patch("/{task_id}")
async def update_task(task_id: str, req: TaskUpdateRequest, request: Request):
    user = current_user(request)
    try:
        task = task_store.update_task_name(user.id, task_id, req.name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc
    return serialize_task(task)


@router.delete("/{task_id}")
async def delete_task(task_id: str, request: Request):
    user = current_user(request)
    if task_store.get_task(user.id, task_id) is None:
        raise HTTPException(status_code=404, detail="Task not found")
    task_store.delete_task(user.id, task_id)
    return {"status": "success"}


@router.post("/{task_id}/sessions")
async def create_task_session(task_id: str, req: TaskSessionCreateRequest, request: Request):
    user = current_user(request)
    if task_store.get_task(user.id, task_id) is None:
        raise HTTPException(status_code=404, detail="Task not found")
    try:
        session = chat_store.ensure_session(user.id, req.id, req.name, task_id=task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc
    task_store.touch_task(user.id, task_id)
    return serialize_session(session, include_transcript=True)
