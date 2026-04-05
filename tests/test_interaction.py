"""
阶段三功能单元测试
- SQL 沙盒评估器
- 文件型 skill 激活
- 主动澄清工具
"""

import json
import tempfile
from pathlib import Path

import pytest

from src.interaction.sql_evaluator import SQLEvaluator
from src.interaction.clarification import create_clarification_tool
from src.mcp.sql_guard import SQLGuard
from src.skills import SkillManager, activate_skill_by_name, create_skill_tools, parse_skill_command


class MockMCPClient:
    """模拟 MCP Client 进行测试"""

    def __init__(self, responses: dict[str, str] | None = None):
        self._responses = responses or {}
        self.calls: list[tuple[str, dict]] = []

    async def call_tool(self, name: str, arguments: dict) -> str:
        self.calls.append((name, arguments))
        key = f"{name}:{json.dumps(arguments, sort_keys=True)}"
        if key in self._responses:
            return self._responses[key]
        return json.dumps({"status": "success", "data": []})


class TestSQLEvaluator:
    @pytest.mark.asyncio
    async def test_guard_blocks_dangerous_sql(self):
        mock_mcp = MockMCPClient()
        evaluator = SQLEvaluator(mock_mcp, SQLGuard(strict=True))
        result = await evaluator.validate("DROP TABLE users")
        assert result.passed is False
        assert "安全拦截" in result.error_message

    @pytest.mark.asyncio
    async def test_select_goes_through_validation(self):
        mock_mcp = MockMCPClient()
        evaluator = SQLEvaluator(mock_mcp, SQLGuard(strict=True))
        result = await evaluator.validate("SELECT * FROM users WHERE id > 10")
        assert result.passed is True
        assert result.validation_method == "limit1"
        assert "LIMIT 1" in mock_mcp.calls[0][1]["query"]

    @pytest.mark.asyncio
    async def test_trusted_template_simple_select_skips_dry_run(self):
        mock_mcp = MockMCPClient()
        evaluator = SQLEvaluator(mock_mcp, SQLGuard(strict=True))
        result = await evaluator.validate(
            "SELECT company_name FROM dim_company LIMIT 5",
            trusted_template=True,
        )
        assert result.passed is True
        assert result.validation_method == "template_fast_path"
        assert mock_mcp.calls == []

    @pytest.mark.asyncio
    async def test_trusted_template_with_join_still_uses_limit_validation(self):
        mock_mcp = MockMCPClient()
        evaluator = SQLEvaluator(mock_mcp, SQLGuard(strict=True))
        result = await evaluator.validate(
            "SELECT * FROM a JOIN b ON a.id = b.id",
            trusted_template=True,
        )
        assert result.passed is True
        assert result.validation_method == "limit1"
        assert len(mock_mcp.calls) == 1

    @pytest.mark.asyncio
    async def test_validated_execute_tool_exposes_validation_details(self):
        mock_mcp = MockMCPClient()
        evaluator = SQLEvaluator(mock_mcp, SQLGuard(strict=True))
        tool = evaluator.create_validated_execute_tool()
        result = await tool.execute(
            "call-1",
            {
                "query": "SELECT company_name FROM dim_company LIMIT 5",
                "trusted_template": True,
            },
        )
        assert result.is_error is False
        assert result.details["validation_method"] == "template_fast_path"
        assert result.details["trusted_template"] is True
        assert len(mock_mcp.calls) == 1


class TestFileSkills:
    def _create_skill_dir(self) -> Path:
        base = Path(tempfile.mkdtemp())
        skill_dir = base / "demo-skill"
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "SKILL.md").write_text(
            "---\n"
            "name: demo-skill\n"
            "description: Demo skill\n"
            "when_to_use: When testing slash skill flow\n"
            "allowed-tools:\n"
            "  - run_python\n"
            "model: claude-sonnet\n"
            "---\n"
            "# Demo\n"
            "Use the workspace carefully.\n",
            encoding="utf-8",
        )
        return base

    def test_discover_and_catalog(self):
        root = self._create_skill_dir()
        manager = SkillManager([root])
        manager.discover_and_parse()
        assert manager.get_skill("demo-skill") is not None
        catalog = manager.generate_skill_catalog()
        assert "<available_skills>" in catalog
        assert "<name>demo-skill</name>" in catalog
        assert "<source_scope>project</source_scope>" in catalog

    def test_parse_slash_command(self):
        parsed = parse_skill_command("/skill:demo-skill continue with analysis")
        assert parsed is not None
        assert parsed.skill_name == "demo-skill"
        assert parsed.remainder == "continue with analysis"

    def test_activation_payload(self):
        root = self._create_skill_dir()
        manager = SkillManager([root])
        details = activate_skill_by_name(manager, "demo-skill", source="slash_command", command_text="/skill:demo-skill")
        assert details["_is_skill_activation"] is True
        assert details["skill"]["name"] == "demo-skill"
        assert details["granted_permissions"] == ["run_python"]
        assert details["model_override"] == "claude-sonnet"
        assert details["source_scope"] == "project"
        assert '<skill_content name="demo-skill">' in details["model_message_injection"]

    @pytest.mark.asyncio
    async def test_activate_skill_tool(self):
        root = self._create_skill_dir()
        manager = SkillManager([root])
        tool = create_skill_tools(manager)[0]
        result = await tool.execute("call-1", {"command": "demo-skill"})
        assert result.details["skill"]["name"] == "demo-skill"


class TestClarification:
    @pytest.mark.asyncio
    async def test_clarification_tool(self):
        async def mock_callback(question: str, options: list[str]) -> str:
            return "选项A"

        tool = create_clarification_tool(mock_callback)
        result = await tool.execute_fn("test-id", {"question": "请确认", "options": ["选项A", "选项B"]})
        assert "选项A" in result.content[0].text
