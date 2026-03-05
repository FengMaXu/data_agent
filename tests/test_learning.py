"""
阶段四：学习与记忆模块单元测试
"""

import json
import tempfile
from pathlib import Path

import pytest

from src.learning.learning_store import LearningStore, LearningEntry
from src.learning.feedback import FeedbackCollector


# ══════════════════════════════════════════════
# LearningStore 测试
# ══════════════════════════════════════════════


class TestLearningStore:
    """错题本存储测试"""

    def _create_store(self) -> LearningStore:
        tmpdir = tempfile.mkdtemp()
        return LearningStore(storage_dir=tmpdir)

    def test_save_and_load(self):
        """测试保存和加载"""
        store = self._create_store()

        entry = LearningEntry(
            failed_sql="SELECT * FROM usr",
            error_message="Table 'usr' doesn't exist",
            error_type="table_not_found",
            fixed_sql="SELECT * FROM users",
            fix_explanation="表名拼错了，应该是 users 不是 usr",
        )
        record_id = store.save(entry)
        assert record_id.startswith("learn_")

        # 重新加载，验证持久化
        store2 = LearningStore(storage_dir=store._storage_dir)
        store2._ensure_loaded()
        assert len(store2._entries) == 1
        assert store2._entries[0].failed_sql == "SELECT * FROM usr"

    def test_search_by_table(self):
        """测试按表名搜索"""
        store = self._create_store()

        store.save(
            LearningEntry(
                failed_sql="SELECT * FROM orders WHERE status = 1",
                error_message="类型不匹配",
                error_type="type_mismatch",
                fixed_sql="SELECT * FROM orders WHERE status = 'paid'",
                fix_explanation="status 是字符串，不是数字",
                tables_involved=["orders"],
            )
        )

        store.save(
            LearningEntry(
                failed_sql="SELECT * FROM users WHERE age > 'abc'",
                error_message="无效比较",
                error_type="type_mismatch",
                fixed_sql="SELECT * FROM users WHERE age > 18",
                tables_involved=["users"],
            )
        )

        results = store.search(tables=["orders"])
        assert len(results) >= 1
        assert any("orders" in e.tables_involved for e in results)

    def test_search_by_keyword(self):
        """测试按关键词搜索"""
        store = self._create_store()

        store.save(
            LearningEntry(
                failed_sql="SELECT position FROM race_results WHERE position = 1",
                error_message="position 是 TEXT 类型",
                error_type="type_mismatch",
                fixed_sql="SELECT position FROM race_results WHERE position = '1'",
                fix_explanation="position 列是 TEXT 类型，需要用字符串比较",
            )
        )

        results = store.search("position 类型")
        assert len(results) >= 1

    def test_format_learnings(self):
        """测试格式化输出"""
        store = self._create_store()

        store.save(
            LearningEntry(
                failed_sql="SELECT * FROM bad",
                error_message="表不存在",
                error_type="table_not_found",
                fixed_sql="SELECT * FROM good",
                fix_explanation="表名错误",
            )
        )

        text = store.format_learnings(store._entries)
        assert "教训" in text
        assert "bad" in text
        assert "good" in text

    def test_get_stats(self):
        """测试统计"""
        store = self._create_store()

        store.save(
            LearningEntry(
                failed_sql="q1",
                error_message="e1",
                error_type="syntax",
                fixed_sql="f1",
            )
        )
        store.save(
            LearningEntry(
                failed_sql="q2",
                error_message="e2",
                error_type="syntax",
                fixed_sql="f2",
            )
        )
        store.save(
            LearningEntry(
                failed_sql="q3",
                error_message="e3",
                error_type="logic",
                fixed_sql="f3",
            )
        )

        stats = store.get_stats()
        assert stats["total"] == 3
        assert stats["by_type"]["syntax"] == 2
        assert stats["by_type"]["logic"] == 1

    def test_auto_extract_tables(self):
        """测试自动提取表名"""
        store = self._create_store()

        entry = LearningEntry(
            failed_sql="SELECT u.name FROM users u JOIN orders o ON u.id = o.user_id",
            error_message="error",
            error_type="other",
            fixed_sql="fixed",
        )
        store.save(entry)

        saved = store._entries[-1]
        assert "users" in saved.tables_involved
        assert "orders" in saved.tables_involved

    def test_empty_search(self):
        """测试空搜索"""
        store = self._create_store()
        results = store.search("anything")
        assert results == []


# ══════════════════════════════════════════════
# FeedbackCollector 测试
# ══════════════════════════════════════════════


class TestFeedbackCollector:
    """用户反馈收集测试"""

    def _create_collector(self) -> FeedbackCollector:
        tmpdir = tempfile.mkdtemp()
        store = LearningStore(storage_dir=tmpdir)
        return FeedbackCollector(store)

    def test_positive_feedback(self):
        """测试正面反馈"""
        collector = self._create_collector()

        collector.record_execution("SELECT 1", "result")
        record = collector.record_feedback(is_correct=True)
        assert record.is_correct is True

        stats = collector.get_accuracy_stats()
        assert stats["accuracy"] == 100.0

    def test_negative_feedback(self):
        """测试负面反馈"""
        collector = self._create_collector()

        collector.record_execution("SELECT * FROM users", "wrong result")
        record = collector.record_feedback(
            is_correct=False,
            user_comment="结果不对",
        )
        assert record.is_correct is False
        assert record.user_comment == "结果不对"

    def test_save_negative_as_learning(self):
        """测试将负面反馈转为学习记录"""
        collector = self._create_collector()

        record_id = collector.save_negative_as_learning(
            failed_sql="SELECT SUM(amount) FROM orders",
            error_message="没排除退款订单",
            fixed_sql="SELECT SUM(amount) FROM orders WHERE status != 'refunded'",
            fix_explanation="统计收入需排除退款",
        )
        assert record_id.startswith("learn_")

    def test_accuracy_stats(self):
        """测试准确率统计"""
        collector = self._create_collector()

        collector.record_feedback(is_correct=True, query="q1")
        collector.record_feedback(is_correct=True, query="q2")
        collector.record_feedback(is_correct=False, query="q3")

        stats = collector.get_accuracy_stats()
        assert stats["total"] == 3
        assert stats["correct"] == 2
        assert stats["accuracy"] == 66.7


# ══════════════════════════════════════════════
# AgentTool 创建测试
# ══════════════════════════════════════════════


class TestCreateTools:
    """测试工具创建"""

    def test_learning_store_tools(self):
        tmpdir = tempfile.mkdtemp()
        store = LearningStore(storage_dir=tmpdir)
        tools = store.create_tools()
        names = [t.name for t in tools]
        assert "search_past_learnings" in names
        assert "save_learning" in names

    def test_feedback_tools(self):
        tmpdir = tempfile.mkdtemp()
        store = LearningStore(storage_dir=tmpdir)
        collector = FeedbackCollector(store)
        tools = collector.create_tools()
        names = [t.name for t in tools]
        assert "report_query_feedback" in names

    @pytest.mark.asyncio
    async def test_search_tool_returns_empty(self):
        """测试搜索工具返回空"""
        tmpdir = tempfile.mkdtemp()
        store = LearningStore(storage_dir=tmpdir)
        tools = store.create_tools()
        search_tool = [t for t in tools if t.name == "search_past_learnings"][0]

        result = await search_tool.execute_fn("id", {"query": "test"})
        assert "放心" in result.content[0].text or "未找到" in result.content[0].text

    @pytest.mark.asyncio
    async def test_save_tool_works(self):
        """测试保存工具"""
        tmpdir = tempfile.mkdtemp()
        store = LearningStore(storage_dir=tmpdir)
        tools = store.create_tools()
        save_tool = [t for t in tools if t.name == "save_learning"][0]

        result = await save_tool.execute_fn(
            "id",
            {
                "failed_sql": "SELECT * FROM x",
                "error_message": "不存在",
                "fixed_sql": "SELECT * FROM y",
            },
        )
        assert "已保存" in result.content[0].text
        assert store.get_stats()["total"] == 1
