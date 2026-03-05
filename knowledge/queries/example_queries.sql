-- <query name>monthly_revenue_trend</query name>
-- <query description>
-- 按月统计有效订单的收入趋势
-- 排除已取消和已退款的订单
-- </query description>
-- <query>
SELECT
    DATE_FORMAT(created_at, '%Y-%m') AS month,
    COUNT(DISTINCT order_id) AS order_count,
    SUM(amount) AS total_revenue,
    ROUND(SUM(amount) / COUNT(DISTINCT order_id), 2) AS avg_order_value
FROM orders
WHERE order_status NOT IN ('cancelled', 'refunded')
    AND deleted_at IS NULL
GROUP BY DATE_FORMAT(created_at, '%Y-%m')
ORDER BY month DESC
LIMIT 12
-- </query>


-- <query name>top_customers_by_spend</query name>
-- <query description>
-- 按累计消费金额排名的大客户列表
-- 只统计有效订单，关联用户表获取用户名
-- </query description>
-- <query>
SELECT
    u.user_id,
    u.name AS customer_name,
    COUNT(DISTINCT o.order_id) AS order_count,
    SUM(o.amount) AS total_spend,
    ROUND(SUM(o.amount) / COUNT(DISTINCT o.order_id), 2) AS avg_order_value,
    MIN(o.created_at) AS first_order,
    MAX(o.created_at) AS last_order
FROM users u
JOIN orders o ON u.user_id = o.user_id
WHERE o.order_status NOT IN ('cancelled', 'refunded')
    AND u.deleted_at IS NULL
    AND o.deleted_at IS NULL
GROUP BY u.user_id, u.name
ORDER BY total_spend DESC
LIMIT 20
-- </query>


-- <query name>daily_active_users</query name>
-- <query description>
-- 按日统计活跃用户数（有登录或交易行为的用户）
-- </query description>
-- <query>
SELECT
    DATE(action_date) AS day,
    COUNT(DISTINCT user_id) AS active_users
FROM user_activity
WHERE action_date >= CURDATE() - INTERVAL 30 DAY
GROUP BY DATE(action_date)
ORDER BY day DESC
-- </query>


-- <query name>repurchase_rate</query name>
-- <query description>
-- 计算指定月份的复购率
-- 复购率 = 购买>=2次的用户数 / 全部购买用户数
-- </query description>
-- <query>
SELECT
    DATE_FORMAT(created_at, '%Y-%m') AS month,
    COUNT(DISTINCT user_id) AS total_buyers,
    SUM(CASE WHEN order_count >= 2 THEN 1 ELSE 0 END) AS repeat_buyers,
    ROUND(SUM(CASE WHEN order_count >= 2 THEN 1 ELSE 0 END) / COUNT(DISTINCT user_id) * 100, 2) AS repurchase_rate_pct
FROM (
    SELECT
        user_id,
        DATE_FORMAT(created_at, '%Y-%m') AS month_key,
        COUNT(*) AS order_count
    FROM orders
    WHERE order_status NOT IN ('cancelled', 'refunded')
        AND deleted_at IS NULL
    GROUP BY user_id, DATE_FORMAT(created_at, '%Y-%m')
) sub
GROUP BY month
ORDER BY month DESC
LIMIT 12
-- </query>
