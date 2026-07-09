"""
工作区文件 I/O 工具
为 Agent 提供 read_file, write_file, list_workspace 三大基础工具。
灵感来源于 pi-mono/packages/coding-agent 的基础工具集。
"""

from __future__ import annotations

import asyncio
import json
import logging

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent
from src.workspace.workspace_manager import WorkspaceManager

logger = logging.getLogger("data_agent.workspace.file_tools")


def create_file_tools(workspace: WorkspaceManager) -> list[AgentTool]:
    """创建工作区文件操作工具集"""

    async def _list_workspace(tool_call_id: str, arguments: dict) -> AgentToolResult:
        """列出工作区文件"""
        sub_dir = arguments.get("path", "")
        try:
            files = await asyncio.to_thread(workspace.list_files, sub_dir)
            result = {
                "status": "success",
                "workspace_session": str(workspace.session_dir),
                "files": files,
                "total": len(files),
            }
            return AgentToolResult(
                content=[
                    ToolResultContent(
                        type="text",
                        text=json.dumps(result, ensure_ascii=False, indent=2),
                    )
                ]
            )
        except Exception as e:
            return AgentToolResult(
                content=[ToolResultContent(type="text", text=f"列出文件失败: {e}")],
                is_error=True,
            )

    async def _read_file(tool_call_id: str, arguments: dict) -> AgentToolResult:
        """读取工作区文件"""
        path = arguments.get("path", "")
        if not path:
            return AgentToolResult(
                content=[
                    ToolResultContent(type="text", text="错误: 必须指定 path 参数")
                ],
                is_error=True,
            )
        try:
            content = await asyncio.to_thread(workspace.read_file, path)
            return AgentToolResult(
                content=[ToolResultContent(type="text", text=content)]
            )
        except (FileNotFoundError, ValueError) as e:
            return AgentToolResult(
                content=[ToolResultContent(type="text", text=f"读取失败: {e}")],
                is_error=True,
            )

    async def _write_file(tool_call_id: str, arguments: dict) -> AgentToolResult:
        """写入文件到工作区"""
        path = arguments.get("path", "")
        content = arguments.get("content", "")
        if not path and "_raw" in arguments:
            import json as _json

            raw = arguments["_raw"]
            try:
                inner = _json.loads(raw) if isinstance(raw, str) else raw
                if isinstance(inner, dict):
                    path = path or inner.get("path", "")
                    content = content or inner.get("content", "")
            except (ValueError, TypeError):
                pass
        if not path:
            return AgentToolResult(
                content=[
                    ToolResultContent(type="text", text="错误: 必须指定 path 参数")
                ],
                is_error=True,
            )
        try:
            saved_path = workspace.write_file(path, content)
            return AgentToolResult(
                content=[
                    ToolResultContent(
                        type="text",
                        text=f"文件已保存到工作区: {saved_path} ({len(content)} 字符)",
                    )
                ]
            )
        except ValueError as e:
            return AgentToolResult(
                content=[ToolResultContent(type="text", text=f"写入失败: {e}")],
                is_error=True,
            )

    return [
        AgentTool(
            name="list_workspace",
            label="浏览工作区",
            description=(
                "列出工作区目录中的文件和子目录。"
                "工作区用于保存查询结果、Python 脚本和图表输出。"
                "可选参数 path 指定子目录（如 'data', 'scripts', 'output'）。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "要浏览的子目录路径（相对于工作区根），留空浏览根目录",
                    }
                },
                "required": [],
            },
            execute_fn=_list_workspace,
            read_only=True,
            resource="workspace_fs",
            max_concurrency=8,
        ),
        AgentTool(
            name="read_workspace_file",
            label="读取工作区文件",
            description=(
                "读取工作区中的文件内容。"
                "支持文本文件（CSV, JSON, Python脚本等）。"
                "超大文件将自动截断。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "文件的相对路径（如 'data/result.csv'）",
                    }
                },
                "required": ["path"],
            },
            execute_fn=_read_file,
            read_only=True,
            resource="workspace_fs",
            max_concurrency=8,
        ),
        AgentTool(
            name="write_workspace_file",
            label="写入工作区文件",
            description=(
                "将内容写入工作区文件。"
                "用于保存查询结果(CSV/JSON)、Python 分析脚本或其他文本。"
                "会自动创建中间目录。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "文件的相对路径（如 'data/sales.csv'）",
                    },
                    "content": {
                        "type": "string",
                        "description": "要写入的文件内容",
                    },
                },
                "required": ["path", "content"],
            },
            execute_fn=_write_file,
            read_only=False,
            resource="workspace_fs",
            max_concurrency=1,
        ),
    ]
