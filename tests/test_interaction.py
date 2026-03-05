"""
阶段三功能单元测试
- SQL 沙盒评估器
- 技能注册中心
- 主动澄清工具
"""

import json
import pytest
import pytest_asyncio
import asyncio

from src.interaction.sql_evaluator import SQLEvaluator, EvaluationResult
from src.interaction.skill_registry import (
    SkillRegistry,
    SkillDefinition,
    register_builtin_skills,
)
from src.interaction.clarification import create_clarification_tool
from src.mcp.sql_guard import SQLGuard


# ══════════════════════════════════════════════
# Mock MCP Client
# ══════════════════════════════════════════════


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
        # 默认返回成功
        return json.dumps({"status": "success", "data": []})


# ══════════════════════════════════════════════
# SQLEvaluator 测试
# ══════════════════════════════════════════════


class TestSQLEvaluator:
    """SQL 沙盒评估器测试"""

    @pytest.mark.asyncio
    async def test_guard_blocks_dangerous_sql(self):
        """安全拦截器应阻止危险 SQL"""
        mock_mcp = MockMCPClient()
        evaluator = SQLEvaluator(mock_mcp, SQLGuard(strict=True))

        result = await evaluator.validate("DROP TABLE users")
        assert result.passed is False
        assert "安全拦截" in result.error_message

    @pytest.mark.asyncio
    async def test_select_goes_through_validation(self):
        """SELECT 应通过 LIMIT 1 空跑"""
        mock_mcp = MockMCPClient()
        evaluator = SQLEvaluator(mock_mcp, SQLGuard(strict=True))

        result = await evaluator.validate("SELECT * FROM users WHERE id > 10")
        assert result.passed is True
        assert result.validation_method == "limit1"
        # 验证空跑 SQL 包含 LIMIT 1
        assert len(mock_mcp.calls) == 1
        call_query = mock_mcp.calls[0][1]["query"]
        assert "LIMIT 1" in call_query

    @pytest.mark.asyncio
    async def test_show_passthrough(self):
        """SHOW 语句应直接放行"""
        mock_mcp = MockMCPClient()
        evaluator = SQLEvaluator(mock_mcp, SQLGuard(strict=True))

        result = await evaluator.validate("SHOW TABLES")
        assert result.passed is True
        assert result.validation_method == "passthrough"
        assert len(mock_mcp.calls) == 0  # 不应调用 MCP

    @pytest.mark.asyncio
    async def test_select_with_existing_limit(self):
        """已有 LIMIT 的 SELECT 应替换为 LIMIT 1"""
        mock_mcp = MockMCPClient()
        evaluator = SQLEvaluator(mock_mcp, SQLGuard(strict=True))

        result = await evaluator.validate("SELECT * FROM orders LIMIT 100")
        assert result.passed is True
        call_query = mock_mcp.calls[0][1]["query"]
        assert "LIMIT 1" in call_query
        assert "LIMIT 100" not in call_query

    @pytest.mark.asyncio
    async def test_failed_validation(self):
        """空跑失败时应返回错误"""
        mock_mcp = MockMCPClient(
            {
                'execute_sql:{"query": "SELECT * FROM nonexistent LIMIT 1"}': json.dumps(
                    {"error": "Table 'nonexistent' doesn't exist"}
                ),
            }
        )
        evaluator = SQLEvaluator(mock_mcp, SQLGuard(strict=True))

        result = await evaluator.validate("SELECT * FROM nonexistent")
        assert result.passed is False
        assert "验证失败" in result.error_message


# ══════════════════════════════════════════════
# SkillRegistry 测试
# ══════════════════════════════════════════════


class TestSkillRegistry:
    """技能注册中心测试"""

    def test_register_and_list(self):
        """测试注册和列出技能"""
        registry = SkillRegistry()

        async def dummy_fn(args):
            return "ok"

        registry.register(
            SkillDefinition(
                name="test_skill",
                description="A test skill",
                parameters={"type": "object", "properties": {}},
                execute_fn=dummy_fn,
                category="test",
            )
        )

        skills = registry.list_skills()
        assert len(skills) == 1
        assert skills[0]["name"] == "test_skill"
        assert skills[0]["category"] == "test"

    def test_unregister(self):
        """测试注销技能"""
        registry = SkillRegistry()

        async def dummy_fn(args):
            return "ok"

        registry.register(
            SkillDefinition(
                name="temp",
                description="Temporary",
                parameters={},
                execute_fn=dummy_fn,
            )
        )
        assert len(registry.list_skills()) == 1

        registry.unregister("temp")
        assert len(registry.list_skills()) == 0

    def test_builtin_skills(self):
        """测试内置技能注册"""
        registry = SkillRegistry()
        register_builtin_skills(registry)

        skills = registry.list_skills()
        names = [s["name"] for s in skills]
        assert "export_csv" in names
        assert "summarize_data" in names

    def test_create_tools(self):
        """测试转换为 AgentTool"""
        registry = SkillRegistry()
        register_builtin_skills(registry)

        tools = registry.create_tools()
        assert len(tools) >= 2
        tool_names = [t.name for t in tools]
        assert "export_csv" in tool_names

    @pytest.mark.asyncio
    async def test_skill_execution(self):
        """测试技能执行"""
        registry = SkillRegistry()

        async def echo_fn(args):
            return f"Echo: {args.get('msg', '')}"

        registry.register(
            SkillDefinition(
                name="echo",
                description="Echo skill",
                parameters={
                    "type": "object",
                    "properties": {"msg": {"type": "string"}},
                },
                execute_fn=echo_fn,
            )
        )

        tools = registry.create_tools()
        result = await tools[0].execute_fn("test-id", {"msg": "hello"})
        assert "Echo: hello" in result.content[0].text


# ══════════════════════════════════════════════
# Clarification 测试
# ══════════════════════════════════════════════


class TestClarification:
    """主动澄清工具测试"""

    @pytest.mark.asyncio
    async def test_clarification_tool(self):
        """测试基本澄清流程"""

        async def mock_callback(question: str, options: list[str]) -> str:
            return "选项A"

        tool = create_clarification_tool(mock_callback)
        assert tool.name == "request_user_clarification"

        result = await tool.execute_fn(
            "test-id", {"question": "请确认", "options": ["选项A", "选项B"]}
        )
        assert "选项A" in result.content[0].text

    @pytest.mark.asyncio
    async def test_clarification_empty_question(self):
        """测试空问题应报错"""

        async def mock_callback(q, o):
            return "never called"

        tool = create_clarification_tool(mock_callback)
        result = await tool.execute_fn("test-id", {"question": ""})
        assert result.is_error is True

    @pytest.mark.asyncio
    async def test_clarification_free_text(self):
        """测试自由文本回答"""

        async def mock_callback(question: str, options: list[str]) -> str:
            return "消费超过5万元的客户"

        tool = create_clarification_tool(mock_callback)
        result = await tool.execute_fn("test-id", {"question": "请定义大客户的标准"})
        assert "消费超过5万元" in result.content[0].text
