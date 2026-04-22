"""
工作区管理器
管理 Agent 的隔离工作区文件系统。所有中间结果和最终产物都保存在此工作区中。
"""

from __future__ import annotations

import csv
import json
import logging
import os
import shutil
from datetime import datetime
from pathlib import Path

logger = logging.getLogger("data_agent.workspace")

# 默认工作区根目录
DEFAULT_WORKSPACE_ROOT = os.path.join(os.getcwd(), "workspace")


def _normalize_csv_value(value: object) -> object:
    if value is None:
        return ""
    if isinstance(value, (str, int, float, bool)):
        return value
    return json.dumps(value, ensure_ascii=False)


class WorkspaceManager:
    """
    隔离沙箱文件系统管理器

    为每个会话创建一个隔离的工作目录，Agent 可以在其中：
    - 保存 SQL 查询结果 (CSV/JSON)
    - 编写和执行 Python 分析脚本
    - 保存生成的图表文件
    """

    def __init__(self, root_dir: str | None = None, session_id: str | None = None):
        self._root = Path(root_dir or DEFAULT_WORKSPACE_ROOT).resolve()
        self._session_id = session_id or datetime.now().strftime("%Y%m%d_%H%M%S")
        self._session_dir = (self._root / self._session_id).resolve()
        self._ensure_dirs()

    def _ensure_dirs(self) -> None:
        """创建工作区目录结构"""
        (self._session_dir / "data").mkdir(parents=True, exist_ok=True)
        (self._session_dir / "scripts").mkdir(parents=True, exist_ok=True)
        (self._session_dir / "output").mkdir(parents=True, exist_ok=True)
        logger.info(f"[Workspace] 工作区已就绪: {self._session_dir}")

    @property
    def session_dir(self) -> Path:
        return self._session_dir

    @property
    def data_dir(self) -> Path:
        return self._session_dir / "data"

    @property
    def scripts_dir(self) -> Path:
        return self._session_dir / "scripts"

    @property
    def output_dir(self) -> Path:
        return self._session_dir / "output"

    def resolve_path(self, relative_path: str) -> Path:
        """
        将相对路径解析为工作区内的绝对路径。
        安全限制：禁止路径逃逸到工作区之外。
        """
        cleaned = os.path.normpath(relative_path)
        if os.path.isabs(cleaned):
            raise ValueError(f"路径逃逸检测！'{relative_path}' 不允许使用绝对路径。")

        resolved = (self._session_dir / cleaned).resolve()
        session_resolved = self._session_dir.resolve()

        try:
            resolved.relative_to(session_resolved)
        except ValueError as exc:
            raise ValueError(
                f"路径逃逸检测！'{relative_path}' 试图访问工作区之外的目录。"
            ) from exc
        return resolved

    def list_files(self, sub_dir: str = "") -> list[dict[str, str | int]]:
        """列出工作区中的文件"""
        target = self.resolve_path(sub_dir) if sub_dir else self._session_dir
        if not target.exists():
            return []

        results = []
        for item in sorted(target.iterdir()):
            entry = {
                "name": item.name,
                "type": "directory" if item.is_dir() else "file",
                "relative_path": item.relative_to(self._session_dir).as_posix(),
            }
            if item.is_file():
                entry["size_bytes"] = item.stat().st_size
            results.append(entry)
        return results

    def read_file(self, relative_path: str, max_bytes: int = 500_000) -> str:
        """读取工作区中的文件内容"""
        path = self.resolve_path(relative_path)
        if not path.exists():
            raise FileNotFoundError(f"文件不存在: {relative_path}")
        if not path.is_file():
            raise ValueError(f"不是文件: {relative_path}")

        size = path.stat().st_size
        if size > max_bytes:
            with open(path, "r", encoding="utf-8", errors="replace") as handle:
                content = handle.read(max_bytes)
            return (
                content
                + f"\n\n... [文件过大，仅显示前 {max_bytes} 字节，总大小 {size} 字节]"
            )
        return path.read_text(encoding="utf-8", errors="replace")

    def write_file(self, relative_path: str, content: str) -> str:
        """写入文件到工作区"""
        path = self.resolve_path(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        logger.info(f"[Workspace] 已写入 {relative_path} ({len(content)} 字符)")
        return path.relative_to(self._session_dir).as_posix()

    def write_csv_rows(self, relative_path: str, rows: list[dict[str, object]]) -> str:
        """将结构化结果写入 CSV，使用 UTF-8 BOM 便于 Excel 打开。"""
        path = self.resolve_path(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        fieldnames: list[str] = []
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError("CSV row must be a dict")
            for key in row.keys():
                key_text = str(key)
                if key_text not in fieldnames:
                    fieldnames.append(key_text)

        with path.open("w", encoding="utf-8-sig", newline="") as handle:
            if fieldnames:
                writer = csv.DictWriter(handle, fieldnames=fieldnames)
                writer.writeheader()
                for row in rows:
                    writer.writerow(
                        {
                            name: _normalize_csv_value(row.get(name, ""))
                            for name in fieldnames
                        }
                    )

        logger.info(f"[Workspace] 已写入 {relative_path} ({len(rows)} 行 CSV)")
        return path.relative_to(self._session_dir).as_posix()

    def cleanup(self) -> None:
        """清理当前会话的工作区"""
        if self._session_dir.exists():
            shutil.rmtree(self._session_dir)
            logger.info(f"[Workspace] 已清理工作区: {self._session_dir}")

