"""
上下文引擎单元测试
测试业务标注检索和 SQL 模板解析
"""

import json
import tempfile
from pathlib import Path

import pytest

from src.context.annotations import AnnotationStore
from src.context.query_patterns import QueryPatternStore


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
# QueryPatternStore 测试
# ══════════════════════════════════════════════


class TestQueryPatternStore:
    """SQL 模板库测试"""

    def _create_temp_queries(self, content: str) -> str:
        """创建临时 SQL 文件"""
        tmpdir = tempfile.mkdtemp()
        filepath = Path(tmpdir) / "test_queries.sql"
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        return tmpdir

    def test_parse_xml_tags(self):
        """测试 XML 标签解析"""
        sql_content = """
-- <query name>monthly_revenue</query name>
-- <query description>
-- 按月统计收入趋势
-- </query description>
-- <query>
SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, SUM(amount) AS revenue
FROM orders
GROUP BY month
ORDER BY month DESC
-- </query>

-- <query name>top_customers</query name>
-- <query description>
-- 按消费排名
-- </query description>
-- <query>
SELECT user_id, SUM(amount) AS total
FROM orders
GROUP BY user_id
ORDER BY total DESC
LIMIT 10
-- </query>
"""
        tmpdir = self._create_temp_queries(sql_content)
        store = QueryPatternStore()
        store.load(tmpdir)

        assert len(store._patterns) == 2
        assert store._patterns[0].name == "monthly_revenue"
        assert "SUM(amount)" in store._patterns[0].sql

    def test_search_by_keyword(self):
        """测试关键词搜索"""
        sql_content = """
-- <query name>revenue_trend</query name>
-- <query description>
-- 收入趋势分析
-- </query description>
-- <query>
SELECT month, SUM(amount) FROM orders GROUP BY month
-- </query>

-- <query name>user_count</query name>
-- <query description>
-- 用户数量统计
-- </query description>
-- <query>
SELECT COUNT(*) FROM users
-- </query>
"""
        tmpdir = self._create_temp_queries(sql_content)
        store = QueryPatternStore()
        store.load(tmpdir)

        result = store.search("收入")
        assert "revenue_trend" in result
        assert "SUM(amount)" in result

    def test_search_no_match(self):
        """测试无匹配时的行为"""
        sql_content = """
-- <query name>test</query name>
-- <query description>test query</query description>
-- <query>
SELECT 1
-- </query>
"""
        tmpdir = self._create_temp_queries(sql_content)
        store = QueryPatternStore()
        store.load(tmpdir)

        # 只有1个模板，无匹配时返回全部
        result = store.search("完全不相关的关键词xyz")
        assert "test" in result  # 因为只有1条，兜底返回全部

    def test_empty_dir(self):
        """测试空目录"""
        tmpdir = tempfile.mkdtemp()
        store = QueryPatternStore()
        store.load(tmpdir)

        result = store.get_all()
        assert "为空" in result

    def test_get_all(self):
        """测试获取全部模板"""
        sql_content = """
-- <query name>q1</query name>
-- <query description>First</query description>
-- <query>
SELECT 1
-- </query>

-- <query name>q2</query name>
-- <query description>Second</query description>
-- <query>
SELECT 2
-- </query>
"""
        tmpdir = self._create_temp_queries(sql_content)
        store = QueryPatternStore()
        store.load(tmpdir)

        result = store.get_all()
        assert "q1" in result
        assert "q2" in result
