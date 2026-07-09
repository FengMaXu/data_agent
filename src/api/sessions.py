from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from src.auth.service import AuthenticatedUser
from src.persistence import chat_store

router = APIRouter(prefix="/sessions", tags=["sessions"])


class SessionCreateRequest(BaseModel):
    id: str
    name: str = "New workspace"


class SessionUpdateRequest(BaseModel):
    name: str


class TranscriptUpdateRequest(BaseModel):
    messages: list[dict[str, Any]] = Field(default_factory=list)
    attached_files: list[str] | None = None
    conversation_version: int | None = None


class AttachedFilesUpdateRequest(BaseModel):
    attached_files: list[str] = Field(default_factory=list)
    conversation_version: int | None = None


def current_user(request: Request) -> AuthenticatedUser:
    user = getattr(request.state, "current_user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


def serialize_session(record: chat_store.ChatSessionRecord, include_transcript: bool = False) -> dict[str, Any]:
    payload = {
        "id": record.id,
        "name": record.name,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
        "attached_files": record.attached_files,
        "conversation_version": record.conversation_version,
    }
    if include_transcript:
        payload["messages"] = record.ui_transcript
    return payload


@router.get("")
async def list_chat_sessions(request: Request):
    user = current_user(request)
    return {
        "sessions": [
            serialize_session(record)
            for record in chat_store.list_sessions(user.id)
        ]
    }


@router.post("")
async def create_chat_session(req: SessionCreateRequest, request: Request):
    user = current_user(request)
    record = chat_store.ensure_session(user.id, req.id, req.name)
    if req.name != record.name:
        record = chat_store.update_session_name(user.id, req.id, req.name)
    return serialize_session(record, include_transcript=True)


@router.get("/{session_id}")
async def get_chat_session(session_id: str, request: Request):
    user = current_user(request)
    record = chat_store.get_session(user.id, session_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return serialize_session(record, include_transcript=True)


@router.patch("/{session_id}")
async def update_chat_session(session_id: str, req: SessionUpdateRequest, request: Request):
    user = current_user(request)
    try:
        record = chat_store.update_session_name(user.id, session_id, req.name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc
    return serialize_session(record, include_transcript=True)


@router.put("/{session_id}/transcript")
async def update_session_transcript(session_id: str, req: TranscriptUpdateRequest, request: Request):
    user = current_user(request)
    try:
        record = chat_store.update_ui_transcript(
            user.id,
            session_id,
            req.messages,
            req.attached_files,
            req.conversation_version,
        )
    except chat_store.StaleConversationVersion:
        current = chat_store.get_session(user.id, session_id)
        if current is None:
            raise HTTPException(status_code=404, detail="Session not found")
        payload = serialize_session(current, include_transcript=True)
        payload["status"] = "ignored"
        payload["reason"] = "stale_conversation_version"
        return payload
    return serialize_session(record, include_transcript=True)


@router.put("/{session_id}/attached-files")
async def update_session_attached_files(session_id: str, req: AttachedFilesUpdateRequest, request: Request):
    user = current_user(request)
    try:
        chat_store.update_attached_files(
            user.id,
            session_id,
            req.attached_files,
            req.conversation_version,
        )
    except chat_store.StaleConversationVersion:
        current = chat_store.get_session(user.id, session_id)
        return {
            "status": "ignored",
            "reason": "stale_conversation_version",
            "conversation_version": current.conversation_version if current else None,
        }
    return {"status": "success"}


@router.delete("/{session_id}")
async def delete_chat_session(session_id: str, request: Request):
    user = current_user(request)
    chat_store.delete_session(user.id, session_id)
    return {"status": "success"}
