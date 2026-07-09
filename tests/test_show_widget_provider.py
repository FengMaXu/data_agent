import pytest

from src.agent.tool_providers.show_widget import create_show_widget_tool


@pytest.mark.asyncio
async def test_show_widget_schema_does_not_expose_file_link():
    tool = create_show_widget_tool()

    kind_enum = tool.parameters["properties"]["kind"]["enum"]
    assert "file_link" not in kind_enum
    assert "file_path" not in tool.parameters["properties"]
    assert "download_url" not in tool.parameters["properties"]
    assert "file_type" not in tool.parameters["properties"]


@pytest.mark.asyncio
async def test_show_widget_rejects_file_link_kind():
    tool = create_show_widget_tool()

    result = await tool.execute(
        "call-file",
        {
            "kind": "file_link",
            "title": "Download",
            "download_url": "/workspace/files/download?path=x.html",
        },
    )

    assert result.is_error is True
    assert "file_link" not in tool.parameters["properties"]["kind"]["enum"]
