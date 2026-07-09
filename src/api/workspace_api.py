"""
工作区文件管理 API
提供文件列表查询、文件下载、文件上传三大接口，
供前端 WorkspacePanel 调用以实现工作区文件可视化管理。
"""

import logging
import mimetypes
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from src.auth.service import ensure_local_user
from src.persistence import chat_store

logger = logging.getLogger("data_agent.api.workspace")

# 工作区根目录
WORKSPACE_ROOT = Path(os.getcwd()) / "workspace"

# 上传文件大小限制：100MB
MAX_UPLOAD_SIZE = 100 * 1024 * 1024

router = APIRouter(prefix="/workspace", tags=["workspace"])


# ==========================================
# 响应模型
# ==========================================


class FileItem(BaseModel):
    """单个文件/目录的元数据"""

    name: str
    type: str  # "file" | "directory"
    size: int = 0
    modified_at: str = ""
    relative_path: str = ""
    session_id: str = ""


class FileListResponse(BaseModel):
    """文件列表响应"""

    status: str = "success"
    files: list[FileItem] = []
    total: int = 0


class UploadResponse(BaseModel):
    """上传响应"""

    status: str = "success"
    filename: str = ""
    session_id: str = ""
    relative_path: str = ""
    size: int = 0


class DeleteResponse(BaseModel):
    """删除响应"""

    status: str = "success"
    message: str = ""


# ==========================================
# 辅助函数
# ==========================================


def _ensure_workspace_root():
    """确保工作区根目录存在"""
    WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)


def _scan_workspace_files(session_id_filter: str | None = None) -> list[FileItem]:
    """
    扫描工作区文件。如果提供了 session_id_filter，则只返回该 session 下的文件。
    否则返回所有 session 目录下的扁平化文件列表。
    """
    _ensure_workspace_root()
    files: list[FileItem] = []

    # 确定要遍历的目录列表
    if session_id_filter and session_id_filter.strip():
        session_path = WORKSPACE_ROOT / session_id_filter
        if not session_path.exists():
            return []
        target_dirs = [session_path]
    else:
        # 如果不提供 session_id，则返回空列表（保证隔离性）
        # 或者如果你想支持“全局”视角，可以放开这里的注释。
        # 但根据用户要求“仅仅显示当前会话”，这里应该默认为空。
        return []

    # 需要过滤的目录名和文件扩展名
    # 不再过滤 "scripts"，因为用户可能在其中生成报告
    EXCLUDED_DIRS = {"__pycache__"}
    EXCLUDED_EXTS = {".py", ".pyc", ".log", ".tmp"}

    logger.debug(f"Scanning target_dirs: {target_dirs}")
    for session_dir in target_dirs:
        if not session_dir.is_dir():
            continue
        session_id = session_dir.name
        logger.debug(f"Processing session: {session_id}")
        # 递归遍历 session 内的所有文件
        for item in session_dir.rglob("*"):
            # 过滤排除目录
            if any(part in EXCLUDED_DIRS for part in item.parts):
                continue

            if item.is_file():
                # 过滤排除后缀名和隐藏文件
                if item.suffix.lower() in EXCLUDED_EXTS or item.name.startswith("."):
                    continue

                stat = item.stat()
                rel_path = str(item.relative_to(WORKSPACE_ROOT))
                modified_dt = datetime.fromtimestamp(
                    stat.st_mtime, tz=timezone.utc
                ).isoformat()
                files.append(
                    FileItem(
                        name=item.name,
                        type="file",
                        size=stat.st_size,
                        modified_at=modified_dt,
                        relative_path=rel_path.replace("\\", "/"),
                        session_id=session_id,
                    )
                )

    return files


def _safe_resolve_path(relative_path: str) -> Path:
    """
    安全解析相对路径，防止目录遍历攻击。
    返回 workspace 内的绝对路径。
    """
    cleaned = os.path.normpath(relative_path)
    if os.path.isabs(cleaned):
        raise HTTPException(status_code=400, detail="不允许使用绝对路径")

    resolved = (WORKSPACE_ROOT / cleaned).resolve()
    workspace_resolved = WORKSPACE_ROOT.resolve()

    try:
        resolved.relative_to(workspace_resolved)
    except ValueError:
        raise HTTPException(
            status_code=403, detail="路径逃逸：禁止访问工作区之外的文件"
        )

    return resolved


def _request_user_id(request: Request | None) -> str:
    user = getattr(getattr(request, "state", None), "current_user", None)
    if user is not None:
        return str(user.id)
    return ensure_local_user().id


def _ensure_owned_session(user_id: str, session_id: str) -> None:
    if not session_id:
        return
    if chat_store.get_session(user_id, session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")


def _session_from_relative_path(relative_path: str) -> str:
    cleaned = os.path.normpath(relative_path)
    first = Path(cleaned).parts[0] if Path(cleaned).parts else ""
    return "" if first in {"", ".", ".."} else first


def _media_type_for_path(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".html", ".htm"}:
        return "text/html; charset=utf-8"
    if suffix == ".pdf":
        return "application/pdf"
    if suffix == ".csv":
        return "text/csv; charset=utf-8"
    if suffix == ".txt":
        return "text/plain; charset=utf-8"
    if suffix == ".json":
        return "application/json"
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


# ==========================================
# API 端点
# ==========================================


@router.get("/files", response_model=FileListResponse)
async def list_workspace_files(request: Request = None, session_id: str | None = None):
    """
    获取工作区内文件的列表。
    如果提供 session_id，则只列出该会话的文件。
    """
    try:
        if session_id:
            _ensure_owned_session(_request_user_id(request), session_id)
        files = _scan_workspace_files(session_id)
        return FileListResponse(
            status="success",
            files=files,
            total=len(files),
        )
    except Exception as e:
        logger.error(f"列出工作区文件失败: {e}")
        raise HTTPException(status_code=500, detail=f"列出工作区文件失败: {str(e)}")


@router.get("/files/download")
async def download_workspace_file(path: str, request: Request = None):
    """
    下载工作区中的指定文件。
    参数 path 为相对于 workspace 根目录的路径，例如 '20260305_120222/data/result.csv'
    """
    _ensure_owned_session(_request_user_id(request), _session_from_relative_path(path))
    resolved = _safe_resolve_path(path)

    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"文件不存在: {path}")
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail=f"不是文件: {path}")

    return FileResponse(
        path=str(resolved),
        filename=resolved.name,
        media_type=_media_type_for_path(resolved),
    )


@router.get("/files/preview")
async def preview_workspace_file(path: str, request: Request = None):
    """
    内联预览工作区文件。
    与 download 接口不同，这里不设置 attachment 文件名，供 iframe/img 等预览入口使用。
    """
    _ensure_owned_session(_request_user_id(request), _session_from_relative_path(path))
    resolved = _safe_resolve_path(path)

    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"文件不存在: {path}")
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail=f"不是文件: {path}")

    return FileResponse(
        path=str(resolved),
        media_type=_media_type_for_path(resolved),
        headers={"Content-Disposition": "inline"},
    )


@router.post("/upload", response_model=UploadResponse)
async def upload_workspace_file(
    request: Request,
    file: UploadFile = File(...),
    session_id: str = "",
):
    """
    上传文件到工作区。
    - 如果 session_id 为空，则创建一个以 'upload_' 前缀 + 时间戳命名的目录。
    - 文件名前追加时间戳防止重名。
    """
    _ensure_workspace_root()

    # 确定目标 session 目录
    if not session_id:
        session_id = f"upload_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    user_id = _request_user_id(request)
    chat_store.ensure_session(user_id, session_id)

    target_dir = WORKSPACE_ROOT / session_id / "data"
    target_dir.mkdir(parents=True, exist_ok=True)

    # 防重名：时间戳前缀
    original_name = file.filename or "unnamed"
    # 清洗文件名，移除危险字符
    safe_name = "".join(
        c for c in original_name if c.isalnum() or c in (".", "_", "-", " ")
    ).strip()
    if not safe_name:
        safe_name = "unnamed"
    timestamped_name = f"{int(time.time())}_{safe_name}"

    target_path = target_dir / timestamped_name

    # 写入文件
    try:
        content = await file.read()
        if len(content) > MAX_UPLOAD_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"文件大小超过限制：{len(content)} 字节，最大允许 {MAX_UPLOAD_SIZE} 字节（100MB）",
            )
        target_path.write_bytes(content)
        logger.info(
            f"[Workspace Upload] 文件已保存: {target_path} ({len(content)} bytes)"
        )

        rel_path = str(target_path.relative_to(WORKSPACE_ROOT)).replace("\\", "/")

        return UploadResponse(
            status="success",
            filename=timestamped_name,
            session_id=session_id,
            relative_path=rel_path,
            size=len(content),
        )
    except Exception as e:
        logger.error(f"上传文件失败: {e}")
        raise HTTPException(status_code=500, detail=f"上传文件失败: {str(e)}")


@router.delete("/files")
async def delete_workspace_file(path: str, request: Request = None):
    """
    删除工作区中的指定文件。
    参数 path 为相对于 workspace 根目录的路径。
    """
    _ensure_owned_session(_request_user_id(request), _session_from_relative_path(path))
    resolved = _safe_resolve_path(path)

    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"文件不存在: {path}")
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail=f"不是文件: {path}")

    try:
        resolved.unlink()
        logger.info(f"[Workspace] 已删除文件: {path}")
        return DeleteResponse(
            status="success",
            message=f"文件 {path} 已删除",
        )
    except Exception as e:
        logger.error(f"删除文件失败: {e}")
        raise HTTPException(status_code=500, detail=f"删除文件失败: {str(e)}")
