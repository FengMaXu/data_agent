"""
Knowledge 文件管理 API
提供知识库文件的列表、读取、保存功能。
"""

import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("data_agent.api.knowledge")

# Knowledge 根目录
def _get_default_knowledge_root() -> Path:
    """Resolve the knowledge directory for both source and packaged runtimes."""
    configured_root = os.getenv("DATA_AGENT_KNOWLEDGE_ROOT")
    if configured_root:
        return Path(configured_root).expanduser().resolve()

    bundled_root = Path(getattr(sys, "_MEIPASS", "")) / "knowledge"
    if bundled_root.exists():
        return bundled_root.resolve()

    project_root = Path(__file__).resolve().parents[2]
    source_root = project_root / "knowledge"
    if source_root.exists():
        return source_root.resolve()

    return (Path.cwd() / "knowledge").resolve()


KNOWLEDGE_ROOT = _get_default_knowledge_root()

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


# ==========================================
# 响应模型
# ==========================================


class KnowledgeFile(BaseModel):
    """知识库文件元数据"""

    name: str
    path: str  # 相对于 knowledge 根目录的路径
    size: int
    modified_at: str
    type: str  # "file" | "directory"


class KnowledgeListResponse(BaseModel):
    """知识库文件列表响应"""

    status: str = "success"
    files: list[KnowledgeFile] = []
    total: int = 0


class KnowledgeContentResponse(BaseModel):
    """知识库文件内容响应"""

    status: str = "success"
    content: str
    path: str
    name: str


class SaveKnowledgeRequest(BaseModel):
    """保存知识库文件请求"""

    path: str  # 相对于 knowledge 根目录的路径
    content: str


class SaveKnowledgeResponse(BaseModel):
    """保存知识库文件响应"""

    status: str = "success"
    message: str = ""


# ==========================================
# 辅助函数
# ==========================================


def _ensure_knowledge_root():
    """确保知识库根目录存在"""
    KNOWLEDGE_ROOT.mkdir(parents=True, exist_ok=True)


def _safe_resolve_path(relative_path: str) -> Path:
    """
    安全解析相对路径，防止目录遍历攻击。
    返回 knowledge 内的绝对路径。
    """
    if not relative_path:
        raise HTTPException(status_code=400, detail="路径不能为空")

    cleaned = os.path.normpath(relative_path)
    if os.path.isabs(cleaned):
        raise HTTPException(status_code=400, detail="不允许使用绝对路径")

    resolved = (KNOWLEDGE_ROOT / cleaned).resolve()
    knowledge_resolved = KNOWLEDGE_ROOT.resolve()

    try:
        resolved.relative_to(knowledge_resolved)
    except ValueError:
        raise HTTPException(
            status_code=403, detail="路径逃逸：禁止访问知识库之外的文件"
        )

    return resolved


def _scan_knowledge_files() -> list[KnowledgeFile]:
    """
    扫描知识库目录下的所有文件和文件夹，
    返回扁平化的文件列表。
    """
    _ensure_knowledge_root()
    files: list[KnowledgeFile] = []

    def scan_directory(dir_path: Path, relative_path: str = ""):
        """递归扫描目录"""
        try:
            for item in sorted(dir_path.iterdir()):
                # 跳过隐藏文件和目录
                if item.name.startswith("."):
                    continue

                rel_path = f"{relative_path}/{item.name}" if relative_path else item.name

                if item.is_file():
                    stat = item.stat()
                    modified_dt = datetime.fromtimestamp(
                        stat.st_mtime, tz=timezone.utc
                    ).isoformat()
                    files.append(
                        KnowledgeFile(
                            name=item.name,
                            path=rel_path.replace("\\", "/"),
                            size=stat.st_size,
                            modified_at=modified_dt,
                            type="file",
                        )
                    )
                elif item.is_dir():
                    # 添加目录项
                    stat = item.stat()
                    modified_dt = datetime.fromtimestamp(
                        stat.st_mtime, tz=timezone.utc
                    ).isoformat()
                    files.append(
                        KnowledgeFile(
                            name=item.name,
                            path=rel_path.replace("\\", "/"),
                            size=0,
                            modified_at=modified_dt,
                            type="directory",
                        )
                    )
                    # 递归扫描子目录
                    scan_directory(item, rel_path)
        except PermissionError:
            logger.warning(f"无权限访问目录: {dir_path}")

    scan_directory(KNOWLEDGE_ROOT)
    return files


# ==========================================
# API 端点
# ==========================================


@router.get("/files", response_model=KnowledgeListResponse)
async def list_knowledge_files():
    """
    获取知识库内的所有文件和目录列表。
    返回扁平化的文件清单，包含子目录内容。
    """
    try:
        files = _scan_knowledge_files()
        return KnowledgeListResponse(
            status="success",
            files=files,
            total=len(files),
        )
    except Exception as e:
        logger.error(f"列出知识库文件失败: {e}")
        raise HTTPException(status_code=500, detail=f"列出知识库文件失败: {str(e)}")


@router.get("/content", response_model=KnowledgeContentResponse)
async def get_knowledge_content(path: str = ""):
    """
    获取知识库中指定文件的内容。
    参数 path 为相对于 knowledge 根目录的路径。
    """
    resolved = _safe_resolve_path(path)

    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"文件不存在: {path}")
    if not resolved.is_file():
        raise HTTPException(status_code=400, detail=f"不是文件: {path}")

    try:
        # 尝试以 UTF-8 编码读取
        content = resolved.read_text(encoding="utf-8")
        return KnowledgeContentResponse(
            status="success",
            content=content,
            path=path.replace("\\", "/"),
            name=resolved.name,
        )
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="文件编码不支持，仅支持 UTF-8 文本文件")
    except Exception as e:
        logger.error(f"读取知识库文件失败: {e}")
        raise HTTPException(status_code=500, detail=f"读取文件失败: {str(e)}")


@router.post("/save", response_model=SaveKnowledgeResponse)
async def save_knowledge_content(request: SaveKnowledgeRequest):
    """
    保存知识库文件内容。
    如果文件不存在则创建，存在则覆盖。
    """
    resolved = _safe_resolve_path(request.path)

    # 确保父目录存在
    resolved.parent.mkdir(parents=True, exist_ok=True)

    try:
        resolved.write_text(request.content, encoding="utf-8")
        logger.info(f"[Knowledge] 文件已保存: {request.path}")
        return SaveKnowledgeResponse(
            status="success",
            message=f"文件 {request.path} 已保存",
        )
    except Exception as e:
        logger.error(f"保存知识库文件失败: {e}")
        raise HTTPException(status_code=500, detail=f"保存文件失败: {str(e)}")
