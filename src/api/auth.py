from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from src.auth.service import (
    AuthError,
    create_auth_session,
    create_user,
    authenticate_user,
    can_register_user,
    get_user_by_token,
    revoke_token,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class AuthRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(AuthRequest):
    display_name: str | None = None


def _token_from_request(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return None


def _auth_response(user_id: str, username: str, display_name: str):
    token, expires_at = create_auth_session(user_id)
    return {
        "token": token,
        "expires_at": expires_at,
        "user": {
            "id": user_id,
            "username": username,
            "display_name": display_name,
        },
    }


@router.get("/status")
async def auth_status(request: Request):
    user = get_user_by_token(_token_from_request(request))
    return {
        "authenticated": user is not None,
        "registration_open": can_register_user(),
        "user": None if user is None else {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
        },
    }


@router.post("/register")
async def register(req: RegisterRequest):
    if not can_register_user():
        raise HTTPException(status_code=403, detail="Registration is closed")
    try:
        user = create_user(req.username, req.password, req.display_name)
    except AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _auth_response(user.id, user.username, user.display_name)


@router.post("/login")
async def login(req: AuthRequest):
    try:
        user = authenticate_user(req.username, req.password)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return _auth_response(user.id, user.username, user.display_name)


@router.post("/logout")
async def logout(request: Request):
    token = _token_from_request(request)
    if token:
        revoke_token(token)
    return {"status": "success"}
