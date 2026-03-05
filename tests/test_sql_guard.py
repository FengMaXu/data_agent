"""
SQL 安全拦截器单元测试
"""

import pytest
from src.mcp.sql_guard import SQLGuard


class TestSQLGuard:
    """测试 SQL 安全拦截器"""

    def setup_method(self):
        self.guard = SQLGuard(strict=True)

    # ── 应该放行的安全查询 ──

    def test_allow_select(self):
        result = self.guard.check("SELECT * FROM users")
        assert result.allowed is True

    def test_allow_select_with_where(self):
        result = self.guard.check("SELECT id, name FROM orders WHERE amount > 100")
        assert result.allowed is True

    def test_allow_select_with_join(self):
        result = self.guard.check(
            "SELECT u.name, o.amount FROM users u JOIN orders o ON u.id = o.user_id"
        )
        assert result.allowed is True

    def test_allow_show(self):
        result = self.guard.check("SHOW TABLES")
        assert result.allowed is True

    def test_allow_describe(self):
        result = self.guard.check("DESCRIBE users")
        assert result.allowed is True

    def test_allow_explain(self):
        result = self.guard.check("EXPLAIN SELECT * FROM users")
        assert result.allowed is True

    def test_allow_select_count(self):
        result = self.guard.check("SELECT COUNT(*) FROM orders GROUP BY status")
        assert result.allowed is True

    def test_allow_select_subquery(self):
        result = self.guard.check(
            "SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)"
        )
        assert result.allowed is True

    # ── 应该拦截的危险操作 ──

    def test_block_drop_table(self):
        result = self.guard.check("DROP TABLE users")
        assert result.allowed is False
        assert "安全拦截" in result.reason

    def test_block_truncate(self):
        result = self.guard.check("TRUNCATE TABLE orders")
        assert result.allowed is False

    def test_block_delete(self):
        result = self.guard.check("DELETE FROM users WHERE id = 1")
        assert result.allowed is False

    def test_block_insert(self):
        result = self.guard.check("INSERT INTO users (name) VALUES ('test')")
        assert result.allowed is False

    def test_block_update(self):
        result = self.guard.check("UPDATE users SET name = 'hacked' WHERE id = 1")
        assert result.allowed is False

    def test_block_alter(self):
        result = self.guard.check("ALTER TABLE users ADD COLUMN hack VARCHAR(100)")
        assert result.allowed is False

    def test_block_grant(self):
        result = self.guard.check("GRANT ALL ON *.* TO 'hacker'@'%'")
        assert result.allowed is False

    def test_block_create(self):
        result = self.guard.check("CREATE TABLE hacked (id INT)")
        assert result.allowed is False

    # ── 应该拦截的注入攻击 ──

    def test_block_union_injection(self):
        result = self.guard.check(
            "SELECT * FROM users WHERE id = 1 UNION SELECT * FROM passwords"
        )
        assert result.allowed is False

    def test_block_comment_injection(self):
        result = self.guard.check("SELECT * FROM users WHERE id = 1 -- AND admin = 0")
        assert result.allowed is False

    def test_block_multi_statement(self):
        result = self.guard.check("SELECT 1; DROP TABLE users")
        assert result.allowed is False

    # ── 边界情况 ──

    def test_block_empty_query(self):
        result = self.guard.check("")
        assert result.allowed is False

    def test_block_whitespace_only(self):
        result = self.guard.check("   ")
        assert result.allowed is False

    def test_case_insensitive(self):
        result = self.guard.check("drop table users")
        assert result.allowed is False

    def test_mixed_case(self):
        result = self.guard.check("DrOp TaBlE users")
        assert result.allowed is False


class TestSQLGuardNonStrict:
    """测试非严格模式（黑名单优先）"""

    def setup_method(self):
        self.guard = SQLGuard(strict=False)

    def test_allow_select(self):
        result = self.guard.check("SELECT * FROM users")
        assert result.allowed is True

    def test_still_block_drop(self):
        result = self.guard.check("DROP TABLE users")
        assert result.allowed is False

    def test_still_block_injection(self):
        result = self.guard.check("SELECT 1 UNION SELECT password FROM users")
        assert result.allowed is False
