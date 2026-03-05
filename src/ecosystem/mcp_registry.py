"""
泛用型 MCP 客户端总线 (Universal MCP Gateway)

允许系统动态注册和连接多个外部 MCP Server，
将每个 MCP Server 暴露的工具自动桥接为 Agent 可用的 AgentTool。

典型用法：
  registry = MCPRegistry()
  registry.register("knowledge_base", command="python", script="kb_mcp_server.py")
  registry.register("web_search", command="npx", script="web-search-mcp")

  async with registry.connect_all() as tools:
      # tools 是一个 list[AgentTool]，可直接加入 AgentContext
      context.tools.extend(tools)
"""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent

logger = logging.getLogger("data_agent.ecosystem.mcp_registry")


@dataclass
class MCPServerConfig:
    """外部 MCP Server 的注册配置"""

    name: str  # 逻辑名称（如 "knowledge_base"）
    command: str  # 启动命令（如 "python", "npx"）
    script: str  # 脚本路径或包名
    env: dict[str, str] = field(default_factory=dict)  # 额外环境变量
    description: str = ""  # 该 MCP 服务的用途描述
    tool_prefix: str = ""  # 工具名前缀（避免冲突）


class MCPRegistry:
    """
    Universal MCP 注册表

    管理多个外部 MCP Server 的生命周期和工具桥接。
    """

    def __init__(self):
        self._servers: dict[str, MCPServerConfig] = {}

    def register(
        self,
        name: str,
        command: str,
        script: str,
        env: dict[str, str] | None = None,
        description: str = "",
        tool_prefix: str = "",
    ) -> None:
        """注册一个外部 MCP Server"""
        config = MCPServerConfig(
            name=name,
            command=command,
            script=script,
            env=env or {},
            description=description,
            tool_prefix=tool_prefix or f"{name}_",
        )
        self._servers[name] = config
        logger.info(f"[MCPRegistry] 已注册 MCP Server: {name} ({command} {script})")

    def unregister(self, name: str) -> None:
        """移除一个已注册的 MCP Server"""
        if name in self._servers:
            del self._servers[name]
            logger.info(f"[MCPRegistry] 已移除 MCP Server: {name}")

    def list_registered(self) -> list[dict[str, str]]:
        """列出所有注册的 MCP Server"""
        return [
            {
                "name": cfg.name,
                "command": cfg.command,
                "script": cfg.script,
                "description": cfg.description,
            }
            for cfg in self._servers.values()
        ]

    @asynccontextmanager
    async def connect_all(self) -> AsyncIterator[list[AgentTool]]:
        """
        连接所有注册的 MCP Server，并将它们的工具桥接为 AgentTool 列表。

        使用方式：
            async with registry.connect_all() as tools:
                context.tools.extend(tools)
        """
        from src.mcp.mcp_client import MCPClient

        all_tools: list[AgentTool] = []
        clients: list[Any] = []
        context_managers = []

        try:
            for name, config in self._servers.items():
                logger.info(f"[MCPRegistry] 连接 MCP Server: {name}")
                try:
                    # 创建 MCP 客户端上下文
                    cm = MCPClient.connect(
                        command=config.command,
                        script=config.script,
                        env=config.env or None,
                    )
                    client = await cm.__aenter__()
                    context_managers.append(cm)
                    clients.append((name, config, client))

                    # 获取该 MCP Server 的工具列表
                    remote_tools = await client.list_tools()
                    for rt in remote_tools:
                        tool = self._bridge_tool(name, config, client, rt)
                        all_tools.append(tool)

                    logger.info(
                        f"[MCPRegistry] {name}: 已桥接 {len(remote_tools)} 个工具"
                    )
                except Exception as e:
                    logger.error(f"[MCPRegistry] 连接 {name} 失败: {e}")

            yield all_tools
        finally:
            # 清理所有连接
            for cm in context_managers:
                try:
                    await cm.__aexit__(None, None, None)
                except Exception:
                    pass

    @asynccontextmanager
    async def connect_one(self, name: str) -> AsyncIterator[list[AgentTool]]:
        """连接单个已注册的 MCP Server"""
        if name not in self._servers:
            raise ValueError(f"MCP Server '{name}' 未注册")

        from src.mcp.mcp_client import MCPClient

        config = self._servers[name]
        async with MCPClient.connect(
            command=config.command,
            script=config.script,
            env=config.env or None,
        ) as client:
            remote_tools = await client.list_tools()
            tools = [self._bridge_tool(name, config, client, rt) for rt in remote_tools]
            yield tools

    def _bridge_tool(
        self,
        server_name: str,
        config: MCPServerConfig,
        client: Any,
        remote_tool: dict,
    ) -> AgentTool:
        """将远程 MCP 工具桥接为本地 AgentTool"""
        original_name = remote_tool["name"]
        prefixed_name = f"{config.tool_prefix}{original_name}"
        description = remote_tool.get("description", "")
        parameters = remote_tool.get("parameters", {"type": "object", "properties": {}})

        async def _execute(tool_call_id: str, arguments: dict) -> AgentToolResult:
            try:
                result_text = await client.call_tool(original_name, arguments)
                return AgentToolResult(
                    content=[ToolResultContent(type="text", text=result_text)]
                )
            except Exception as e:
                return AgentToolResult(
                    content=[
                        ToolResultContent(
                            type="text",
                            text=f"[{server_name}] 调用 {original_name} 失败: {e}",
                        )
                    ],
                    is_error=True,
                )

        return AgentTool(
            name=prefixed_name,
            label=f"[{server_name}] {original_name}",
            description=f"[来源: {server_name}] {description}",
            parameters=parameters,
            execute_fn=_execute,
        )
