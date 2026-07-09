"""
HTTP API Hooks
为不支持 MCP 协议的外部 REST API 提供快速挂载机制，
使其也能以 AgentTool 形式被大模型调用。

典型用法：
  registry = HttpHookRegistry()
  registry.register(
      name="get_weather",
      url="https://api.weather.com/v1/current",
      method="GET",
      description="查询当前天气",
      query_params={"key": "API_KEY"},
      param_schema={
          "location": {"type": "string", "description": "城市名称"}
      },
  )
  tools = create_http_tools(registry)
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any

from src.agent.types import AgentTool, AgentToolResult
from src.ai.base_provider import ToolResultContent

logger = logging.getLogger("data_agent.ecosystem.http_hooks")


@dataclass
class HttpHookConfig:
    """HTTP API Hook 配置"""

    name: str  # 工具名
    url: str  # API 端点 URL
    method: str = "GET"  # HTTP 方法
    description: str = ""  # 功能描述
    headers: dict[str, str] = field(default_factory=dict)  # 静态请求头
    query_params: dict[str, str] = field(default_factory=dict)  # 静态查询参数
    param_schema: dict[str, Any] = field(
        default_factory=dict
    )  # LLM 可填的动态参数 JSON Schema
    response_jmespath: str = ""  # 可选的 JMESPath 表达式提取响应摘要
    timeout: int = 30  # 请求超时


class HttpHookRegistry:
    """HTTP API 注册表"""

    def __init__(self):
        self._hooks: dict[str, HttpHookConfig] = {}

    def register(
        self,
        name: str,
        url: str,
        method: str = "GET",
        description: str = "",
        headers: dict[str, str] | None = None,
        query_params: dict[str, str] | None = None,
        param_schema: dict[str, Any] | None = None,
        timeout: int = 30,
    ) -> None:
        """注册一个外部 HTTP API"""
        self._hooks[name] = HttpHookConfig(
            name=name,
            url=url,
            method=method.upper(),
            description=description,
            headers=headers or {},
            query_params=query_params or {},
            param_schema=param_schema or {},
            timeout=timeout,
        )
        logger.info(f"[HttpHooks] 已注册 API: {name} -> {method} {url}")

    def unregister(self, name: str) -> None:
        if name in self._hooks:
            del self._hooks[name]

    def list_registered(self) -> list[dict[str, str]]:
        return [
            {
                "name": h.name,
                "url": h.url,
                "method": h.method,
                "description": h.description,
            }
            for h in self._hooks.values()
        ]


def create_http_tools(registry: HttpHookRegistry) -> list[AgentTool]:
    """将注册的 HTTP API 批量转换为 AgentTool"""

    tools = []
    for name, config in registry._hooks.items():
        tool = _make_http_tool(config)
        tools.append(tool)
    return tools


def _make_http_tool(config: HttpHookConfig) -> AgentTool:
    """为单个 HTTP API 创建 AgentTool"""

    # 构造 JSON Schema
    properties = {}
    required = []
    for param_name, param_def in config.param_schema.items():
        if isinstance(param_def, dict):
            properties[param_name] = param_def
        else:
            properties[param_name] = {"type": "string", "description": str(param_def)}
        required.append(param_name)

    schema = {
        "type": "object",
        "properties": properties,
        "required": required,
    }

    def _execute_blocking(arguments: dict) -> AgentToolResult:
        try:
            import urllib.request
            import urllib.parse
            import urllib.error

            # 构造请求
            url = config.url
            headers = dict(config.headers)

            if config.method == "GET":
                # 合并静态参数和 LLM 动态参数
                all_params = {**config.query_params, **arguments}
                if all_params:
                    qs = urllib.parse.urlencode(all_params)
                    url = f"{url}?{qs}" if "?" not in url else f"{url}&{qs}"
                req = urllib.request.Request(url, headers=headers, method="GET")
            else:
                # POST: 将 arguments 当作 JSON body
                body = json.dumps({**config.query_params, **arguments}).encode("utf-8")
                headers["Content-Type"] = "application/json"
                req = urllib.request.Request(
                    url, data=body, headers=headers, method=config.method
                )

            # 发送请求
            with urllib.request.urlopen(req, timeout=config.timeout) as resp:
                response_text = resp.read().decode("utf-8", errors="replace")

            # 截断过长的响应
            if len(response_text) > 10000:
                response_text = response_text[:10000] + "\n... [响应过长，已截断]"

            return AgentToolResult(
                content=[ToolResultContent(type="text", text=response_text)]
            )

        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")[:2000]
            return AgentToolResult(
                content=[
                    ToolResultContent(
                        type="text",
                        text=f"HTTP {e.code} 错误: {error_body}",
                    )
                ],
                is_error=True,
            )
        except Exception as e:
            return AgentToolResult(
                content=[
                    ToolResultContent(
                        type="text",
                        text=f"HTTP 请求失败: {str(e)}",
                    )
                ],
                is_error=True,
            )

    async def _execute(tool_call_id: str, arguments: dict) -> AgentToolResult:
        return await asyncio.to_thread(_execute_blocking, arguments)

    return AgentTool(
        name=f"api_{config.name}",
        label=f"[API] {config.name}",
        description=f"[外部API] {config.description}\n端点: {config.method} {config.url}",
        parameters=schema,
        execute_fn=_execute,
        read_only=config.method.upper() in {"GET", "HEAD", "OPTIONS"},
        resource="network",
        max_concurrency=4,
    )
