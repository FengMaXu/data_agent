"""
开放生态栈模块 (Ecosystem)
提供泛用型 MCP 客户端总线和 HTTP API Hooks，
使 Agent 能够动态接入外部知识库、API 和 MCP 服务。
"""

from src.ecosystem.mcp_registry import MCPRegistry
from src.ecosystem.http_hooks import HttpHookRegistry, create_http_tools

__all__ = [
    "MCPRegistry",
    "HttpHookRegistry",
    "create_http_tools",
]
