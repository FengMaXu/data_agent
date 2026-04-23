# SQL Query Patterns

以下模板基于通用企业数据库设计，可作为默认查询范式。执行前请将占位符替换为实际字段值或日期范围。

## 1. 月度营收趋势

```sql
SELECT
    DATE_FORMAT(paid_at, '%Y-%m') AS month_label,
    ROUND(SUM(paid_amount), 2) AS revenue_amount
FROM fact_orders
WHERE order_status IN ('paid', 'completed')
  AND paid_at >= '{{start_date}}'
  AND paid_at < '{{end_date}}'
GROUP BY DATE_FORMAT(paid_at, '%Y-%m')
ORDER BY month_label;
```

适用场景：
- 用户询问最近 12 个月营收趋势、本年各月营收、月度收入变化。

## 2. 按区域统计营收

```sql
SELECT
    r.province_name,
    ROUND(SUM(o.paid_amount), 2) AS revenue_amount,
    COUNT(DISTINCT o.order_id) AS order_count,
    COUNT(DISTINCT o.customer_id) AS customer_count
FROM fact_orders o
JOIN dim_region r ON o.region_id = r.region_id
WHERE o.order_status IN ('paid', 'completed')
  AND o.paid_at >= '{{start_date}}'
  AND o.paid_at < '{{end_date}}'
GROUP BY r.province_name
ORDER BY revenue_amount DESC;
```

适用场景：
- 用户询问哪些区域表现最好、各省份营收排名、区域客户贡献。

## 3. 产品收入 Top 10

```sql
SELECT
    p.product_name,
    p.category_name,
    ROUND(SUM(i.net_amount), 2) AS revenue_amount,
    ROUND(SUM(i.quantity), 2) AS sold_quantity
FROM fact_order_items i
JOIN fact_orders o ON i.order_id = o.order_id
JOIN dim_product p ON i.product_id = p.product_id
WHERE o.order_status IN ('paid', 'completed')
  AND o.paid_at >= '{{start_date}}'
  AND o.paid_at < '{{end_date}}'
GROUP BY p.product_name, p.category_name
ORDER BY revenue_amount DESC
LIMIT 10;
```

适用场景：
- 用户询问热销产品、收入贡献最高的 SKU、品类排名。

## 4. 按渠道统计毛利

```sql
SELECT
    c.channel_name,
    ROUND(SUM(i.net_amount), 2) AS revenue_amount,
    ROUND(SUM(i.cost_amount), 2) AS cost_amount,
    ROUND(SUM(i.net_amount - i.cost_amount), 2) AS gross_profit
FROM fact_order_items i
JOIN fact_orders o ON i.order_id = o.order_id
JOIN dim_channel c ON o.channel_id = c.channel_id
WHERE o.order_status IN ('paid', 'completed')
  AND o.paid_at >= '{{start_date}}'
  AND o.paid_at < '{{end_date}}'
GROUP BY c.channel_name
ORDER BY gross_profit DESC;
```

适用场景：
- 用户询问哪些渠道更赚钱、渠道收入与毛利对比。

## 5. 新客户统计

```sql
WITH first_order AS (
    SELECT
        customer_id,
        MIN(paid_at) AS first_paid_at
    FROM fact_orders
    WHERE order_status IN ('paid', 'completed')
    GROUP BY customer_id
)
SELECT
    COUNT(*) AS new_customer_count
FROM first_order
WHERE first_paid_at >= '{{start_date}}'
  AND first_paid_at < '{{end_date}}';
```

适用场景：
- 用户询问某月新增客户数、本季度获客表现。

## 6. 复购率

```sql
WITH customer_orders AS (
    SELECT
        customer_id,
        COUNT(DISTINCT order_id) AS order_cnt
    FROM fact_orders
    WHERE order_status IN ('paid', 'completed')
      AND paid_at >= '{{start_date}}'
      AND paid_at < '{{end_date}}'
    GROUP BY customer_id
)
SELECT
    ROUND(
        SUM(CASE WHEN order_cnt >= 2 THEN 1 ELSE 0 END)
        / NULLIF(COUNT(*), 0),
        4
    ) AS repeat_purchase_rate
FROM customer_orders;
```

适用场景：
- 用户询问复购率、老客黏性、客户二次购买情况。

## 7. 库存预警清单

```sql
WITH latest_snapshot AS (
    SELECT MAX(snapshot_date) AS snapshot_date
    FROM fact_inventory_snapshot
)
SELECT
    p.product_name,
    s.warehouse_name,
    s.on_hand_qty,
    s.reserved_qty,
    ROUND(s.on_hand_qty - s.reserved_qty, 2) AS available_qty
FROM fact_inventory_snapshot s
JOIN latest_snapshot ls ON s.snapshot_date = ls.snapshot_date
JOIN dim_product p ON s.product_id = p.product_id
WHERE (s.on_hand_qty - s.reserved_qty) < {{warning_threshold}}
ORDER BY available_qty ASC, p.product_name;
```

适用场景：
- 用户询问低库存商品、缺货风险、库存预警名单。

## 8. 同比营收对比

```sql
SELECT
    SUM(CASE WHEN paid_at >= '{{current_start}}' AND paid_at < '{{current_end}}' THEN paid_amount ELSE 0 END) AS current_revenue,
    SUM(CASE WHEN paid_at >= '{{previous_start}}' AND paid_at < '{{previous_end}}' THEN paid_amount ELSE 0 END) AS previous_revenue,
    ROUND(
        (
            SUM(CASE WHEN paid_at >= '{{current_start}}' AND paid_at < '{{current_end}}' THEN paid_amount ELSE 0 END)
            - SUM(CASE WHEN paid_at >= '{{previous_start}}' AND paid_at < '{{previous_end}}' THEN paid_amount ELSE 0 END)
        )
        / NULLIF(SUM(CASE WHEN paid_at >= '{{previous_start}}' AND paid_at < '{{previous_end}}' THEN paid_amount ELSE 0 END), 0),
        4
    ) AS yoy_growth_rate
FROM fact_orders
WHERE order_status IN ('paid', 'completed');
```

适用场景：
- 用户询问同比增长、去年同期对比、年度业绩比较。
