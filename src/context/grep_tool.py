"""
上下文文档 Grep 工具

在 context/doc/ 目录中搜索关键词，用于按需查找业务规则、表结构、SQL模板和历史经验。
"""

from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import Any

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent

logger = logging.getLogger("data_agent.context.grep_tool")

CONTEXT_DIR = Path("context")


def _grep_context_file(
    filename: str,
    query: str,
    context_lines: int,
) -> list[str]:
    filepath = CONTEXT_DIR / "doc" / filename
    if not filepath.exists():
        logger.warning(f"[grep_context] 文件不存在: {filepath}")
        return []

    results: list[str] = []
    try:
        content = filepath.read_text(encoding="utf-8")
        lines = content.split("\n")

        for i, line in enumerate(lines):
            try:
                if re.search(query, line, re.IGNORECASE):
                    start = max(0, i - context_lines)
                    end = min(len(lines), i + context_lines + 1)
                    context = lines[start:end]

                    formatted_context = []
                    for line_num, ctx_line in enumerate(context, start=start + 1):
                        marker = " >>> " if line_num == i + 1 else "     "
                        formatted_context.append(f"{marker}{line_num:4d} | {ctx_line}")

                    results.append(f"""
## {filename} (第 {i+1} 行)
```
{chr(10).join(formatted_context)}
```
""")
            except re.error:
                continue
    except Exception as e:
        logger.error(f"[grep_context] 读取文件失败 {filepath}: {e}")
    return results


async def grep_context(tool_call_id: str, arguments: dict) -> AgentToolResult:
    """
    在上下文文档中搜索关键词

    参数:
        query: 搜索关键词或正则表达式
        files: 要搜索的文件列表（默认搜索所有 .md 文件）
        context_lines: 匹配行前后的上下文行数（默认 3）
    """
    query = arguments.get("query", "")
    files = arguments.get("files", [])
    context_lines = arguments.get("context_lines", 3)

    if not query:
        return AgentToolResult(
            content=[ToolResultContent(text="错误: 必须提供 query 参数")],
            is_error=True,
        )

    # 默认搜索所有上下文文档
    if not files:
        files = ["rules.md", "db_schema.md", "business.md", "query_patterns.md", "learning.md"]

    batches = await asyncio.gather(
        *[
            asyncio.to_thread(_grep_context_file, filename, query, context_lines)
            for filename in files
        ]
    )
    results = [result for batch in batches for result in batch]

    if results:
        return AgentToolResult(
            content=[ToolResultContent(text="\n".join(results))]
        )
    else:
        return AgentToolResult(
            content=[ToolResultContent(text=f"未找到匹配 '{query}' 的内容")]
        )


def create_grep_tool() -> AgentTool:
    """创建上下文 grep 工具"""
    return AgentTool(
        name="grep_context",
        description=(
            "在上下文文档中搜索关键词。\n"
            "用于查找表结构、业务规则、SQL模板或历史经验。\n"
            "支持的文档: rules.md, db_schema.md, business.md, query_patterns.md, learning.md"
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索关键词或正则表达式",
                },
                "files": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "要搜索的文件名列表（可选，默认搜索所有文档）",
                },
                "context_lines": {
                    "type": "integer",
                    "description": "上下文行数（可选，默认3）",
                },
            },
            "required": ["query"],
        },
        execute_fn=grep_context,
        label="搜索上下文文档",
        read_only=True,
        resource="context_fs",
        max_concurrency=8,
    )
