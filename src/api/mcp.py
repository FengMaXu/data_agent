from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.config_manager import config_manager
from src.mcp.config_models import MCPTransportType

logger = logging.getLogger("data_agent.api.mcp")
router = APIRouter(prefix="/mcp", tags=["mcp"])


class MCPServerRequest(BaseModel):
    name: str
    transport: str = MCPTransportType.STDIO.value
    enabled: bool = True
    command: str = "python"
    script: str = ""
    url: str = ""
    headers: dict[str, str] = Field(default_factory=dict)
    env: dict[str, str] = Field(default_factory=dict)
    description: str = ""
    tool_prefix: str = ""
    server_type: str = "service"
    tags: list[str] = Field(default_factory=list)


class MCPConfigRequest(BaseModel):
    servers: list[MCPServerRequest] = Field(default_factory=list)


class MCPEnabledUpdateRequest(BaseModel):
    enabled: bool


@router.get("/config")
async def get_mcp_config() -> dict[str, Any]:
    return config_manager.serialize_mcp_settings()


@router.post("/config")
async def save_mcp_config(req: MCPConfigRequest) -> dict[str, Any]:
    data = req.model_dump()
    saved = await config_manager.save_mcp_settings(data)
    return {"status": "success", "config": saved}


@router.get("/servers")
async def list_mcp_servers() -> dict[str, Any]:
    servers = await config_manager.list_mcp_servers()
    return {"status": "success", "servers": servers}


@router.patch("/servers/{server_name}/enabled")
async def update_mcp_server_enabled(server_name: str, req: MCPEnabledUpdateRequest) -> dict[str, Any]:
    try:
        server = await config_manager.set_mcp_server_enabled(server_name, req.enabled)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"MCP server not found: {server_name}") from exc
    return {"status": "success", "server": server}


@router.post("/servers/{server_name}/restart")
async def restart_mcp_server(server_name: str) -> dict[str, Any]:
    try:
        server = await config_manager.restart_mcp_server(server_name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"MCP server not found: {server_name}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "success", "server": server}


@router.get("/tools")
async def list_mcp_tools() -> dict[str, Any]:
    tools = await config_manager.list_mcp_tools()
    return {"status": "success", "tools": tools}


@router.post("/test")
async def test_mcp_server(req: MCPServerRequest) -> dict[str, Any]:
    result = await config_manager.test_mcp_server(req.model_dump())
    return result
