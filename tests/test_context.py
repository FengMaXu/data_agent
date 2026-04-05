"""
上下文引擎单元测试
测试业务标注检索与知识库搜索
"""

import json
import tempfile
from pathlib import Path

import pytest

from src.context.annotations import AnnotationStore
from src.context.knowledge_tools import (
    _search_knowledge,
    _search_query_patterns,
    create_knowledge_tools,
)


# ══════════════════════════════════════════════
# AnnotationStore 测试
# ══════════════════════════════════════════════


class TestAnnotationStore:
    """业务标注知识库测试"""

    def _create_temp_knowledge(self, data: dict) -> str:
        """创建临时知识库目录"""
        tmpdir = tempfile.mkdtemp()
        filepath = Path(tmpdir) / "test_metrics.json"
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        return tmpdir

    def test_load_and_search_metrics(self):
        """测试加载和搜索指标"""
        data = {
            "metrics": [
                {
                    "name": "净收入",
                    "definition": "扣除退款后的实际收入",
                    "table": "orders",
                    "calculation": "SUM(amount) - SUM(refund)",
                },
                {
                    "name": "活跃用户",
                    "definition": "30天内有登录的用户",
                    "table": "users",
                    "calculation": "COUNT(DISTINCT user_id)",
                },
            ],
            "business_rules": ["金额单位为元"],
            "common_gotchas": [],
        }
        tmpdir = self._create_temp_knowledge(data)
        store = AnnotationStore()
        store.load(tmpdir)

        result = store.search("净收入")
        assert "净收入" in result
        assert "退款" in result

    def test_search_business_rules(self):
        """测试搜索业务规则"""
        data = {
            "metrics": [],
            "business_rules": [
                "订单状态: paid=已付款, cancelled=已取消",
                "Q1=1-3月, Q2=4-6月",
            ],
            "common_gotchas": [],
        }
        tmpdir = self._create_temp_knowledge(data)
        store = AnnotationStore()
        store.load(tmpdir)

        result = store.search("订单状态")
        assert "paid" in result

    def test_search_gotchas(self):
        """测试搜索陷阱"""
        data = {
            "metrics": [],
            "business_rules": [],
            "common_gotchas": [
                {
                    "issue": "金额精度问题",
                    "tables_affected": ["orders"],
                    "solution": "使用ROUND()处理精度",
                }
            ],
        }
        tmpdir = self._create_temp_knowledge(data)
        store = AnnotationStore()
        store.load(tmpdir)

        result = store.search("金额精度")
        assert "ROUND" in result

    def test_empty_dir(self):
        """测试空目录"""
        tmpdir = tempfile.mkdtemp()
        store = AnnotationStore()
        store.load(tmpdir)

        result = store.get_all()
        assert "为空" in result

    def test_get_all(self):
        """测试获取全部知识"""
        data = {
            "metrics": [
                {
                    "name": "Test",
                    "definition": "A test metric",
                    "table": "t",
                    "calculation": "COUNT(*)",
                }
            ],
            "business_rules": ["Rule 1"],
            "common_gotchas": [],
        }
        tmpdir = self._create_temp_knowledge(data)
        store = AnnotationStore()
        store.load(tmpdir)

        result = store.get_all()
        assert "Test" in result
        assert "Rule 1" in result


# ══════════════════════════════════════════════
# Knowledge Tools 测试
# ══════════════════════════════════════════════


class TestKnowledgeSearch:
    def _create_temp_knowledge(self) -> str:
        tmpdir = tempfile.mkdtemp()
        knowledge_root = Path(tmpdir)
        (knowledge_root / "doc").mkdir(parents=True, exist_ok=True)

        (knowledge_root / "doc" / "query_patterns.md").write_text(
            "# SQL 模板\n\n"
            "## 行业大类累计销售额查询模板\n\n"
            "### 查询指定行业大类在指定月份的累计销售额和同比增速\n"
            "适用于批发业、零售业等行业大类单值查询。\n"
            "```sql\n"
            "SELECT industry_name_large, SUM(sales_ytd) AS 销售额\n"
            "FROM fact_sales_monthly\n"
            "WHERE snapshot_month = '2025-12-01'\n"
            "GROUP BY industry_name_large\n"
            "```\n\n"
            "## 企业月度累计销售额查询模板\n\n"
            "### 查询特定企业月度累计销售额和增速\n"
            "适用于企业名称模糊匹配和月度走势。\n",
            encoding="utf-8",
        )
        (knowledge_root / "doc" / "business.md").write_text(
            "# 业务规则\n\n"
            "## 口径说明\n"
            "商品销售额口径不含批发额外补贴。\n",
            encoding="utf-8",
        )
        (knowledge_root / "doc" / "rules.md").write_text(
            "# SQL 规则\n\n"
            "优先复用已验证模板，避免重复探索。\n",
            encoding="utf-8",
        )
        return tmpdir

    @pytest.mark.asyncio
    async def test_search_knowledge_smart_mode_matches_multiple_keywords(self, monkeypatch):
        knowledge_root = self._create_temp_knowledge()
        monkeypatch.setattr("src.context.knowledge_tools.KNOWLEDGE_ROOT", Path(knowledge_root))

        result = await _search_knowledge(
            "call-1",
            {"query": "批发业 商品销售额 增速", "context_lines": 1, "max_results": 5},
        )

        text = result.content[0].text
        assert result.is_error is False
        assert "query_patterns.md" in text
        assert "命中关键词: 批发业, 商品销售额, 增速" in text
        assert "行业大类累计销售额查询模板" in text

    @pytest.mark.asyncio
    async def test_search_knowledge_smart_mode_scans_multiple_documents(self, monkeypatch):
        knowledge_root = self._create_temp_knowledge()
        monkeypatch.setattr("src.context.knowledge_tools.KNOWLEDGE_ROOT", Path(knowledge_root))

        result = await _search_knowledge(
            "call-2",
            {"query": "口径 商品销售额", "context_lines": 1, "max_results": 5},
        )

        text = result.content[0].text
        assert "business.md" in text
        assert "商品销售额口径不含批发额外补贴" in text

    @pytest.mark.asyncio
    async def test_search_knowledge_regex_mode_supports_exact_pattern(self, monkeypatch):
        knowledge_root = self._create_temp_knowledge()
        monkeypatch.setattr("src.context.knowledge_tools.KNOWLEDGE_ROOT", Path(knowledge_root))

        result = await _search_knowledge(
            "call-3",
            {"query": "批发业.*增速", "mode": "regex", "context_lines": 1, "max_results": 5},
        )

        text = result.content[0].text
        assert result.is_error is False
        assert "模式: 正则" in text
        assert "query_patterns.md" in text

    @pytest.mark.asyncio
    async def test_search_knowledge_regex_mode_reports_invalid_pattern(self, monkeypatch):
        knowledge_root = self._create_temp_knowledge()
        monkeypatch.setattr("src.context.knowledge_tools.KNOWLEDGE_ROOT", Path(knowledge_root))

        result = await _search_knowledge(
            "call-4",
            {"query": "([未闭合", "mode": "regex"},
        )

        assert result.is_error is True
        assert "非法正则表达式" in result.content[0].text

    @pytest.mark.asyncio
    async def test_search_query_patterns_returns_direct_template_hit(self, monkeypatch):
        knowledge_root = self._create_temp_knowledge()
        root = Path(knowledge_root)
        monkeypatch.setattr("src.context.knowledge_tools.KNOWLEDGE_ROOT", root)
        monkeypatch.setattr(
            "src.context.knowledge_tools.QUERY_PATTERNS_PATH",
            root / "doc" / "query_patterns.md",
        )

        result = await _search_query_patterns(
            "call-5",
            {"query": "2025年批发业累计销售额", "max_results": 2},
        )

        text = result.content[0].text
        assert result.is_error is False
        assert "查询模板检索结果" in text
        assert "行业大类累计销售额查询模板" in text
        assert "示例 SQL" in text
        assert result.details["source_path"] == "doc/query_patterns.md"
        assert result.details["match_count"] >= 1

    @pytest.mark.asyncio
    async def test_search_query_patterns_reports_fallback_when_no_match(self, monkeypatch):
        knowledge_root = self._create_temp_knowledge()
        root = Path(knowledge_root)
        monkeypatch.setattr("src.context.knowledge_tools.KNOWLEDGE_ROOT", root)
        monkeypatch.setattr(
            "src.context.knowledge_tools.QUERY_PATTERNS_PATH",
            root / "doc" / "query_patterns.md",
        )

        result = await _search_query_patterns(
            "call-6",
            {"query": "完全无关的自定义库存预警指标"},
        )

        text = result.content[0].text
        assert "未在 doc/query_patterns.md 中找到" in text
        assert "search_knowledge" in text


class TestKnowledgeToolRegistration:
    def test_knowledge_tools_expose_dedicated_query_pattern_tool(self):
        tool_names = {tool.name for tool in create_knowledge_tools()}
        assert "search_knowledge" in tool_names
        assert "search_query_patterns" in tool_names
