"""SQL Guard unit tests."""

from __future__ import annotations

from src.mcp.sql_guard import SQLGuard


class TestSQLGuard:
    """Strict-mode SQL guard behavior."""

    def setup_method(self):
        self.guard = SQLGuard(strict=True)

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

    def test_allow_with_cte_select(self):
        result = self.guard.check(
            """
            WITH CustomerData AS (
                SELECT customer_unique_id, COUNT(*) AS order_count
                FROM customers
                GROUP BY customer_unique_id
            )
            SELECT customer_unique_id, order_count
            FROM CustomerData
            ORDER BY order_count DESC
            LIMIT 3
            """
        )
        assert result.allowed is True

    def test_block_drop_table(self):
        result = self.guard.check("DROP TABLE users")
        assert result.allowed is False
        assert "SQL blocked" in result.reason

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

    def test_block_with_cte_update(self):
        result = self.guard.check(
            "WITH targets AS (SELECT id FROM users) UPDATE users SET role = 'admin'"
        )
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

    def test_block_call(self):
        result = self.guard.check("CALL rebuild_customer_stats()")
        assert result.allowed is False

    def test_block_union_injection(self):
        result = self.guard.check(
            "SELECT * FROM users WHERE id = 1 UNION SELECT * FROM passwords"
        )
        assert result.allowed is False

    def test_allow_standard_line_comment(self):
        result = self.guard.check("SELECT * FROM users WHERE id = 1 -- AND admin = 0")
        assert result.allowed is True

    def test_block_multi_statement(self):
        result = self.guard.check("SELECT 1; DROP TABLE users")
        assert result.allowed is False

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
    """Non-strict SQL guard behavior."""

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
